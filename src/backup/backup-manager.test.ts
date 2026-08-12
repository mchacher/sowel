import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { BackupManager, BackupSizeCapExceededError } from "./backup-manager.js";
import { createLogger } from "../core/logger.js";
import { applyMigrations } from "../test-helpers/migrations.js";
import type { InfluxClient } from "../core/influx-client.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
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

  // ────────────────────────────────────────────────────────────────
  // SECURITY: regression guards for spec 089 C2 — restore confinement.
  // Each test crafts a malicious ZIP that, on `main` before the fix,
  // would write outside dataDir or extract banned files. Post-fix, the
  // entry is skipped/rejected and no file lands outside dataDir.
  // ────────────────────────────────────────────────────────────────
  describe("restoreFromBuffer — spec 089 C2 attack regression guards", () => {
    /** Build a minimal valid backup ZIP and add an arbitrary entry. */
    function buildMaliciousZip(maliciousEntry: {
      name: string;
      data: Buffer;
      attr?: number;
    }): Buffer {
      const zip = new AdmZip();
      // Minimal payload — tables empty, restore won't write to SQLite but
      // we still need a parseable sowel-backup.json.
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        tables: Object.fromEntries(
          // empty list for every BACKUP_TABLES key — keeps validate() happy
          [
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
          ].map((k) => [k, []]),
        ),
      };
      zip.addFile("sowel-backup.json", Buffer.from(JSON.stringify(payload)));
      zip.addFile(maliciousEntry.name, maliciousEntry.data);
      if (maliciousEntry.attr !== undefined) {
        const e = zip.getEntry(maliciousEntry.name);
        if (e) (e as unknown as { attr: number }).attr = maliciousEntry.attr;
      }
      return zip.toBuffer();
    }

    // C2.1 — path traversal via "data/../../" prefix
    it("refuses ZIP entry that escapes dataDir via ..", async () => {
      // Targeting an absolute path outside dataDir. Pre-fix this writes
      // there; post-fix the entry is skipped and no file lands there.
      const externalTarget = resolve(tmpDir, "..", "sowel-pwned-xyz");
      // Build relative path that resolves to externalTarget from dataDir.
      // dataDir = tmpDir → "../sowel-pwned-xyz" escapes it.
      const buf = buildMaliciousZip({
        name: "data/../sowel-pwned-xyz",
        data: Buffer.from("pwned"),
      });

      await manager.restoreFromBuffer(buf);

      // SECURITY: regression guard for spec 089 C2 (path traversal)
      expect(existsSync(externalTarget)).toBe(false);
    });

    // C2.2 — symlink entry refused
    it("refuses ZIP entry that is a symlink", async () => {
      // Build entry with Unix mode S_IFLNK (0o120000) in upper 16 bits.
      const symlinkAttr = (0o120000 << 16) >>> 0;
      const buf = buildMaliciousZip({
        name: "data/evil-link",
        data: Buffer.from("/etc/passwd"),
        attr: symlinkAttr,
      });

      await manager.restoreFromBuffer(buf);

      // SECURITY: regression guard for spec 089 C2 (symlink injection)
      expect(existsSync(resolve(tmpDir, "evil-link"))).toBe(false);
    });

    // C2.3 — banned extension (.so) refused
    it("refuses ZIP entry with a banned extension (.so)", async () => {
      const buf = buildMaliciousZip({
        name: "data/payload.so",
        data: Buffer.from("\x7fELF malicious"),
      });

      await manager.restoreFromBuffer(buf);

      // SECURITY: regression guard for spec 089 C2 (extension whitelist)
      expect(existsSync(resolve(tmpDir, "payload.so"))).toBe(false);
    });

    // C2.4 — banned extension (.node) refused
    it("refuses ZIP entry with a banned extension (.node)", async () => {
      const buf = buildMaliciousZip({
        name: "data/payload.node",
        data: Buffer.from("native module"),
      });

      await manager.restoreFromBuffer(buf);

      // SECURITY: regression guard for spec 089 C2 (extension whitelist)
      expect(existsSync(resolve(tmpDir, "payload.node"))).toBe(false);
    });

    // C2.5 — cumulative size cap exceeded throws
    it("throws BackupSizeCapExceededError when cumulative size exceeds the cap", async () => {
      // Instantiate a manager with a tiny cap so we can exercise the path
      // without actually writing 1 GB.
      const cappedManager = new BackupManager({
        db,
        influxClient: stubInflux,
        logger,
        dataDir: tmpDir,
        maxRestoreBytes: 1024, // 1 KB cap
      });
      const buf = buildMaliciousZip({
        name: "data/big.txt",
        data: Buffer.alloc(2048, 0x41), // 2 KB > cap
      });

      // SECURITY: regression guard for spec 089 C2 (zip bomb cap)
      await expect(cappedManager.restoreFromBuffer(buf)).rejects.toBeInstanceOf(
        BackupSizeCapExceededError,
      );
    });

    // C2.6 — legitimate entry with allowed extension restores normally
    it("restores a legitimate .json entry under dataDir (regression)", async () => {
      const buf = buildMaliciousZip({
        name: "data/legit.json",
        data: Buffer.from('{"ok": true}'),
      });

      await manager.restoreFromBuffer(buf);

      expect(existsSync(resolve(tmpDir, "legit.json"))).toBe(true);
      expect(readFileSync(resolve(tmpDir, "legit.json"), "utf-8")).toBe('{"ok": true}');
    });
  });
});
