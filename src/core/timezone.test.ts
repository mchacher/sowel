import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { detectTimezone, probeTimezone, readHomeCoordinatesRaw } from "./timezone.js";

describe("detectTimezone", () => {
  describe("priority 1 — TZ env var", () => {
    it("returns the TZ env var when set", () => {
      const result = detectTimezone({
        tzEnv: "Europe/Paris",
        latitude: 40.7,
        longitude: -74,
      });
      expect(result.tz).toBe("Europe/Paris");
      expect(result.source).toBe("env");
      expect(result.diag[0]).toContain("TZ env var");
    });

    it("respects env var over geo lookup (env wins)", () => {
      // New York coords but env says Paris → Paris wins
      const result = detectTimezone({
        tzEnv: "Europe/Paris",
        latitude: 40.7128,
        longitude: -74.006,
      });
      expect(result.tz).toBe("Europe/Paris");
      expect(result.source).toBe("env");
    });

    it("treats whitespace-only env var as unset", () => {
      const result = detectTimezone({
        tzEnv: "   ",
        latitude: 45.19,
        longitude: 5.72,
      });
      expect(result.source).toBe("auto");
      expect(result.tz).toBe("Europe/Paris");
    });

    it("treats empty string env var as unset", () => {
      const result = detectTimezone({
        tzEnv: "",
        latitude: 45.19,
        longitude: 5.72,
      });
      expect(result.source).toBe("auto");
    });

    it("trims env var", () => {
      const result = detectTimezone({ tzEnv: "  America/New_York  " });
      expect(result.tz).toBe("America/New_York");
      expect(result.source).toBe("env");
    });
  });

  describe("priority 2 — geo lookup", () => {
    it("returns Europe/Paris for Grenoble coordinates", () => {
      const result = detectTimezone({
        latitude: 45.1885,
        longitude: 5.7245,
      });
      expect(result.tz).toBe("Europe/Paris");
      expect(result.source).toBe("auto");
      expect(result.diag[0]).toContain("Timezone detected from home location");
    });

    it("returns America/New_York for New York coordinates", () => {
      const result = detectTimezone({
        latitude: 40.7128,
        longitude: -74.006,
      });
      expect(result.tz).toBe("America/New_York");
      expect(result.source).toBe("auto");
    });

    it("returns Asia/Tokyo for Tokyo coordinates", () => {
      const result = detectTimezone({
        latitude: 35.6895,
        longitude: 139.6917,
      });
      expect(result.tz).toBe("Asia/Tokyo");
      expect(result.source).toBe("auto");
    });
  });

  describe("priority 3 — fallback to UTC", () => {
    it("falls back to UTC when no env var and no coordinates", () => {
      const result = detectTimezone({});
      expect(result.tz).toBe("UTC");
      expect(result.source).toBe("fallback");
      expect(result.diag[0]).toContain("using UTC");
    });

    it("falls back when only latitude is provided", () => {
      const result = detectTimezone({ latitude: 45.19 });
      expect(result.tz).toBe("UTC");
      expect(result.source).toBe("fallback");
    });

    it("falls back when only longitude is provided", () => {
      const result = detectTimezone({ longitude: 5.72 });
      expect(result.tz).toBe("UTC");
      expect(result.source).toBe("fallback");
    });

    it("falls back when coordinates are null", () => {
      const result = detectTimezone({ latitude: null, longitude: null });
      expect(result.tz).toBe("UTC");
      expect(result.source).toBe("fallback");
    });

    it("falls back when latitude is out of range", () => {
      const result = detectTimezone({ latitude: 999, longitude: 5.72 });
      expect(result.tz).toBe("UTC");
      expect(result.source).toBe("fallback");
    });

    it("falls back when longitude is out of range", () => {
      const result = detectTimezone({ latitude: 45.19, longitude: 200 });
      expect(result.tz).toBe("UTC");
      expect(result.source).toBe("fallback");
    });

    it("falls back when latitude is NaN", () => {
      const result = detectTimezone({ latitude: NaN, longitude: 5.72 });
      expect(result.tz).toBe("UTC");
      expect(result.source).toBe("fallback");
    });

    it("falls back when longitude is Infinity", () => {
      const result = detectTimezone({ latitude: 45.19, longitude: Infinity });
      expect(result.tz).toBe("UTC");
      expect(result.source).toBe("fallback");
    });
  });

  describe("diag messages", () => {
    it("always returns at least one diag message", () => {
      expect(detectTimezone({}).diag.length).toBeGreaterThanOrEqual(1);
      expect(detectTimezone({ tzEnv: "Europe/Paris" }).diag.length).toBeGreaterThanOrEqual(1);
      expect(
        detectTimezone({ latitude: 45.19, longitude: 5.72 }).diag.length,
      ).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("probeTimezone", () => {
  it("returns a probe string and an offsetHours number", () => {
    const result = probeTimezone();
    expect(typeof result.probe).toBe("string");
    expect(result.probe.length).toBeGreaterThan(0);
    expect(typeof result.offsetHours).toBe("number");
    expect(Number.isFinite(result.offsetHours)).toBe(true);
  });
});

describe("readHomeCoordinatesRaw", () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "sowel-tz-test-"));
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for both when settings table is empty", () => {
    const result = readHomeCoordinatesRaw(db);
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });

  it("returns null when settings table does not exist (fresh install)", () => {
    // Drop the settings table to simulate a brand new database
    const freshDb = new Database(":memory:");
    const result = readHomeCoordinatesRaw(freshDb);
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
    freshDb.close();
  });

  it("returns parsed coordinates when present", () => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("home.latitude", "45.1885");
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("home.longitude", "5.7245");
    const result = readHomeCoordinatesRaw(db);
    expect(result.latitude).toBe(45.1885);
    expect(result.longitude).toBe(5.7245);
  });

  it("returns null for invalid latitude value", () => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "home.latitude",
      "not-a-number",
    );
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("home.longitude", "5.7245");
    const result = readHomeCoordinatesRaw(db);
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBe(5.7245);
  });

  it("returns null for missing longitude", () => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("home.latitude", "45.1885");
    const result = readHomeCoordinatesRaw(db);
    expect(result.latitude).toBe(45.1885);
    expect(result.longitude).toBeNull();
  });
});
