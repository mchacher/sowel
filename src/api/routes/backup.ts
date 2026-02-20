import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { Logger } from "../../core/logger.js";

interface BackupDeps {
  db: Database.Database;
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
] as const;

// Reverse order for deletion (children first)
const DELETE_ORDER = [...BACKUP_TABLES].reverse();

interface BackupPayload {
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export function registerBackupRoutes(app: FastifyInstance, deps: BackupDeps): void {
  const { db, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "backup" });

  // GET /api/v1/backup — Export full configuration as JSON
  app.get("/api/v1/backup", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const tables: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
    }

    const payload: BackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tables,
    };

    logger.info("Configuration exported");

    return reply
      .header("Content-Disposition", `attachment; filename="corbel-backup-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(payload);
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

        // Re-enable foreign keys
        db.pragma("foreign_keys = ON");
      });

      restore();

      logger.info(
        { tables: Object.keys(payload.tables).length, exportedAt: payload.exportedAt },
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
