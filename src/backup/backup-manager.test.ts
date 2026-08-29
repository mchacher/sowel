import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { BACKUP_TABLES, BackupManager, BackupSizeCapExceededError } from "./backup-manager.js";
import { createLogger } from "../core/logger.js";
import {
  INSTANCE_ID_SETTING,
  INSTANCE_MARKER_FILE,
  resolveInstanceIdentity,
} from "../core/instance-identity.js";
import { SettingsManager } from "../core/settings-manager.js";
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

    it("writes a readable archive whose entries carry the backup payload", async () => {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('archive-probe', 'kept')`).run();
      const result = await manager.exportToFile("entries.zip");

      // Read the archive back with an independent unzip implementation rather
      // than trusting that the writer reported success. This is what guards the
      // archiver major upgrades: the API can change shape (v8 dropped the
      // `archiver(format, opts)` factory for `new ZipArchive(opts)`) while every
      // call still resolves and still produces a plausible file size.
      const zip = new AdmZip(result.path);
      const names = zip.getEntries().map((e) => e.entryName);
      expect(names).toContain("sowel-backup.json");

      const payload = JSON.parse(zip.readAsText("sowel-backup.json")) as {
        version: number;
        tables: Record<string, Array<{ key: string; value: string }>>;
      };
      expect(payload.version).toBe(2);
      expect(payload.tables.settings).toContainEqual(
        expect.objectContaining({ key: "archive-probe", value: "kept" }),
      );

      // Compression method 8 is deflate, 0 is stored. `zlib: { level: 6 }` is
      // passed to the archive constructor, and an upgrade that quietly stopped
      // forwarding that option would still produce a readable archive, just a
      // much larger one. Assert the method so the option cannot go missing
      // without a test noticing.
      const entry = zip.getEntries().find((e) => e.entryName === "sowel-backup.json");
      expect(entry?.header.method).toBe(8);
    });

    // #790 — the instance marker is the local half of the #401 guardrail.
    // Shipping it inside the archive makes both halves of the comparison come
    // from the same deployment, so the guardrail can never fire.
    it("never carries the instance marker into the archive (#790)", async () => {
      writeFileSync(
        resolve(tmpDir, INSTANCE_MARKER_FILE),
        "55c68282-8cae-4a4a-b86c-46ae9347fa46\n",
      );
      // A neighbouring data file proves the scan is still picking files up, so
      // an assertion passing because nothing was scanned at all would be caught.
      writeFileSync(resolve(tmpDir, "tokens.json"), '{"ok":true}');

      const result = await manager.exportToFile("identity.zip");
      const names = new AdmZip(result.path).getEntries().map((e) => e.entryName);

      expect(names).toContain("data/tokens.json");
      expect(names).not.toContain(`data/${INSTANCE_MARKER_FILE}`);
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

  // ── #790 — the restore must not hand this deployment a foreign identity ──
  //
  // The #401 guardrail compares the instance id carried in the settings table
  // (which travels inside backups by design) with the `.instance-id` marker
  // beside the database (which describes THIS deployment). Restoring the marker
  // too made both halves come from the same source, so `takeoverPending` could
  // never become true and a prod backup restored on a second machine came up
  // fully armed against the origin instance.
  describe("restoreFromBuffer — #401 guardrail survives a restore (#790)", () => {
    const ORIGIN_ID = "55c68282-8cae-4a4a-b86c-46ae9347fa46";
    const LOCAL_ID = "23972d52-8cff-43ce-b9c8-1ed459ae27d9";

    /** Archive as an instance predating #790 would have produced it. */
    function buildArchiveCarryingOriginIdentity(): Buffer {
      const zip = new AdmZip();
      const tables = Object.fromEntries(BACKUP_TABLES.map((t) => [t, [] as unknown[]]));
      tables.settings = [
        { key: INSTANCE_ID_SETTING, value: ORIGIN_ID, updated_at: "2026-08-01T00:00:00.000Z" },
      ];
      zip.addFile(
        "sowel-backup.json",
        Buffer.from(JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tables })),
      );
      zip.addFile(`data/${INSTANCE_MARKER_FILE}`, Buffer.from(ORIGIN_ID + "\n"));
      return zip.toBuffer();
    }

    function localMarker(): string | null {
      const p = resolve(tmpDir, INSTANCE_MARKER_FILE);
      return existsSync(p) ? readFileSync(p, "utf-8").trim() : null;
    }

    it("leaves the local instance marker untouched", async () => {
      writeFileSync(resolve(tmpDir, INSTANCE_MARKER_FILE), LOCAL_ID + "\n");

      await manager.restoreFromBuffer(buildArchiveCarryingOriginIdentity());

      expect(localMarker()).toBe(LOCAL_ID);
    });

    it("arms the takeover guardrail on the next boot", async () => {
      writeFileSync(resolve(tmpDir, INSTANCE_MARKER_FILE), LOCAL_ID + "\n");

      await manager.restoreFromBuffer(buildArchiveCarryingOriginIdentity());

      // The settings table now carries the origin deployment's id — that half
      // is meant to travel. What must not travel is the marker.
      const settingsManager = new SettingsManager(db);
      expect(settingsManager.get(INSTANCE_ID_SETTING)).toBe(ORIGIN_ID);

      const identity = resolveInstanceIdentity({
        settingsManager,
        dataDir: tmpDir,
        takeoverConfirmed: false,
        logger,
      });

      expect(identity.takeoverPending).toBe(true);
      expect(identity.instanceId).toBe(ORIGIN_ID);
    });

    it("leaves the guardrail disarmed when an instance restores its own backup", async () => {
      // The common case, and the one this exclusion could plausibly break: the
      // marker is skipped, but the settings row carries this instance's own id,
      // so the two halves still agree and nothing is prompted.
      writeFileSync(resolve(tmpDir, INSTANCE_MARKER_FILE), LOCAL_ID + "\n");

      const zip = new AdmZip();
      const tables = Object.fromEntries(BACKUP_TABLES.map((t) => [t, [] as unknown[]]));
      tables.settings = [
        { key: INSTANCE_ID_SETTING, value: LOCAL_ID, updated_at: "2026-08-01T00:00:00.000Z" },
      ];
      zip.addFile(
        "sowel-backup.json",
        Buffer.from(JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tables })),
      );
      zip.addFile(`data/${INSTANCE_MARKER_FILE}`, Buffer.from(LOCAL_ID + "\n"));

      await manager.restoreFromBuffer(zip.toBuffer());

      expect(localMarker()).toBe(LOCAL_ID);
      const identity = resolveInstanceIdentity({
        settingsManager: new SettingsManager(db),
        dataDir: tmpDir,
        takeoverConfirmed: false,
        logger,
      });
      expect(identity.takeoverPending).toBe(false);
    });

    it("does not create a marker on an instance that has none yet", async () => {
      // A restore onto a pristine data dir must leave the identity to be minted
      // on the next boot, not adopt the origin's.
      expect(localMarker()).toBeNull();

      await manager.restoreFromBuffer(buildArchiveCarryingOriginIdentity());

      expect(localMarker()).toBeNull();
    });
  });
});

/**
 * Which tables a backup carries.
 *
 * A table missing from this list is not merely left out of the export: the
 * restore clears `equipments`, foreign keys are on, and anything referencing it
 * is cascaded away. So an omission silently destroys data on restore rather than
 * merely failing to preserve it — which is how a learned PV model disappeared.
 */
describe("BACKUP_TABLES covers everything a restore would cascade away", () => {
  it("carries the PV forecast tables (spec 160/161)", () => {
    expect(BACKUP_TABLES).toContain("pv_forecast_model");
    expect(BACKUP_TABLES).toContain("pv_forecast_sample");
  });

  it("carries the PV health tables (spec 162)", () => {
    expect(BACKUP_TABLES).toContain("pv_health_day");
    // The standing alert too: lost on restore, a fault would be re-raised as
    // new and its recovery would never be announced.
    expect(BACKUP_TABLES).toContain("pv_health_alert");
  });

  it("lists every child after the parent it references", () => {
    // The list doubles as the insert order on restore; a child inserted before
    // its parent violates the foreign key.
    const order = BACKUP_TABLES.indexOf("equipments");
    expect(BACKUP_TABLES.indexOf("pv_forecast_model")).toBeGreaterThan(order);
    expect(BACKUP_TABLES.indexOf("pv_forecast_sample")).toBeGreaterThan(order);
    expect(BACKUP_TABLES.indexOf("pv_health_day")).toBeGreaterThan(order);
    expect(BACKUP_TABLES.indexOf("data_bindings")).toBeGreaterThan(order);
  });

  it("has no duplicates", () => {
    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length);
  });
});
