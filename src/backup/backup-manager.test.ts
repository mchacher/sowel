import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { BackupManager } from "./backup-manager.js";
import { createLogger } from "../core/logger.js";
import type { InfluxClient } from "../core/influx-client.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(
    readFileSync(resolve(import.meta.dirname ?? ".", "../../migrations/001_initial.sql"), "utf-8"),
  );
  return db;
}

const logger = createLogger("silent").logger;

// Minimal influx stub — backup manager only uses isConnected/getConfig/getClient/ensureBuckets
const stubInflux = {
  isConnected: () => false,
  getConfig: () => null,
  getClient: () => null,
  ensureBuckets: async () => {},
  ensureEnergyBuckets: async () => {},
} as unknown as InfluxClient;

describe("BackupManager", () => {
  let tmpDir: string;
  let db: Database.Database;
  let manager: BackupManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "sowel-backup-test-"));
    db = createTestDb();
    manager = new BackupManager({
      db,
      influxClient: stubInflux,
      logger,
      dataDir: tmpDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("listLocalBackups", () => {
    it("returns empty array when backups dir does not exist", () => {
      expect(manager.listLocalBackups()).toEqual([]);
    });

    it("returns empty array when backups dir is empty", () => {
      mkdirSync(resolve(tmpDir, "backups"));
      expect(manager.listLocalBackups()).toEqual([]);
    });

    it("ignores non-zip files", () => {
      mkdirSync(resolve(tmpDir, "backups"));
      writeFileSync(resolve(tmpDir, "backups", "notes.txt"), "hello");
      expect(manager.listLocalBackups()).toEqual([]);
    });

    it("returns zip files sorted by mtime DESC", async () => {
      mkdirSync(resolve(tmpDir, "backups"));
      // Create 3 files with different mtimes
      writeFileSync(resolve(tmpDir, "backups", "old.zip"), "x");
      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(resolve(tmpDir, "backups", "middle.zip"), "x");
      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(resolve(tmpDir, "backups", "new.zip"), "x");

      const backups = manager.listLocalBackups();
      expect(backups).toHaveLength(3);
      expect(backups[0].filename).toBe("new.zip");
      expect(backups[1].filename).toBe("middle.zip");
      expect(backups[2].filename).toBe("old.zip");
    });
  });

  describe("rotateLocalBackups", () => {
    it("does nothing when count <= keep", async () => {
      mkdirSync(resolve(tmpDir, "backups"));
      writeFileSync(resolve(tmpDir, "backups", "a.zip"), "x");
      await new Promise((r) => setTimeout(r, 5));
      writeFileSync(resolve(tmpDir, "backups", "b.zip"), "x");

      const result = manager.rotateLocalBackups(3);
      expect(result.deleted).toEqual([]);
      expect(manager.listLocalBackups()).toHaveLength(2);
    });

    it("deletes oldest backups, keeping N newest", async () => {
      mkdirSync(resolve(tmpDir, "backups"));
      writeFileSync(resolve(tmpDir, "backups", "1.zip"), "x");
      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(resolve(tmpDir, "backups", "2.zip"), "x");
      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(resolve(tmpDir, "backups", "3.zip"), "x");
      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(resolve(tmpDir, "backups", "4.zip"), "x");
      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(resolve(tmpDir, "backups", "5.zip"), "x");

      const result = manager.rotateLocalBackups(3);
      expect(result.deleted).toHaveLength(2);
      expect(result.deleted).toContain("1.zip");
      expect(result.deleted).toContain("2.zip");

      const remaining = manager.listLocalBackups();
      expect(remaining).toHaveLength(3);
      expect(remaining.map((b) => b.filename).sort()).toEqual(["3.zip", "4.zip", "5.zip"]);
    });

    it("returns empty deleted when no backups exist", () => {
      const result = manager.rotateLocalBackups(3);
      expect(result.deleted).toEqual([]);
    });
  });

  describe("exportToFile", () => {
    it("creates the backups directory if missing", async () => {
      const result = await manager.exportToFile("test-backup.zip");
      expect(existsSync(resolve(tmpDir, "backups"))).toBe(true);
      expect(existsSync(result.path)).toBe(true);
      expect(result.size).toBeGreaterThan(0);
    });

    it("creates a valid zip file at the expected path", async () => {
      const result = await manager.exportToFile("my-backup.zip");
      expect(result.path).toBe(resolve(tmpDir, "backups", "my-backup.zip"));
      expect(result.size).toBeGreaterThan(100); // at least the JSON structure
    });

    it("multiple exports create multiple files", async () => {
      await manager.exportToFile("a.zip");
      await new Promise((r) => setTimeout(r, 10));
      await manager.exportToFile("b.zip");

      const backups = manager.listLocalBackups();
      expect(backups).toHaveLength(2);
    });
  });

  describe("restoreFromFile", () => {
    it("rejects path traversal", async () => {
      await expect(manager.restoreFromFile("../../etc/passwd")).rejects.toThrow(/Invalid filename/);
      await expect(manager.restoreFromFile("/etc/passwd")).rejects.toThrow(/Invalid filename/);
      await expect(manager.restoreFromFile("..\\windows")).rejects.toThrow(/Invalid filename/);
    });

    it("rejects when file does not exist", async () => {
      mkdirSync(resolve(tmpDir, "backups"));
      await expect(manager.restoreFromFile("missing.zip")).rejects.toThrow(/not found/);
    });

    it("rejects an invalid zip file", async () => {
      mkdirSync(resolve(tmpDir, "backups"));
      writeFileSync(resolve(tmpDir, "backups", "bad.zip"), "not a zip");
      await expect(manager.restoreFromFile("bad.zip")).rejects.toThrow();
    });

    it("can restore a backup that was just exported", async () => {
      // Seed some data
      db.prepare(`INSERT INTO settings (key, value) VALUES ('test', 'before-restore')`).run();

      // Export
      await manager.exportToFile("snapshot.zip");

      // Modify
      db.prepare(`UPDATE settings SET value = 'modified' WHERE key = 'test'`).run();
      const modified = db.prepare(`SELECT value FROM settings WHERE key = 'test'`).get() as {
        value: string;
      };
      expect(modified.value).toBe("modified");

      // Restore
      const result = await manager.restoreFromFile("snapshot.zip");
      expect(result.success).toBe(true);

      // Check data is back
      const restored = db.prepare(`SELECT value FROM settings WHERE key = 'test'`).get() as {
        value: string;
      };
      expect(restored.value).toBe("before-restore");
    });
  });
});
