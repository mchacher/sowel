import archiver from "archiver";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { Logger } from "../../core/logger.js";
import type { HistoryWriter } from "../../history/history-writer.js";

interface BackupDeps {
  db: Database.Database;
  historyWriter: HistoryWriter;
  logger: Logger;
}

// Tables to export, in dependency order (parents first)
const BACKUP_TABLES = [
  "settings",
  "zones",
  "devices",
  "device_data",
  "device_orders",
  "equipments",
  "data_bindings",
  "order_bindings",
  "users",
  "api_tokens",
  "recipe_instances",
  "recipe_state",
  "modes",
  "zone_mode_impacts",
  "calendar_profiles",
  "calendar_slots",
  "button_action_bindings",
  "mqtt_brokers",
  "mqtt_publishers",
  "mqtt_publisher_mappings",
  "chart_configs",
] as const;

// Reverse order for deletion (children first)
const DELETE_ORDER = [...BACKUP_TABLES].reverse();

interface BackupPayload {
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export function registerBackupRoutes(app: FastifyInstance, deps: BackupDeps): void {
  const { db, historyWriter, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "backup" });

  // GET /api/v1/backup — Export full configuration as ZIP (SQLite JSON + InfluxDB CSV)
  app.get("/api/v1/backup", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    // Build SQLite JSON payload
    const tables: Record<string, unknown[]> = {};
    let totalRows = 0;
    for (const table of BACKUP_TABLES) {
      tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
      totalRows += tables[table].length;
    }
    logger.info(
      { tables: BACKUP_TABLES.length, totalRows },
      "Backup export — SQLite data collected",
    );

    const sqlitePayload: BackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tables,
    };

    // Export InfluxDB data if connected
    const influxClient = historyWriter.getInfluxClient();
    const influxConfig = influxClient.getConfig();
    const influxConnected = influxClient.isConnected() && influxConfig;

    const influxCsvs: { name: string; csv: string }[] = [];
    if (influxConnected) {
      const client = influxClient.getClient();
      if (client) {
        const queryApi = client.getQueryApi(influxConfig.org);
        const buckets = [
          { name: "influx-raw.csv", bucket: influxConfig.bucket, range: "-7d" },
          { name: "influx-hourly.csv", bucket: `${influxConfig.bucket}-hourly`, range: "-90d" },
          { name: "influx-daily.csv", bucket: `${influxConfig.bucket}-daily`, range: "-5y" },
        ];

        for (const b of buckets) {
          try {
            const flux = `from(bucket: "${b.bucket}")
  |> range(start: ${b.range})
  |> filter(fn: (r) => r._measurement == "equipment_data")`;

            const csv = await queryApi.queryRaw(flux);

            if (csv.trim().length > 0) {
              influxCsvs.push({ name: b.name, csv });
            }
          } catch (err) {
            logger.warn({ err, bucket: b.bucket }, "Failed to export InfluxDB bucket");
          }
        }
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10);

    // If no InfluxDB data, return JSON directly (backward compatible)
    if (influxCsvs.length === 0) {
      logger.info("Configuration exported (JSON only, no InfluxDB data)");
      return reply
        .header("Content-Disposition", `attachment; filename="sowel-backup-${dateStr}.json"`)
        .send(sqlitePayload);
    }

    // Build ZIP archive with SQLite JSON + InfluxDB CSVs
    logger.info(
      { influxFiles: influxCsvs.map((f) => f.name) },
      "Configuration exported (ZIP with InfluxDB data)",
    );

    const archive = archiver("zip", { zlib: { level: 6 } });

    reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="sowel-backup-${dateStr}.zip"`);

    // Append SQLite JSON
    archive.append(JSON.stringify(sqlitePayload, null, 2), {
      name: "sowel-backup.json",
    });

    // Append InfluxDB CSVs
    for (const f of influxCsvs) {
      archive.append(f.csv, { name: f.name });
    }

    archive.finalize();

    return reply.send(archive);
  });

  // POST /api/v1/backup — Restore configuration from JSON
  app.post<{ Body: BackupPayload }>("/api/v1/backup", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const payload = request.body;

    // Validate structure
    if (!payload || payload.version !== 1 || !payload.tables) {
      return reply.code(400).send({ error: "Invalid backup format" });
    }

    // Validate that all tables in the payload are known
    for (const tableName of Object.keys(payload.tables)) {
      if (!(BACKUP_TABLES as readonly string[]).includes(tableName)) {
        return reply.code(400).send({ error: `Unknown table: ${tableName}` });
      }
      if (!Array.isArray(payload.tables[tableName])) {
        return reply.code(400).send({ error: `Table ${tableName} must be an array` });
      }
    }

    try {
      const restore = db.transaction(() => {
        // Disable foreign keys during restore
        db.pragma("foreign_keys = OFF");

        // Delete all data in reverse dependency order
        for (const table of DELETE_ORDER) {
          db.prepare(`DELETE FROM ${table}`).run();
        }

        // Insert data in dependency order
        for (const table of BACKUP_TABLES) {
          const rows = payload.tables[table];
          if (!rows || rows.length === 0) continue;

          // Get column names from the first row
          const firstRow = rows[0] as Record<string, unknown>;
          const columns = Object.keys(firstRow);
          const placeholders = columns.map(() => "?").join(", ");
          const stmt = db.prepare(
            `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          );

          for (const row of rows) {
            const r = row as Record<string, unknown>;
            stmt.run(...columns.map((col) => r[col] ?? null));
          }
        }

        // Re-enable foreign keys and verify integrity
        db.pragma("foreign_keys = ON");

        const violations = db.pragma("foreign_key_check") as {
          table: string;
          rowid: number;
          parent: string;
          fkid: number;
        }[];

        if (violations.length > 0) {
          const details = violations
            .slice(0, 10)
            .map((v) => `${v.table} row ${v.rowid} → ${v.parent}`);
          throw new Error(
            `FK integrity check failed: ${violations.length} violation(s). ${details.join("; ")}`,
          );
        }
      });

      restore();

      const totalRestoredRows = Object.values(payload.tables).reduce(
        (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
        0,
      );
      logger.info(
        {
          tables: Object.keys(payload.tables).length,
          totalRows: totalRestoredRows,
          exportedAt: payload.exportedAt,
        },
        "Configuration restored from backup",
      );

      return { success: true, restoredAt: new Date().toISOString() };
    } catch (err) {
      logger.error({ err }, "Backup restore failed");
      // Re-enable foreign keys even on error
      db.pragma("foreign_keys = ON");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Restore failed",
      });
    }
  });
}
