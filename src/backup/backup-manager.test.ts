import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import {
  ALLOWED_RESTORE_EXTENSIONS,
  escapeFieldString,
  escapeTag,
  BACKUP_TABLES,
  BackupManager,
  BackupSizeCapExceededError,
  dataFileExtension,
} from "./backup-manager.js";
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

    it("rejects the shapes the old blacklist let through", async () => {
      // "." and ".." carry no separator, so a check spelled as "contains / or
      // \\ or .." missed the first one entirely and the name resolved to the
      // backups directory itself.
      // "  " is deliberately absent: a file named two spaces is odd but it
      // cannot escape the directory, and refusing it would be a rule about
      // taste rather than about safety.
      for (const name of [".", "", ".."]) {
        await expect(manager.restoreFromFile(name)).rejects.toThrow(/Invalid filename/);
      }
    });

    it("refuses a path rather than quietly reading its last segment", async () => {
      // Taking the basename would have turned this into a request for a real
      // file inside data/backups. Answering a question nobody asked is worse
      // than refusing.
      mkdirSync(resolve(tmpDir, "backups"), { recursive: true });
      writeFileSync(resolve(tmpDir, "backups", "real.zip"), "x");
      await expect(manager.restoreFromFile("../backups/real.zip")).rejects.toThrow(
        /Invalid filename/,
      );
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

  // ── #829 — the dotfile-shaped hole in the spec 089 C2 whitelist ──
  //
  // The export derived an extension with slice(lastIndexOf(".")) and the
  // restore with extname(), which returns "" for a leading-dot basename. The
  // restore's `if (ext && ...)` guard then short-circuited and let any
  // `data/.<name>` entry through, at any depth. The `.jwt-secret` and
  // `.influx-token` entries in the whitelist could never match and were dead:
  // what actually let those files land was the hole itself.
  describe("restoreFromBuffer — dotfile entries face the whitelist (#829)", () => {
    function buildZipWith(entries: { name: string; data: Buffer }[]): Buffer {
      const zip = new AdmZip();
      const tables = Object.fromEntries(BACKUP_TABLES.map((t) => [t, [] as unknown[]]));
      zip.addFile(
        "sowel-backup.json",
        Buffer.from(JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tables })),
      );
      for (const e of entries) zip.addFile(e.name, e.data);
      return zip.toBuffer();
    }

    it("refuses an unexpected top-level dotfile", async () => {
      await manager.restoreFromBuffer(
        buildZipWith([{ name: "data/.whatever", data: Buffer.from("x") }]),
      );
      expect(existsSync(resolve(tmpDir, ".whatever"))).toBe(false);
    });

    it("refuses one nested under a subdirectory", async () => {
      // The old extname() path returned "" whatever the depth, so nesting was
      // not even an evasion: it was the same hole.
      await manager.restoreFromBuffer(
        buildZipWith([{ name: "data/plugins/x/.whatever", data: Buffer.from("x") }]),
      );
      expect(existsSync(resolve(tmpDir, "plugins", "x", ".whatever"))).toBe(false);
    });

    it("still restores the two dotfiles the whitelist names", async () => {
      // The other half. These are real: config.ts reads data/.jwt-secret and
      // data/.influx-token, so a restore that dropped them would lose the JWT
      // signing secret and log every session out.
      await manager.restoreFromBuffer(
        buildZipWith([
          { name: "data/.jwt-secret", data: Buffer.from("s3cr3t") },
          { name: "data/.influx-token", data: Buffer.from("t0k3n") },
        ]),
      );
      expect(readFileSync(resolve(tmpDir, ".jwt-secret"), "utf-8")).toBe("s3cr3t");
      expect(readFileSync(resolve(tmpDir, ".influx-token"), "utf-8")).toBe("t0k3n");
    });

    it("still refuses a banned extension on a nested entry", async () => {
      // Deriving from the basename must not have loosened the ordinary case.
      await manager.restoreFromBuffer(
        buildZipWith([{ name: "data/plugins/x/evil.so", data: Buffer.from("x") }]),
      );
      expect(existsSync(resolve(tmpDir, "plugins", "x", "evil.so"))).toBe(false);
    });

    it("still restores a nested entry with an allowed extension", async () => {
      await manager.restoreFromBuffer(
        buildZipWith([{ name: "data/plugins/x/config.json", data: Buffer.from("{}") }]),
      );
      expect(existsSync(resolve(tmpDir, "plugins", "x", "config.json"))).toBe(true);
    });

    it("refuses an entry with no extension at all", async () => {
      // Same short-circuit, same hole: `data/plain` used to land while
      // `data/plain.sh` was refused. The whitelist now means what it says.
      const res = await manager.restoreFromBuffer(
        buildZipWith([{ name: "data/plain", data: Buffer.from("x") }]),
      );
      expect(existsSync(resolve(tmpDir, "plain"))).toBe(false);
      expect(res.filesSkipped).toBe(1);
    });

    it("counts every refusal so a partial restore is not silent", async () => {
      const res = await manager.restoreFromBuffer(
        buildZipWith([
          { name: "data/.env", data: Buffer.from("x") },
          { name: "data/evil.so", data: Buffer.from("x") },
          { name: "data/keep.json", data: Buffer.from("{}") },
        ]),
      );
      expect(res.filesRestored).toBe(1);
      expect(res.filesSkipped).toBe(2);
    });
  });

  // ── #829 review — the export must not archive what the restore refuses ──
  //
  // Spec 089 was accepted on the note that "no legitimate backup should be
  // rejected: we control the export format". Tightening the restore without
  // tightening the export made that false, and silently: Sowel's own
  // shadow-deploy script writes data/.shadow-target, which used to round-trip.
  describe("exportToFile — the export is held to the restore's whitelist", () => {
    it("leaves out a file the restore would refuse, and says which", async () => {
      writeFileSync(resolve(tmpDir, "keep.json"), "{}");
      writeFileSync(resolve(tmpDir, ".shadow-target"), "prod");
      writeFileSync(resolve(tmpDir, "sowel.db.bak.1777715864"), "stale");

      const result = await manager.exportToFile("scan.zip");
      const names = new AdmZip(result.path).getEntries().map((e) => e.entryName);

      expect(names).toContain("data/keep.json");
      expect(names).not.toContain("data/.shadow-target");
      expect(names).not.toContain("data/sowel.db.bak.1777715864");
    });

    it("round-trips everything it did archive", async () => {
      // The property that matters: whatever comes out of an export goes back
      // in. Before this, an archive could contain entries its own restore
      // dropped with nothing but a log line.
      writeFileSync(resolve(tmpDir, ".jwt-secret"), "s3cr3t");
      writeFileSync(resolve(tmpDir, "tokens.json"), "{}");
      const result = await manager.exportToFile("roundtrip.zip");
      const archive = new AdmZip(result.path);

      const res = await manager.restoreFromBuffer(archive.toBuffer());

      expect(res.filesSkipped).toBe(0);
      const archived = archive
        .getEntries()
        .filter((e) => e.entryName.startsWith("data/") && !e.isDirectory).length;
      expect(res.filesRestored).toBe(archived);
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

describe("dataFileExtension (#829)", () => {
  it("treats a leading-dot basename as its own extension", () => {
    expect(dataFileExtension(".jwt-secret")).toBe(".jwt-secret");
    expect(dataFileExtension(".influx-token")).toBe(".influx-token");
    expect(dataFileExtension(".instance-id")).toBe(".instance-id");
  });

  it("judges a nested file by its basename", () => {
    expect(dataFileExtension("plugins/x/.whatever")).toBe(".whatever");
    expect(dataFileExtension("plugins/x/config.json")).toBe(".json");
  });

  it("behaves ordinarily otherwise", () => {
    expect(dataFileExtension("config.json")).toBe(".json");
    expect(dataFileExtension("archive.tar.gz")).toBe(".gz");
    expect(dataFileExtension("noextension")).toBe("");
  });

  it("preserves case, which the two call sites handle differently", () => {
    // The restore lowercases at its call site, as it always did; the export's
    // exclusion list is case-sensitive, as it always was. Folding case here
    // would silently change which files are left out of a backup.
    expect(dataFileExtension("FOO.LOG")).toBe(".LOG");
  });

  it("leaves no unreachable entry in the restore whitelist", () => {
    // An extension the derivation cannot produce is not a permission, it is a
    // comment that reads like one. `.jwt-secret` and `.influx-token` were
    // exactly that until this fix.
    for (const ext of ALLOWED_RESTORE_EXTENSIONS) {
      expect(dataFileExtension("file" + ext).toLowerCase()).toBe(ext);
      // Bare, with no prefix: this is the leading-dot shape the whole bug is
      // about, and without it the assertion above passes under extname() too.
      expect(dataFileExtension(ext).toLowerCase()).toBe(ext);
    }
  });
});

/**
 * Line-protocol escaping for the InfluxDB half of a backup.
 *
 * Tag values carry equipment and device names, which are whatever the household
 * typed, so this is user data reaching a format with its own escape character.
 */
describe("escapeTag", () => {
  it("escapes the characters line protocol reserves in a tag", () => {
    expect(escapeTag("a,b")).toBe("a\\,b");
    expect(escapeTag("a b")).toBe("a\\ b");
    expect(escapeTag("a=b")).toBe("a\\=b");
  });

  it("escapes the backslash, which is the escape character itself", () => {
    // The defect: a name ending in a backslash was written verbatim, so the
    // parser read the separator that followed as escaped, the tag swallowed the
    // comma, and the rest of the line was misread. Reachable from any equipment
    // or device name.
    expect(escapeTag("Prise garage\\")).toBe("Prise\\ garage\\\\");
    expect(escapeTag("a\\b")).toBe("a\\\\b");
  });

  it("escapes the backslash FIRST, so the ones it inserts are not escaped again", () => {
    // Doing it last would turn the `\,` produced for a comma into `\\,`, which
    // reads as a literal backslash followed by a separator.
    expect(escapeTag("a,b\\c")).toBe("a\\,b\\\\c");
  });

  it("leaves an ordinary name alone", () => {
    expect(escapeTag("Chauffe-eau")).toBe("Chauffe-eau");
  });
});

describe("escapeFieldString", () => {
  it("already had the order right, and keeps it", () => {
    expect(escapeFieldString('a"b')).toBe('a\\"b');
    expect(escapeFieldString("a\\b")).toBe("a\\\\b");
    expect(escapeFieldString('a\\"b')).toBe('a\\\\\\"b');
  });
});
