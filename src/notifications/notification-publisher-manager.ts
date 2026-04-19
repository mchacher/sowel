import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import { toISOUtc } from "../core/database.js";
import type {
  NotificationPublisher,
  NotificationPublisherMapping,
  NotificationPublisherWithMappings,
  TelegramChannelConfig,
} from "../shared/types.js";

// ── Row types ────────────────────────────────────────────────

interface PublisherRow {
  id: string;
  name: string;
  channel_type: string;
  channel_config: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface MappingRow {
  id: string;
  publisher_id: string;
  message: string;
  source_type: string;
  source_id: string;
  source_key: string;
  throttle_ms: number;
  created_at: string;
}

// ── Row mappers ──────────────────────────────────────────────

function rowToPublisher(row: PublisherRow): NotificationPublisher {
  return {
    id: row.id,
    name: row.name,
    channelType: row.channel_type as "telegram",
    channelConfig: JSON.parse(row.channel_config) as TelegramChannelConfig,
    enabled: row.enabled === 1,
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
  };
}

function rowToMapping(row: MappingRow): NotificationPublisherMapping {
  return {
    id: row.id,
    publisherId: row.publisher_id,
    message: row.message,
    sourceType: row.source_type as "equipment" | "zone" | "recipe",
    sourceId: row.source_id,
    sourceKey: row.source_key,
    throttleMs: row.throttle_ms,
    createdAt: toISOUtc(row.created_at),
  };
}

// ── Manager ──────────────────────────────────────────────────

export class NotificationPublisherManager {
  private readonly logger;
  private readonly stmts;

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "notification-publisher-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      listPublishers: this.db.prepare(`SELECT * FROM notification_publishers ORDER BY name`),
      getPublisher: this.db.prepare(`SELECT * FROM notification_publishers WHERE id = ?`),
      insertPublisher: this.db.prepare(
        `INSERT INTO notification_publishers (id, name, channel_type, channel_config, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ),
      updatePublisher: this.db.prepare(
        `UPDATE notification_publishers SET name = ?, channel_type = ?, channel_config = ?, enabled = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ),
      deletePublisher: this.db.prepare(`DELETE FROM notification_publishers WHERE id = ?`),
      listMappings: this.db.prepare(
        `SELECT * FROM notification_publisher_mappings WHERE publisher_id = ? ORDER BY message`,
      ),
      insertMapping: this.db.prepare(
        `INSERT INTO notification_publisher_mappings (id, publisher_id, message, source_type, source_id, source_key, throttle_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ),
      getMapping: this.db.prepare(`SELECT * FROM notification_publisher_mappings WHERE id = ?`),
      updateMapping: this.db.prepare(
        `UPDATE notification_publisher_mappings SET message = ?, source_type = ?, source_id = ?, source_key = ?, throttle_ms = ?
         WHERE id = ? AND publisher_id = ?`,
      ),
      deleteMapping: this.db.prepare(
        `DELETE FROM notification_publisher_mappings WHERE id = ? AND publisher_id = ?`,
      ),
    };
  }

  // ── Publisher CRUD ───────────────────────────────────────────

  getAll(): NotificationPublisher[] {
    const rows = this.stmts.listPublishers.all() as PublisherRow[];
    return rows.map(rowToPublisher);
  }

  getById(id: string): NotificationPublisher | null {
    const row = this.stmts.getPublisher.get(id) as PublisherRow | undefined;
    return row ? rowToPublisher(row) : null;
  }

  getAllWithMappings(): NotificationPublisherWithMappings[] {
    const publishers = this.getAll();
    return publishers.map((p) => ({
      ...p,
      mappings: this.getMappings(p.id),
    }));
  }

  getByIdWithMappings(id: string): NotificationPublisherWithMappings | null {
    const publisher = this.getById(id);
    if (!publisher) return null;
    return { ...publisher, mappings: this.getMappings(id) };
  }

  create(input: {
    name: string;
    channelType: "telegram";
    channelConfig: TelegramChannelConfig;
    enabled?: boolean;
  }): NotificationPublisher {
    if (!input.name?.trim()) throw new NotificationPublisherError("name is required", 400);
    if (!input.channelConfig?.botToken?.trim())
      throw new NotificationPublisherError("botToken is required", 400);
    if (!input.channelConfig?.chatId?.trim())
      throw new NotificationPublisherError("chatId is required", 400);

    const id = randomUUID();
    const enabled = input.enabled !== false ? 1 : 0;
    this.stmts.insertPublisher.run(
      id,
      input.name.trim(),
      input.channelType,
      JSON.stringify(input.channelConfig),
      enabled,
    );

    const publisher = this.getById(id)!;
    this.eventBus.emit({ type: "notification-publisher.created", publisher });
    this.logger.info({ publisherId: id, name: input.name }, "Notification publisher created");
    return publisher;
  }

  update(
    id: string,
    updates: {
      name?: string;
      channelType?: "telegram";
      channelConfig?: TelegramChannelConfig;
      enabled?: boolean;
    },
  ): NotificationPublisher {
    const existing = this.getById(id);
    if (!existing) throw new NotificationPublisherError(`Publisher not found: ${id}`, 404);

    const name = updates.name?.trim() ?? existing.name;
    const channelType = updates.channelType ?? existing.channelType;
    const channelConfig = updates.channelConfig ?? existing.channelConfig;
    const enabled =
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled ? 1 : 0;

    this.stmts.updatePublisher.run(name, channelType, JSON.stringify(channelConfig), enabled, id);
    const publisher = this.getById(id)!;
    this.eventBus.emit({ type: "notification-publisher.updated", publisher });
    this.logger.info({ publisherId: id }, "Notification publisher updated");
    return publisher;
  }

  delete(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new NotificationPublisherError(`Publisher not found: ${id}`, 404);

    this.stmts.deletePublisher.run(id);
    this.eventBus.emit({
      type: "notification-publisher.removed",
      publisherId: id,
      publisherName: existing.name,
    });
    this.logger.info({ publisherId: id, name: existing.name }, "Notification publisher deleted");
  }

  // ── Mapping CRUD ─────────────────────────────────────────────

  getMappings(publisherId: string): NotificationPublisherMapping[] {
    const rows = this.stmts.listMappings.all(publisherId) as MappingRow[];
    return rows.map(rowToMapping);
  }

  addMapping(
    publisherId: string,
    input: {
      message: string;
      sourceType: "equipment" | "zone" | "recipe";
      sourceId: string;
      sourceKey: string;
      throttleMs?: number;
    },
  ): NotificationPublisherMapping {
    const publisher = this.getById(publisherId);
    if (!publisher)
      throw new NotificationPublisherError(`Publisher not found: ${publisherId}`, 404);
    if (!input.message?.trim()) throw new NotificationPublisherError("message is required", 400);
    if (!input.sourceId?.trim()) throw new NotificationPublisherError("sourceId is required", 400);
    if (!input.sourceKey?.trim())
      throw new NotificationPublisherError("sourceKey is required", 400);
    if (
      input.sourceType !== "equipment" &&
      input.sourceType !== "zone" &&
      input.sourceType !== "recipe"
    ) {
      throw new NotificationPublisherError(
        "sourceType must be 'equipment', 'zone', or 'recipe'",
        400,
      );
    }

    const id = randomUUID();
    const throttleMs = input.throttleMs ?? 300_000;
    try {
      this.stmts.insertMapping.run(
        id,
        publisherId,
        input.message.trim(),
        input.sourceType,
        input.sourceId.trim(),
        input.sourceKey.trim(),
        throttleMs,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        throw new NotificationPublisherError(
          `Mapping for this source already exists in this publisher`,
          409,
        );
      }
      throw err;
    }

    const row = this.stmts.getMapping.get(id) as MappingRow;
    const mapping = rowToMapping(row);
    this.eventBus.emit({
      type: "notification-publisher.mapping.created",
      publisherId,
      mapping,
    });
    this.logger.info(
      { publisherId, mappingId: id, message: input.message },
      "Notification publisher mapping added",
    );
    return mapping;
  }

  updateMapping(
    publisherId: string,
    mappingId: string,
    input: {
      message?: string;
      sourceType?: "equipment" | "zone" | "recipe";
      sourceId?: string;
      sourceKey?: string;
      throttleMs?: number;
    },
  ): NotificationPublisherMapping {
    const publisher = this.getById(publisherId);
    if (!publisher)
      throw new NotificationPublisherError(`Publisher not found: ${publisherId}`, 404);

    const existingRow = this.stmts.getMapping.get(mappingId) as MappingRow | undefined;
    if (!existingRow || existingRow.publisher_id !== publisherId) {
      throw new NotificationPublisherError(`Mapping not found: ${mappingId}`, 404);
    }

    const message = input.message?.trim() ?? existingRow.message;
    const sourceType =
      input.sourceType ?? (existingRow.source_type as "equipment" | "zone" | "recipe");
    const sourceId = input.sourceId?.trim() ?? existingRow.source_id;
    const sourceKey = input.sourceKey?.trim() ?? existingRow.source_key;
    const throttleMs = input.throttleMs ?? existingRow.throttle_ms;

    try {
      this.stmts.updateMapping.run(
        message,
        sourceType,
        sourceId,
        sourceKey,
        throttleMs,
        mappingId,
        publisherId,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        throw new NotificationPublisherError(
          `Mapping for this source already exists in this publisher`,
          409,
        );
      }
      throw err;
    }

    const row = this.stmts.getMapping.get(mappingId) as MappingRow;
    const mapping = rowToMapping(row);
    this.eventBus.emit({
      type: "notification-publisher.mapping.created",
      publisherId,
      mapping,
    });
    this.logger.info({ publisherId, mappingId }, "Notification publisher mapping updated");
    return mapping;
  }

  removeMapping(publisherId: string, mappingId: string): void {
    const publisher = this.getById(publisherId);
    if (!publisher)
      throw new NotificationPublisherError(`Publisher not found: ${publisherId}`, 404);

    const result = this.stmts.deleteMapping.run(mappingId, publisherId);
    if (result.changes === 0) {
      throw new NotificationPublisherError(`Mapping not found: ${mappingId}`, 404);
    }

    this.eventBus.emit({
      type: "notification-publisher.mapping.removed",
      publisherId,
      mappingId,
    });
    this.logger.info({ publisherId, mappingId }, "Notification publisher mapping removed");
  }
}

// ── Error ────────────────────────────────────────────────────

export class NotificationPublisherError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "NotificationPublisherError";
  }
}
