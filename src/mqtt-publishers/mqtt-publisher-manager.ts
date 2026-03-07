import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import { toISOUtc } from "../core/database.js";
import type {
  MqttPublisher,
  MqttPublisherMapping,
  MqttPublisherWithMappings,
} from "../shared/types.js";

// ── Row types ────────────────────────────────────────────────

interface PublisherRow {
  id: string;
  name: string;
  broker_id: string | null;
  topic: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface MappingRow {
  id: string;
  publisher_id: string;
  publish_key: string;
  source_type: string;
  source_id: string;
  source_key: string;
  created_at: string;
}

// ── Row mappers ──────────────────────────────────────────────

function rowToPublisher(row: PublisherRow): MqttPublisher {
  return {
    id: row.id,
    name: row.name,
    brokerId: row.broker_id,
    topic: row.topic,
    enabled: row.enabled === 1,
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
  };
}

function rowToMapping(row: MappingRow): MqttPublisherMapping {
  return {
    id: row.id,
    publisherId: row.publisher_id,
    publishKey: row.publish_key,
    sourceType: row.source_type as "equipment" | "zone" | "recipe",
    sourceId: row.source_id,
    sourceKey: row.source_key,
    createdAt: toISOUtc(row.created_at),
  };
}

// ── Manager ──────────────────────────────────────────────────

export class MqttPublisherManager {
  private readonly logger;
  private readonly stmts;

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "mqtt-publisher-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      listPublishers: this.db.prepare(`SELECT * FROM mqtt_publishers ORDER BY name`),
      getPublisher: this.db.prepare(`SELECT * FROM mqtt_publishers WHERE id = ?`),
      insertPublisher: this.db.prepare(
        `INSERT INTO mqtt_publishers (id, name, broker_id, topic, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ),
      updatePublisher: this.db.prepare(
        `UPDATE mqtt_publishers SET name = ?, broker_id = ?, topic = ?, enabled = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ),
      deletePublisher: this.db.prepare(`DELETE FROM mqtt_publishers WHERE id = ?`),
      listMappings: this.db.prepare(
        `SELECT * FROM mqtt_publisher_mappings WHERE publisher_id = ? ORDER BY publish_key`,
      ),
      insertMapping: this.db.prepare(
        `INSERT INTO mqtt_publisher_mappings (id, publisher_id, publish_key, source_type, source_id, source_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      ),
      getMapping: this.db.prepare(`SELECT * FROM mqtt_publisher_mappings WHERE id = ?`),
      updateMapping: this.db.prepare(
        `UPDATE mqtt_publisher_mappings SET publish_key = ?, source_type = ?, source_id = ?, source_key = ?
         WHERE id = ? AND publisher_id = ?`,
      ),
      deleteMapping: this.db.prepare(
        `DELETE FROM mqtt_publisher_mappings WHERE id = ? AND publisher_id = ?`,
      ),
      listAllMappings: this.db.prepare(
        `SELECT * FROM mqtt_publisher_mappings ORDER BY publish_key`,
      ),
    };
  }

  // ── Publisher CRUD ───────────────────────────────────────────

  getAll(): MqttPublisher[] {
    const rows = this.stmts.listPublishers.all() as PublisherRow[];
    return rows.map(rowToPublisher);
  }

  getById(id: string): MqttPublisher | null {
    const row = this.stmts.getPublisher.get(id) as PublisherRow | undefined;
    return row ? rowToPublisher(row) : null;
  }

  getAllWithMappings(): MqttPublisherWithMappings[] {
    const publishers = this.getAll();
    return publishers.map((p) => ({
      ...p,
      mappings: this.getMappings(p.id),
    }));
  }

  getByIdWithMappings(id: string): MqttPublisherWithMappings | null {
    const publisher = this.getById(id);
    if (!publisher) return null;
    return { ...publisher, mappings: this.getMappings(id) };
  }

  create(input: {
    name: string;
    brokerId: string | null;
    topic: string;
    enabled?: boolean;
  }): MqttPublisher {
    if (!input.name?.trim()) throw new MqttPublisherError("name is required", 400);
    if (!input.topic?.trim()) throw new MqttPublisherError("topic is required", 400);

    const id = randomUUID();
    const enabled = input.enabled !== false ? 1 : 0;
    this.stmts.insertPublisher.run(
      id,
      input.name.trim(),
      input.brokerId,
      input.topic.trim(),
      enabled,
    );

    const publisher = this.getById(id)!;
    this.eventBus.emit({ type: "mqtt-publisher.created", publisher });
    this.logger.info({ publisherId: id, name: input.name }, "MQTT publisher created");
    return publisher;
  }

  update(
    id: string,
    updates: { name?: string; brokerId?: string | null; topic?: string; enabled?: boolean },
  ): MqttPublisher {
    const existing = this.getById(id);
    if (!existing) throw new MqttPublisherError(`Publisher not found: ${id}`, 404);

    const name = updates.name?.trim() ?? existing.name;
    const brokerId = updates.brokerId !== undefined ? updates.brokerId : existing.brokerId;
    const topic = updates.topic?.trim() ?? existing.topic;
    const enabled =
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled ? 1 : 0;

    this.stmts.updatePublisher.run(name, brokerId, topic, enabled, id);
    const publisher = this.getById(id)!;
    this.eventBus.emit({ type: "mqtt-publisher.updated", publisher });
    this.logger.info({ publisherId: id }, "MQTT publisher updated");
    return publisher;
  }

  delete(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new MqttPublisherError(`Publisher not found: ${id}`, 404);

    this.stmts.deletePublisher.run(id);
    this.eventBus.emit({
      type: "mqtt-publisher.removed",
      publisherId: id,
      publisherName: existing.name,
    });
    this.logger.info({ publisherId: id, name: existing.name }, "MQTT publisher deleted");
  }

  // ── Mapping CRUD ─────────────────────────────────────────────

  getMappings(publisherId: string): MqttPublisherMapping[] {
    const rows = this.stmts.listMappings.all(publisherId) as MappingRow[];
    return rows.map(rowToMapping);
  }

  addMapping(
    publisherId: string,
    input: {
      publishKey: string;
      sourceType: "equipment" | "zone" | "recipe";
      sourceId: string;
      sourceKey: string;
    },
  ): MqttPublisherMapping {
    const publisher = this.getById(publisherId);
    if (!publisher) throw new MqttPublisherError(`Publisher not found: ${publisherId}`, 404);
    if (!input.publishKey?.trim()) throw new MqttPublisherError("publishKey is required", 400);
    if (!input.sourceId?.trim()) throw new MqttPublisherError("sourceId is required", 400);
    if (!input.sourceKey?.trim()) throw new MqttPublisherError("sourceKey is required", 400);
    if (
      input.sourceType !== "equipment" &&
      input.sourceType !== "zone" &&
      input.sourceType !== "recipe"
    ) {
      throw new MqttPublisherError("sourceType must be 'equipment', 'zone', or 'recipe'", 400);
    }

    const id = randomUUID();
    try {
      this.stmts.insertMapping.run(
        id,
        publisherId,
        input.publishKey.trim(),
        input.sourceType,
        input.sourceId.trim(),
        input.sourceKey.trim(),
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        throw new MqttPublisherError(
          `Publish key '${input.publishKey}' already exists in this publisher`,
          409,
        );
      }
      throw err;
    }

    const row = this.stmts.getMapping.get(id) as MappingRow;
    const mapping = rowToMapping(row);
    this.eventBus.emit({
      type: "mqtt-publisher.mapping.created",
      publisherId,
      mapping,
    });
    this.logger.info(
      { publisherId, mappingId: id, publishKey: input.publishKey },
      "MQTT publisher mapping added",
    );
    return mapping;
  }

  updateMapping(
    publisherId: string,
    mappingId: string,
    input: {
      publishKey?: string;
      sourceType?: "equipment" | "zone" | "recipe";
      sourceId?: string;
      sourceKey?: string;
    },
  ): MqttPublisherMapping {
    const publisher = this.getById(publisherId);
    if (!publisher) throw new MqttPublisherError(`Publisher not found: ${publisherId}`, 404);

    const existingRow = this.stmts.getMapping.get(mappingId) as MappingRow | undefined;
    if (!existingRow || existingRow.publisher_id !== publisherId) {
      throw new MqttPublisherError(`Mapping not found: ${mappingId}`, 404);
    }

    const publishKey = input.publishKey?.trim() ?? existingRow.publish_key;
    const sourceType =
      input.sourceType ?? (existingRow.source_type as "equipment" | "zone" | "recipe");
    const sourceId = input.sourceId?.trim() ?? existingRow.source_id;
    const sourceKey = input.sourceKey?.trim() ?? existingRow.source_key;

    try {
      this.stmts.updateMapping.run(
        publishKey,
        sourceType,
        sourceId,
        sourceKey,
        mappingId,
        publisherId,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        throw new MqttPublisherError(
          `Publish key '${publishKey}' already exists in this publisher`,
          409,
        );
      }
      throw err;
    }

    const row = this.stmts.getMapping.get(mappingId) as MappingRow;
    const mapping = rowToMapping(row);
    this.eventBus.emit({
      type: "mqtt-publisher.mapping.created",
      publisherId,
      mapping,
    });
    this.logger.info({ publisherId, mappingId, publishKey }, "MQTT publisher mapping updated");
    return mapping;
  }

  removeMapping(publisherId: string, mappingId: string): void {
    const publisher = this.getById(publisherId);
    if (!publisher) throw new MqttPublisherError(`Publisher not found: ${publisherId}`, 404);

    const result = this.stmts.deleteMapping.run(mappingId, publisherId);
    if (result.changes === 0) {
      throw new MqttPublisherError(`Mapping not found: ${mappingId}`, 404);
    }

    this.eventBus.emit({
      type: "mqtt-publisher.mapping.removed",
      publisherId,
      mappingId,
    });
    this.logger.info({ publisherId, mappingId }, "MQTT publisher mapping removed");
  }
}

// ── Error ────────────────────────────────────────────────────

export class MqttPublisherError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MqttPublisherError";
  }
}
