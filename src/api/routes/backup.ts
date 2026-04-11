import archiver from "archiver";
import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { BackupManager } from "../../backup/backup-manager.js";

interface BackupRouteDeps {
  backupManager: BackupManager;
  logger: Logger;
}

export function registerBackupRoutes(app: FastifyInstance, deps: BackupRouteDeps): void {
  const { backupManager, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "backup-routes" });

  // ============================================================
  // GET /api/v1/backup — Export full system as ZIP
  // ============================================================
  app.get("/api/v1/backup", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="sowel-backup-${dateStr}.zip"`);

    const archive = archiver("zip", { zlib: { level: 6 } });

    // Build archive — append + finalize handled by BackupManager
    backupManager.buildArchive(archive).then(
      () => archive.finalize(),
      (err) => {
        logger.error({ err }, "Backup export failed");
        archive.abort();
      },
    );

    return reply.send(archive);
  });

  // ============================================================
  // POST /api/v1/backup — Restore from uploaded ZIP
  // ============================================================
  app.post("/api/v1/backup", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    const buffer = await data.toBuffer();

    try {
      const result = await backupManager.restoreFromBuffer(buffer);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Restore failed";
      // Validation errors → 400; other errors → 500
      const isValidation =
        message.startsWith("Invalid") ||
        message.startsWith("ZIP missing") ||
        message.startsWith("Unknown table") ||
        message.includes("must be an array");
      return reply.code(isValidation ? 400 : 500).send({ error: message });
    }
  });

  // ============================================================
  // GET /api/v1/backup/local — List local backups (data/backups/)
  // ============================================================
  app.get("/api/v1/backup/local", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const backups = backupManager.listLocalBackups();
    return { backups };
  });

  // ============================================================
  // POST /api/v1/backup/restore-local — Restore from local file
  // ============================================================
  app.post<{ Body: { filename: string } }>(
    "/api/v1/backup/restore-local",
    async (request, reply) => {
      if (!request.auth || request.auth.role !== "admin") {
        return reply.code(403).send({ error: "Admin access required" });
      }

      const { filename } = request.body ?? {};
      if (!filename || typeof filename !== "string") {
        return reply.code(400).send({ error: "filename is required" });
      }

      try {
        const result = await backupManager.restoreFromFile(filename);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Restore failed";
        const isValidation =
          message.startsWith("Invalid") ||
          message.startsWith("Backup file not found") ||
          message.startsWith("ZIP missing") ||
          message.startsWith("Unknown table") ||
          message.includes("must be an array");
        return reply.code(isValidation ? 400 : 500).send({ error: message });
      }
    },
  );
}
