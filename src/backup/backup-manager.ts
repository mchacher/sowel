import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import archiver from "archiver";
import AdmZip from "adm-zip";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { InfluxClient } from "../core/influx-client.js";

export interface BackupManagerDeps {
  db: Database.Database;
  influxClient: InfluxClient;
  logger: Logger;
  dataDir: string; // path to data/ directory
}

// Tables to export, in dependency order (parents first)
export const BACKUP_TABLES = [
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
  "refresh_tokens",
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

// Reverse order for deletion (children first) + tables not exported but must be cleared
const DELETE_ORDER = ["recipe_log", ...[...BACKUP_TABLES].reverse()];

// Exclude these files from data/ backup (managed separately or transient)
const DATA_FILES_EXCLUDE = new Set(["sowel.db", "sowel.db-wal", "sowel.db-shm", "sowel.pid"]);
const DATA_FILES_EXCLUDE_EXT = new Set([".db", ".pid", ".log"]);

// Local backups subdirectory inside dataDir
const LOCAL_BACKUPS_SUBDIR = "backups";

interface BackupPayload {
  version: 2;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

// InfluxDB bucket definitions for export/restore
interface InfluxBucketDef {
  filename: string;
  bucketSuffix: string;
  range: string;
}

const INFLUX_BUCKETS: InfluxBucketDef[] = [
  { filename: "influx-raw.lp", bucketSuffix: "", range: "-7d" },
  { filename: "influx-hourly.lp", bucketSuffix: "-hourly", range: "-90d" },
  { filename: "influx-daily.lp", bucketSuffix: "-daily", range: "-5y" },
  { filename: "influx-energy-hourly.lp", bucketSuffix: "-energy-hourly", range: "-2y" },
  { filename: "influx-energy-daily.lp", bucketSuffix: "-energy-daily", range: "-10y" },
];

export interface LocalBackup {
  filename: string;
  size: number;
  createdAt: string;
}

export interface RestoreResult {
  success: true;
  restoredAt: string;
  influxPointsRestored: number;
  filesRestored: number;
  restartRequired: true;
}

/**
 * BackupManager — central service for exporting and restoring Sowel state.
 *
 * Used by:
 * - HTTP routes (POST/GET /api/v1/backup, /api/v1/backup/local, /api/v1/backup/restore-local)
 * - UpdateManager (auto backup before self-update)
 */
export class BackupManager {
  private db: Database.Database;
  private influxClient: InfluxClient;
  private logger: Logger;
  private dataDir: string;

  constructor(deps: BackupManagerDeps) {
    this.db = deps.db;
    this.influxClient = deps.influxClient;
    this.logger = deps.logger.child({ module: "backup-manager" });
    this.dataDir = deps.dataDir;
  }

  // ============================================================
  // EXPORT
  // ============================================================

  /**
   * Build a ZIP archive containing the full system backup.
   * Returns the archiver stream — caller is responsible for piping or finalizing.
   *
   * NOTE: this method finalizes the archive itself once everything has been
   * appended; the caller can pipe it to a response or to a file write stream
   * BEFORE calling this method.
   */
  async buildArchive(archive: archiver.Archiver): Promise<void> {
    // 1. Collect SQLite data
    const tables: Record<string, unknown[]> = {};
    let totalRows = 0;
    for (const table of BACKUP_TABLES) {
      tables[table] = this.db.prepare(`SELECT * FROM ${table}`).all();
      totalRows += tables[table].length;
    }

    const sqlitePayload: BackupPayload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      tables,
    };

    this.logger.info(
      { tables: BACKUP_TABLES.length, totalRows },
      "Backup export — SQLite data collected",
    );

    // 2. Append SQLite JSON
    archive.append(JSON.stringify(sqlitePayload, null, 2), { name: "sowel-backup.json" });

    // 3. Export InfluxDB buckets as line protocol
    const influxConfig = this.influxClient.getConfig();
    if (this.influxClient.isConnected() && influxConfig) {
      const client = this.influxClient.getClient();
      if (client) {
        const queryApi = client.getQueryApi(influxConfig.org);

        for (const bucketDef of INFLUX_BUCKETS) {
          try {
            const bucket = `${influxConfig.bucket}${bucketDef.bucketSuffix}`;
            const flux = `from(bucket: "${bucket}") |> range(start: ${bucketDef.range})`;

            const rows = await queryApi.collectRows<Record<string, unknown>>(flux);
            if (rows.length === 0) continue;

            const lines: string[] = [];
            for (const row of rows) {
              const line = rowToLineProtocol(row);
              if (line) lines.push(line);
            }

            if (lines.length > 0) {
              archive.append(lines.join("\n"), { name: bucketDef.filename });
              this.logger.debug(
                { bucket, lines: lines.length },
                "InfluxDB bucket exported as line protocol",
              );
            }
          } catch (err) {
            this.logger.warn(
              { err, filename: bucketDef.filename },
              "Failed to export InfluxDB bucket",
            );
          }
        }
      }
    }

    // 4. Append data files (tokens, JWT secret — dynamically scanned)
    const dataFiles = scanDataFiles(this.dataDir);
    for (const filename of dataFiles) {
      const filePath = resolve(this.dataDir, filename);
      if (existsSync(filePath)) {
        try {
          archive.append(readFileSync(filePath), { name: `data/${filename}` });
        } catch (err) {
          this.logger.warn({ err, filename }, "Failed to include data file in backup");
        }
      }
    }

    this.logger.info("Backup export completed — ZIP archive ready");
  }

  /**
   * Export the full backup to a file in `data/backups/`.
   * Used by UpdateManager (auto backup before update) and future cron backups.
   */
  async exportToFile(filename: string): Promise<{ path: string; size: number }> {
    const backupsDir = resolve(this.dataDir, LOCAL_BACKUPS_SUBDIR);
    mkdirSync(backupsDir, { recursive: true, mode: 0o700 });

    const fullPath = resolve(backupsDir, filename);

    const archive = archiver("zip", { zlib: { level: 6 } });
    const { createWriteStream } = await import("node:fs");
    const output = createWriteStream(fullPath);

    const finished = new Promise<void>((resolvePromise, rejectPromise) => {
      output.on("close", () => resolvePromise());
      output.on("error", (err) => rejectPromise(err));
      archive.on("error", (err) => rejectPromise(err));
    });

    archive.pipe(output);
    await this.buildArchive(archive);
    await archive.finalize();
    await finished;

    const size = statSync(fullPath).size;
    this.logger.info({ filename, size }, "Backup exported to local file");
    return { path: fullPath, size };
  }

  // ============================================================
  // RESTORE
  // ============================================================

  async restoreFromBuffer(buffer: Buffer): Promise<RestoreResult> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new Error("Invalid ZIP file");
    }

    return this.restoreFromZip(zip);
  }

  async restoreFromFile(filename: string): Promise<RestoreResult> {
    // Reject path traversal
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      throw new Error("Invalid filename");
    }

    const backupsDir = resolve(this.dataDir, LOCAL_BACKUPS_SUBDIR);
    const fullPath = resolve(backupsDir, filename);
    if (!existsSync(fullPath)) {
      throw new Error(`Backup file not found: ${filename}`);
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(fullPath);
    } catch {
      throw new Error("Invalid ZIP file");
    }

    this.logger.info({ filename }, "Restoring from local backup file");
    return this.restoreFromZip(zip);
  }

  private async restoreFromZip(zip: AdmZip): Promise<RestoreResult> {
    // 1. Extract and validate SQLite payload
    const jsonEntry = zip.getEntry("sowel-backup.json");
    if (!jsonEntry) {
      throw new Error("ZIP missing sowel-backup.json");
    }

    let payload: BackupPayload;
    try {
      payload = JSON.parse(jsonEntry.getData().toString("utf-8")) as BackupPayload;
    } catch {
      throw new Error("Invalid JSON in sowel-backup.json");
    }

    if (!payload || payload.version !== 2 || !payload.tables) {
      throw new Error("Invalid backup format (expected version 2)");
    }

    // Validate table names
    for (const tableName of Object.keys(payload.tables)) {
      if (!(BACKUP_TABLES as readonly string[]).includes(tableName)) {
        throw new Error(`Unknown table: ${tableName}`);
      }
      if (!Array.isArray(payload.tables[tableName])) {
        throw new Error(`Table ${tableName} must be an array`);
      }
    }

    // 2. Restore SQLite
    try {
      // Must be outside transaction — SQLite ignores this PRAGMA inside transactions
      this.db.pragma("foreign_keys = OFF");

      const restore = this.db.transaction(() => {
        for (const table of DELETE_ORDER) {
          this.db.prepare(`DELETE FROM ${table}`).run();
        }

        for (const table of BACKUP_TABLES) {
          const rows = payload.tables[table];
          if (!rows || rows.length === 0) continue;

          const firstRow = rows[0] as Record<string, unknown>;
          const columns = Object.keys(firstRow);
          const placeholders = columns.map(() => "?").join(", ");
          const stmt = this.db.prepare(
            `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          );

          for (const row of rows) {
            const r = row as Record<string, unknown>;
            stmt.run(...columns.map((col) => r[col] ?? null));
          }
        }

        const violations = this.db.pragma("foreign_key_check") as {
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
      this.db.pragma("foreign_keys = ON");

      const totalRestoredRows = Object.values(payload.tables).reduce(
        (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
        0,
      );
      this.logger.info(
        { tables: Object.keys(payload.tables).length, totalRows: totalRestoredRows },
        "SQLite data restored",
      );
    } catch (err) {
      this.logger.error({ err }, "SQLite restore failed");
      this.db.pragma("foreign_keys = ON");
      throw err;
    }

    // 3. Restore InfluxDB line protocol files
    let influxPointsRestored = 0;
    const influxConfig = this.influxClient.getConfig();
    if (this.influxClient.isConnected() && influxConfig) {
      // Ensure all buckets exist before writing (critical for fresh InfluxDB)
      try {
        await this.influxClient.ensureBuckets();
        await this.influxClient.ensureEnergyBuckets();
      } catch (err) {
        this.logger.warn({ err }, "Failed to ensure InfluxDB buckets before restore");
      }
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
              this.logger.warn(
                { bucket, status: resp.status, body: text.slice(0, 200) },
                "InfluxDB write batch failed",
              );
            }
          }
          influxPointsRestored += lines.length;
          this.logger.debug({ bucket, lines: lines.length }, "InfluxDB bucket restored");
        } catch (err) {
          this.logger.warn({ err, bucket }, "Failed to restore InfluxDB bucket");
        }
      }

      if (influxPointsRestored > 0) {
        this.logger.info({ points: influxPointsRestored }, "InfluxDB data restored");
      }
    } else {
      this.logger.warn("InfluxDB not connected — skipping time-series restore");
    }

    // 4. Restore data files (extract all data/* entries from ZIP)
    let filesRestored = 0;
    for (const entry of zip.getEntries()) {
      if (!entry.entryName.startsWith("data/") || entry.isDirectory) continue;
      const filename = entry.entryName.slice("data/".length);
      if (!filename || DATA_FILES_EXCLUDE.has(filename)) continue;

      try {
        const filePath = resolve(this.dataDir, filename);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, entry.getData());
        filesRestored++;
        this.logger.debug({ filename }, "Data file restored");
      } catch (err) {
        this.logger.warn({ err, filename }, "Failed to restore data file");
      }
    }

    if (filesRestored > 0) {
      this.logger.info({ filesRestored }, "Data files restored");
    }

    this.logger.info(
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
  }

  // ============================================================
  // LOCAL BACKUPS (data/backups/*.zip)
  // ============================================================

  /**
   * List all local backup files in `data/backups/`, sorted by mtime DESC.
   */
  listLocalBackups(): LocalBackup[] {
    const backupsDir = resolve(this.dataDir, LOCAL_BACKUPS_SUBDIR);
    if (!existsSync(backupsDir)) return [];

    const files = readdirSync(backupsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
      .map((entry) => {
        const fullPath = resolve(backupsDir, entry.name);
        const stat = statSync(fullPath);
        return {
          filename: entry.name,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
          mtime: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map(({ filename, size, createdAt }) => ({ filename, size, createdAt }));

    return files;
  }

  /**
   * Delete oldest local backups, keeping only the N most recent.
   * Returns the list of deleted filenames.
   */
  rotateLocalBackups(keep: number): { deleted: string[] } {
    const backups = this.listLocalBackups();
    if (backups.length <= keep) {
      return { deleted: [] };
    }

    const backupsDir = resolve(this.dataDir, LOCAL_BACKUPS_SUBDIR);
    const toDelete = backups.slice(keep);
    const deleted: string[] = [];
    for (const backup of toDelete) {
      try {
        unlinkSync(resolve(backupsDir, backup.filename));
        deleted.push(backup.filename);
      } catch (err) {
        this.logger.warn({ err, filename: backup.filename }, "Failed to delete old local backup");
      }
    }

    if (deleted.length > 0) {
      this.logger.info({ count: deleted.length, deleted }, "Old local backups rotated");
    }
    return { deleted };
  }
}

// ============================================================
// Helpers (module-private)
// ============================================================

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

/**
 * Convert a Flux query result row to InfluxDB line protocol.
 * Format: measurement,tag1=val1,tag2=val2 field1=value1,field2="str" timestamp_ns
 */
function rowToLineProtocol(row: Record<string, unknown>): string | null {
  const measurement = String(row["_measurement"] ?? "");
  const field = String(row["_field"] ?? "");
  const value = row["_value"];
  const time = String(row["_time"] ?? "");

  if (!measurement || !field || value === undefined || value === null || value === "" || !time)
    return null;

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
    if (skipKeys.has(k) || v === undefined || v === null || v === "") continue;
    tags.push(`${escapeTag(k)}=${escapeTag(String(v))}`);
  }

  // Build tag set
  const tagSet = tags.length > 0 ? `,${tags.join(",")}` : "";

  // Build field value: number as-is, string quoted
  const strValue = String(value);
  const numVal = Number(value);
  const fieldValue =
    typeof value === "number" || (!isNaN(numVal) && strValue.trim() !== "")
      ? `${numVal}`
      : `"${escapeFieldString(strValue)}"`;

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
