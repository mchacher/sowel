import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import archiver from "archiver";
import AdmZip from "adm-zip";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { Logger } from "../../core/logger.js";
import type { InfluxClient } from "../../core/influx-client.js";

interface BackupDeps {
  db: Database.Database;
  influxClient: InfluxClient;
  logger: Logger;
  dataDir: string; // path to data/ directory
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
  "notification_publishers",
  "notification_publisher_mappings",
  "dashboard_widgets",
  "plugins",
] as const;

// Reverse order for deletion (children first)
const DELETE_ORDER = [...BACKUP_TABLES].reverse();

// Exclude these files from data/ backup (managed separately or transient)
const DATA_FILES_EXCLUDE = new Set(["sowel.db", "sowel.db-wal", "sowel.db-shm", "sowel.pid"]);
const DATA_FILES_EXCLUDE_EXT = new Set([".db", ".pid", ".log"]);

/** Scan data/ directory for files to include in backup (tokens, secrets, etc.) */
function scanDataFiles(dataDir: string): string[] {
  if (!existsSync(dataDir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (DATA_FILES_EXCLUDE.has(entry.name)) continue;
    const ext = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".")) : "";
    if (DATA_FILES_EXCLUDE_EXT.has(ext)) continue;
    files.push(entry.name);
  }
  return files;
}

interface BackupPayload {
  version: 2;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

// InfluxDB bucket definitions for export/restore
interface InfluxBucketDef {
  filename: string;
  bucketSuffix: string; // "" for raw, "-hourly", "-daily", etc.
  range: string;
}

const INFLUX_BUCKETS: InfluxBucketDef[] = [
  { filename: "influx-raw.lp", bucketSuffix: "", range: "-7d" },
  { filename: "influx-hourly.lp", bucketSuffix: "-hourly", range: "-90d" },
  { filename: "influx-daily.lp", bucketSuffix: "-daily", range: "-5y" },
  { filename: "influx-energy-hourly.lp", bucketSuffix: "-energy-hourly", range: "-2y" },
  { filename: "influx-energy-daily.lp", bucketSuffix: "-energy-daily", range: "-10y" },
];

/**
 * Convert a Flux query result row to InfluxDB line protocol.
 * Format: measurement,tag1=val1,tag2=val2 field1=value1,field2="str" timestamp_ns
 */
function rowToLineProtocol(row: Record<string, string>): string | null {
  const measurement = row["_measurement"];
  const field = row["_field"];
  const value = row["_value"];
  const time = row["_time"];

  if (!measurement || !field || value === undefined || value === "" || !time) return null;

  // Collect tags (skip internal Flux columns)
  const skipKeys = new Set([
    "_measurement",
    "_field",
    "_value",
    "_time",
    "_start",
    "_stop",
    "result",
    "table",
    "",
  ]);
  const tags: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (skipKeys.has(k) || v === undefined || v === "") continue;
    tags.push(`${escapeTag(k)}=${escapeTag(v)}`);
  }

  // Build tag set
  const tagSet = tags.length > 0 ? `,${tags.join(",")}` : "";

  // Build field value: try number first, then string
  const numVal = Number(value);
  const fieldValue =
    !isNaN(numVal) && value.trim() !== "" ? `${numVal}` : `"${escapeFieldString(value)}"`;

  // Convert ISO timestamp to nanoseconds
  const tsNs = new Date(time).getTime() * 1_000_000;

  return `${escapeTag(measurement)}${tagSet} ${escapeTag(field)}=${fieldValue} ${tsNs}`;
}

function escapeTag(s: string): string {
  return s.replace(/,/g, "\\,").replace(/ /g, "\\ ").replace(/=/g, "\\=");
}

