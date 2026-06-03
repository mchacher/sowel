import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";

describe("config — CORS defaults", () => {
  let tmpDataDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), "sowel-config-test-"));
    // Override config so the test doesn't touch the real data dir
    process.env["SQLITE_PATH"] = join(tmpDataDir, "sowel.db");
    delete process.env["CORS_ORIGINS"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it("defaults CORS_ORIGINS to localhost (not wildcard)", () => {
    const cfg = loadConfig();
    expect(cfg.cors.origins).toEqual(["http://localhost:3000", "http://localhost:5173"]);
    expect(cfg.cors.origins).not.toContain("*");
  });

  it("honours explicit CORS_ORIGINS", () => {
    process.env["CORS_ORIGINS"] = "https://sowel.exemple.com";
    const cfg = loadConfig();
    expect(cfg.cors.origins).toEqual(["https://sowel.exemple.com"]);
  });

  it("splits comma-separated CORS_ORIGINS and trims whitespace", () => {
    process.env["CORS_ORIGINS"] = " https://a.tld , https://b.tld ";
    const cfg = loadConfig();
    expect(cfg.cors.origins).toEqual(["https://a.tld", "https://b.tld"]);
  });

  it("keeps wildcard if user explicitly sets it (user's choice, warning emitted at boot)", () => {
    process.env["CORS_ORIGINS"] = "*";
    const cfg = loadConfig();
    expect(cfg.cors.origins).toEqual(["*"]);
  });
});

// Spec 124 — SOWEL_SHADOW_MODE resolution truth table.
describe("config — SOWEL_SHADOW_MODE", () => {
  let tmpDataDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), "sowel-config-test-"));
    process.env["SQLITE_PATH"] = join(tmpDataDir, "sowel.db");
    delete process.env["SOWEL_SHADOW_MODE"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it("defaults to false when unset", () => {
    expect(loadConfig().shadowMode).toBe(false);
  });

  it("is false when empty string", () => {
    process.env["SOWEL_SHADOW_MODE"] = "";
    expect(loadConfig().shadowMode).toBe(false);
  });

  it("is false when 0", () => {
    process.env["SOWEL_SHADOW_MODE"] = "0";
    expect(loadConfig().shadowMode).toBe(false);
  });

  it("is true when 1", () => {
    process.env["SOWEL_SHADOW_MODE"] = "1";
    expect(loadConfig().shadowMode).toBe(true);
  });

  it("is true when true (lowercase)", () => {
    process.env["SOWEL_SHADOW_MODE"] = "true";
    expect(loadConfig().shadowMode).toBe(true);
  });

  it("is true when TRUE (uppercase)", () => {
    process.env["SOWEL_SHADOW_MODE"] = "TRUE";
    expect(loadConfig().shadowMode).toBe(true);
  });

  it("is true when yes", () => {
    process.env["SOWEL_SHADOW_MODE"] = "yes";
    expect(loadConfig().shadowMode).toBe(true);
  });

  it("is false for unknown truthy-looking strings (defensive)", () => {
    process.env["SOWEL_SHADOW_MODE"] = "on";
    expect(loadConfig().shadowMode).toBe(false);
  });

  it("is false for garbage", () => {
    process.env["SOWEL_SHADOW_MODE"] = "garbage";
    expect(loadConfig().shadowMode).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    process.env["SOWEL_SHADOW_MODE"] = "  TRUE  ";
    expect(loadConfig().shadowMode).toBe(true);
  });
});
