import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import {
  resolveInstanceIdentity,
  confirmTakeover,
  INSTANCE_ID_SETTING,
  INSTANCE_MARKER_FILE,
} from "./instance-identity.js";
import type { SettingsManager } from "./settings-manager.js";

const logger = createLogger("silent").logger;

// Issue #401 — restored-data guardrail.

function makeSettings(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: string) => {
      store.set(key, value);
    },
    _store: store,
  } as unknown as SettingsManager & { _store: Map<string, string> };
}

describe("resolveInstanceIdentity", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "sowel-identity-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function marker(): string | null {
    const p = join(dataDir, INSTANCE_MARKER_FILE);
    return existsSync(p) ? readFileSync(p, "utf-8").trim() : null;
  }

  it("first boot mints an identity and writes both the setting and the marker", () => {
    const settings = makeSettings();
    const identity = resolveInstanceIdentity({
      settingsManager: settings,
      dataDir,
      takeoverConfirmed: false,
      logger,
    });

    expect(identity.takeoverPending).toBe(false);
    expect(identity.instanceId).toBeTruthy();
    expect(settings._store.get(INSTANCE_ID_SETTING)).toBe(identity.instanceId);
    expect(marker()).toBe(identity.instanceId);
  });

  it("matching marker and setting boots normally", () => {
    const settings = makeSettings({ [INSTANCE_ID_SETTING]: "id-A" });
    writeFileSync(join(dataDir, INSTANCE_MARKER_FILE), "id-A\n");

    const identity = resolveInstanceIdentity({
      settingsManager: settings,
      dataDir,
      takeoverConfirmed: false,
      logger,
    });

    expect(identity).toEqual({ instanceId: "id-A", takeoverPending: false });
  });

  it("restored database (marker from another deployment) triggers takeover pending", () => {
    const settings = makeSettings({ [INSTANCE_ID_SETTING]: "prod-id" });
    writeFileSync(join(dataDir, INSTANCE_MARKER_FILE), "dev-id\n");

    const identity = resolveInstanceIdentity({
      settingsManager: settings,
      dataDir,
      takeoverConfirmed: false,
      logger,
    });

    expect(identity.takeoverPending).toBe(true);
    // The marker must NOT be adopted silently.
    expect(marker()).toBe("dev-id");
  });

  it("database with an id but no local marker triggers takeover pending", () => {
    const settings = makeSettings({ [INSTANCE_ID_SETTING]: "prod-id" });

    const identity = resolveInstanceIdentity({
      settingsManager: settings,
      dataDir,
      takeoverConfirmed: false,
      logger,
    });

    expect(identity.takeoverPending).toBe(true);
    expect(marker()).toBe(null);
  });

  it("SOWEL_TAKEOVER pre-confirms the adoption and writes the marker", () => {
    const settings = makeSettings({ [INSTANCE_ID_SETTING]: "prod-id" });
    writeFileSync(join(dataDir, INSTANCE_MARKER_FILE), "dev-id\n");

    const identity = resolveInstanceIdentity({
      settingsManager: settings,
      dataDir,
      takeoverConfirmed: true,
      logger,
    });

    expect(identity).toEqual({ instanceId: "prod-id", takeoverPending: false });
    expect(marker()).toBe("prod-id");
  });

  it("confirmTakeover adopts the database id into the marker", () => {
    const settings = makeSettings({ [INSTANCE_ID_SETTING]: "prod-id" });
    writeFileSync(join(dataDir, INSTANCE_MARKER_FILE), "dev-id\n");

    confirmTakeover({ settingsManager: settings, dataDir, logger });

    expect(marker()).toBe("prod-id");
    // Next boot is normal.
    const identity = resolveInstanceIdentity({
      settingsManager: settings,
      dataDir,
      takeoverConfirmed: false,
      logger,
    });
    expect(identity.takeoverPending).toBe(false);
  });
});
