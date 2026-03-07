import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import { toISOUtc } from "../core/database.js";
import type { MqttBroker } from "../shared/types.js";

// ── Row types ────────────────────────────────────────────────

interface BrokerRow {
  id: string;
  name: string;
  url: string;
  username: string | null;
  password: string | null;
  created_at: string;
  updated_at: string;
}

// ── Row mapper ───────────────────────────────────────────────

function rowToBroker(row: BrokerRow): MqttBroker {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    username: row.username ?? undefined,
    password: row.password ?? undefined,
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
  };
}

// ── Manager ──────────────────────────────────────────────────

export class MqttBrokerManager {
  private readonly logger;
  private readonly stmts;

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "mqtt-broker-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      listBrokers: this.db.prepare(`SELECT * FROM mqtt_brokers ORDER BY name`),
      getBroker: this.db.prepare(`SELECT * FROM mqtt_brokers WHERE id = ?`),
      insertBroker: this.db.prepare(
        `INSERT INTO mqtt_brokers (id, name, url, username, password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ),
      updateBroker: this.db.prepare(
        `UPDATE mqtt_brokers SET name = ?, url = ?, username = ?, password = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ),
      deleteBroker: this.db.prepare(`DELETE FROM mqtt_brokers WHERE id = ?`),
      countPublishers: this.db.prepare(
        `SELECT COUNT(*) as count FROM mqtt_publishers WHERE broker_id = ?`,
      ),
    };
  }

  // ── CRUD ──────────────────────────────────────────────────

  getAll(): MqttBroker[] {
    const rows = this.stmts.listBrokers.all() as BrokerRow[];
    return rows.map(rowToBroker);
  }

  getById(id: string): MqttBroker | null {
    const row = this.stmts.getBroker.get(id) as BrokerRow | undefined;
    return row ? rowToBroker(row) : null;
  }

  create(input: { name: string; url: string; username?: string; password?: string }): MqttBroker {
    if (!input.name?.trim()) throw new MqttBrokerError("name is required", 400);
    if (!input.url?.trim()) throw new MqttBrokerError("url is required", 400);

    const id = randomUUID();
    this.stmts.insertBroker.run(
      id,
      input.name.trim(),
      input.url.trim(),
      input.username?.trim() || null,
      input.password || null,
    );

    const broker = this.getById(id)!;
    this.eventBus.emit({ type: "mqtt-broker.created", broker });
    this.logger.info({ brokerId: id, name: input.name }, "MQTT broker created");
    return broker;
  }

  update(
    id: string,
    updates: { name?: string; url?: string; username?: string; password?: string },
  ): MqttBroker {
    const existing = this.getById(id);
    if (!existing) throw new MqttBrokerError(`Broker not found: ${id}`, 404);

    const name = updates.name?.trim() ?? existing.name;
    const url = updates.url?.trim() ?? existing.url;
    const username =
      updates.username !== undefined
        ? updates.username.trim() || null
        : (existing.username ?? null);
    const password =
      updates.password !== undefined ? updates.password || null : (existing.password ?? null);

    this.stmts.updateBroker.run(name, url, username, password, id);
    const broker = this.getById(id)!;
    this.eventBus.emit({ type: "mqtt-broker.updated", broker });
    this.logger.info({ brokerId: id }, "MQTT broker updated");
    return broker;
  }

  delete(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new MqttBrokerError(`Broker not found: ${id}`, 404);

    // Block deletion if publishers reference this broker
    const { count } = this.stmts.countPublishers.get(id) as { count: number };
    if (count > 0) {
      throw new MqttBrokerError(
        `Cannot delete broker: ${count} publisher(s) still reference it`,
        409,
      );
    }

    this.stmts.deleteBroker.run(id);
    this.eventBus.emit({ type: "mqtt-broker.removed", brokerId: id });
    this.logger.info({ brokerId: id, name: existing.name }, "MQTT broker deleted");
  }
}

// ── Error ────────────────────────────────────────────────────

export class MqttBrokerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MqttBrokerError";
  }
}