function escapeFieldString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function registerBackupRoutes(app: FastifyInstance, deps: BackupDeps): void {
  const { db, influxClient, logger: parentLogger, dataDir } = deps;
  const logger = parentLogger.child({ module: "backup" });

  // ============================================================
  // GET /api/v1/backup — Export full system as ZIP
  // ============================================================
  app.get("/api/v1/backup", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    // 1. Collect SQLite data
    const tables: Record<string, unknown[]> = {};
    let totalRows = 0;
    for (const table of BACKUP_TABLES) {
      tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
      totalRows += tables[table].length;
    }

    const sqlitePayload: BackupPayload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      tables,
    };

    logger.info(
      { tables: BACKUP_TABLES.length, totalRows },
      "Backup export — SQLite data collected",
    );

    // 2. Build ZIP
    const archive = archiver("zip", { zlib: { level: 6 } });
    const dateStr = new Date().toISOString().slice(0, 10);

    reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="sowel-backup-${dateStr}.zip"`);

    // Append SQLite JSON
    archive.append(JSON.stringify(sqlitePayload, null, 2), { name: "sowel-backup.json" });

    // 3. Export InfluxDB buckets as line protocol
    const influxConfig = influxClient.getConfig();
    if (influxClient.isConnected() && influxConfig) {
      const client = influxClient.getClient();
      if (client) {
        const queryApi = client.getQueryApi(influxConfig.org);

        for (const bucketDef of INFLUX_BUCKETS) {
          try {
            const bucket = `${influxConfig.bucket}${bucketDef.bucketSuffix}`;
            const flux = `from(bucket: "${bucket}") |> range(start: ${bucketDef.range})`;

            const rows = await queryApi.collectRows<Record<string, string>>(flux);
            if (rows.length === 0) continue;

            const lines: string[] = [];
            for (const row of rows) {
              const line = rowToLineProtocol(row);
              if (line) lines.push(line);
            }

            if (lines.length > 0) {
              archive.append(lines.join("\n"), { name: bucketDef.filename });
              logger.debug(
                { bucket, lines: lines.length },
                "InfluxDB bucket exported as line protocol",
              );
            }
          } catch (err) {
            logger.warn({ err, filename: bucketDef.filename }, "Failed to export InfluxDB bucket");
          }
        }
      }
    }

    // 4. Append data files (tokens, JWT secret — dynamically scanned)
    const dataFiles = scanDataFiles(dataDir);
    for (const filename of dataFiles) {
      const filePath = resolve(dataDir, filename);
      if (existsSync(filePath)) {
        try {
          archive.append(readFileSync(filePath), { name: `data/${filename}` });
        } catch (err) {
          logger.warn({ err, filename }, "Failed to include data file in backup");
        }
      }
    }

    logger.info("Backup export completed — ZIP archive ready");
    archive.finalize();

    return reply.send(archive);
  });

  // ============================================================
  // POST /api/v1/backup — Restore from ZIP
  // ============================================================
  app.post("/api/v1/backup", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    // Accept multipart/form-data with a ZIP file
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    const buffer = await data.toBuffer();
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      return reply.code(400).send({ error: "Invalid ZIP file" });
    }

    // 1. Extract and validate SQLite payload
    const jsonEntry = zip.getEntry("sowel-backup.json");
    if (!jsonEntry) {
      return reply.code(400).send({ error: "ZIP missing sowel-backup.json" });
    }

    let payload: BackupPayload;
    try {
      payload = JSON.parse(jsonEntry.getData().toString("utf-8")) as BackupPayload;
    } catch {
      return reply.code(400).send({ error: "Invalid JSON in sowel-backup.json" });
    }

    if (!payload || payload.version !== 2 || !payload.tables) {
      return reply.code(400).send({ error: "Invalid backup format (expected version 2)" });
    }

    // Validate table names
    for (const tableName of Object.keys(payload.tables)) {
      if (!(BACKUP_TABLES as readonly string[]).includes(tableName)) {
        return reply.code(400).send({ error: `Unknown table: ${tableName}` });
      }
      if (!Array.isArray(payload.tables[tableName])) {
        return reply.code(400).send({ error: `Table ${tableName} must be an array` });
      }
    }

    // 2. Restore SQLite
    try {
      // Must be outside transaction — SQLite ignores this PRAGMA inside transactions
      db.pragma("foreign_keys = OFF");

      const restore = db.transaction(() => {
        for (const table of DELETE_ORDER) {
          db.prepare(`DELETE FROM ${table}`).run();
        }

        for (const table of BACKUP_TABLES) {
          const rows = payload.tables[table];
          if (!rows || rows.length === 0) continue;

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
      db.pragma("foreign_keys = ON");

      const totalRestoredRows = Object.values(payload.tables).reduce(
        (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
        0,
      );
      logger.info(
        { tables: Object.keys(payload.tables).length, totalRows: totalRestoredRows },
        "SQLite data restored",
      );
    } catch (err) {
      logger.error({ err }, "SQLite restore failed");
      db.pragma("foreign_keys = ON");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "SQLite restore failed",
      });
    }

    // 3. Restore InfluxDB line protocol files
    let influxPointsRestored = 0;
    const influxConfig = influxClient.getConfig();
    if (influxClient.isConnected() && influxConfig) {
      for (const bucketDef of INFLUX_BUCKETS) {
        const entry = zip.getEntry(bucketDef.filename);
        if (!entry) continue;

        const lp = entry.getData().toString("utf-8").trim();
        if (!lp) continue;

        const bucket = `${influxConfig.bucket}${bucketDef.bucketSuffix}`;
        try {
          const lines = lp.split("\n");
          // Write in batches of 5000 lines via HTTP API
          const batchSize = 5000;
          for (let i = 0; i < lines.length; i += batchSize) {
            const batch = lines.slice(i, i + batchSize).join("\n");
            const resp = await fetch(
              `${influxConfig.url}/api/v2/write?org=${encodeURIComponent(influxConfig.org)}&bucket=${encodeURIComponent(bucket)}&precision=ns`,
              {
                method: "POST",
                headers: {
                  Authorization: `Token ${influxConfig.token}`,
                  "Content-Type": "text/plain",
                },
                body: batch,
              },
            );
            if (!resp.ok) {
              const text = await resp.text();
              logger.warn(
                { bucket, status: resp.status, body: text.slice(0, 200) },
                "InfluxDB write batch failed",
              );
            }
          }
          influxPointsRestored += lines.length;
          logger.debug({ bucket, lines: lines.length }, "InfluxDB bucket restored");
        } catch (err) {
          logger.warn({ err, bucket }, "Failed to restore InfluxDB bucket");
        }
      }

      if (influxPointsRestored > 0) {
        logger.info({ points: influxPointsRestored }, "InfluxDB data restored");
      }
    } else {
      logger.warn("InfluxDB not connected — skipping time-series restore");
    }

    // 4. Restore data files (extract all data/* entries from ZIP)
    let filesRestored = 0;
    for (const entry of zip.getEntries()) {
      if (!entry.entryName.startsWith("data/") || entry.isDirectory) continue;
      const filename = entry.entryName.slice("data/".length);
      if (!filename || DATA_FILES_EXCLUDE.has(filename)) continue;

      try {
        const filePath = resolve(dataDir, filename);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, entry.getData());
        filesRestored++;
        logger.debug({ filename }, "Data file restored");
      } catch (err) {
        logger.warn({ err, filename }, "Failed to restore data file");
      }
    }

    if (filesRestored > 0) {
      logger.info({ filesRestored }, "Data files restored");
    }

    logger.info(
      { exportedAt: payload.exportedAt, influxPointsRestored, filesRestored },
      "Backup restore completed — restart server to reload",
    );

    return {
      success: true,
      restoredAt: new Date().toISOString(),
      influxPointsRestored,
      filesRestored,
      restartRequired: true,
    };
  });
}
