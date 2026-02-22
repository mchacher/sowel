import type Database from "better-sqlite3";

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

/**
 * Manages key-value settings stored in SQLite.
 * Integration settings (MQTT, Z2M) are configured from the UI.
 */
export class SettingsManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Get a single setting value, or undefined if not set. */
  get(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  /** Get all settings as a key-value record. */
  getAll(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as SettingRow[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /** Get all settings that start with a given prefix. */
  getByPrefix(prefix: string): Record<string, string> {
    const rows = this.db
      .prepare("SELECT key, value FROM settings WHERE key LIKE ?")
      .all(`${prefix}%`) as SettingRow[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /** Set a single setting. */
  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value);
  }

  /** Set multiple settings at once. */
  setMany(entries: Record<string, string>): void {
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const tx = this.db.transaction(() => {
      for (const [key, value] of Object.entries(entries)) {
        stmt.run(key, value);
      }
    });
    tx();
  }

  /** Returns true if MQTT integration has been configured from the UI. */
  isMqttConfigured(): boolean {
    return this.get("integration.zigbee2mqtt.mqtt_url") !== undefined;
  }

  /** Get MQTT connection config from settings (used by Zigbee2MQTT integration). */
  getMqttConfig(): {
    url: string;
    username?: string;
    password?: string;
    clientId: string;
  } {
    const prefix = "integration.zigbee2mqtt.";
    return {
      url: this.get(`${prefix}mqtt_url`) ?? "mqtt://localhost:1883",
      username: this.get(`${prefix}mqtt_username`) || undefined,
      password: this.get(`${prefix}mqtt_password`) || undefined,
      clientId: this.get(`${prefix}mqtt_client_id`) ?? "corbel",
    };
  }

  /** Get Zigbee2mqtt config from settings. */
  getZ2mConfig(): { baseTopic: string } {
    return {
      baseTopic: this.get("integration.zigbee2mqtt.base_topic") ?? "zigbee2mqtt",
    };
  }
}
