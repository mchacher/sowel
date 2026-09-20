import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { EventBus } from "../core/event-bus.js";
import { SettingsManager } from "../core/settings-manager.js";
import {
  makeDeviceManagerProxy,
  makeEventBusProxy,
  makeSettingsManagerProxy,
  wrapPluginMethods,
} from "./scoped-deps.js";
import {
  CANARY_ID,
  createCanaryPlugin,
  type CanaryAttempts,
} from "./__fixtures__/canary-plugin.js";
import {
  expectError,
  makeMockDeviceManager,
  makeMockLogger,
  type MockLogger,
} from "./__fixtures__/test-helpers.js";
import type { EngineEvent } from "../shared/types.js";
import type { PluginDeps } from "../shared/plugin-api.js";

// Spec 111 — Integration test using the canary plugin against real
// SettingsManager and EventBus instances (DeviceManager is mocked
// because its full schema setup is out of scope for this test).
//
// Validates that the three Proxies + wrapPluginMethods work together
// when wired exactly as plugin-loader.ts does it.

describe("scoped-deps integration with canary plugin", () => {
  let db: Database.Database;
  let settingsManager: SettingsManager;
  let eventBus: EventBus;
  let logger: MockLogger;
  let attempts: CanaryAttempts;
  let receivedEvents: EngineEvent[];

  beforeEach(() => {
    // Minimal in-memory SQLite with just the settings table the canary needs.
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    settingsManager = new SettingsManager(db);
    // Seed a secret owned by another plugin
    settingsManager.set("integration.netatmo.refresh_token", "SECRET-NETATMO-TOKEN");

    logger = makeMockLogger();
    eventBus = new EventBus(logger);

    receivedEvents = [];
    eventBus.on((event) => {
      receivedEvents.push(event);
    });

    attempts = {};
  });

  it("blocks every deliberate violation the canary attempts", async () => {
    const deviceManager = makeMockDeviceManager();
    const deps: PluginDeps = {
      logger,
      eventBus: makeEventBusProxy(CANARY_ID, eventBus, logger),
      settingsManager: makeSettingsManagerProxy(CANARY_ID, settingsManager, logger),
      deviceManager: makeDeviceManagerProxy(CANARY_ID, deviceManager, logger),
      pluginDir: "/tmp/canary",
      dataDir: "/tmp/canary-data",
    };

    const canary = createCanaryPlugin(deps, attempts);
    const wrapped = wrapPluginMethods(canary, CANARY_ID, logger);

    // start() runs all the violation attempts internally
    await wrapped.start();

    // (1) Foreign read returned undefined, real secret never leaked
    expect(attempts.stolenToken).toBeUndefined();

    // (2) Foreign write threw
    expect(attempts.foreignWrite).toBe("threw");

    // (3) Forbidden emit dropped — no equipment.data.changed reached the bus
    expect(receivedEvents.find((e) => e.type === "equipment.data.changed")).toBeUndefined();

    // (4) Impersonation dropped — no system.integration.connected with foreign id
    const impersonated = receivedEvents.find(
      (e): e is Extract<EngineEvent, { type: "system.integration.connected" }> =>
        e.type === "system.integration.connected" &&
        (e as { integrationId: string }).integrationId === "netatmo",
    );
    expect(impersonated).toBeUndefined();

    // (5) Foreign device mutation threw
    expect(attempts.foreignDevice).toBe("threw");

    // (6) Foreign upsertFromDiscovery threw
    expect(attempts.foreignUpsert).toBe("threw");

    // (7) Admin update on DeviceManager threw
    expect(attempts.adminUpdate).toBe("threw");

    // The real netatmo secret is still intact in the underlying store —
    // the Proxy denied the canary's read but did not corrupt the data.
    expect(settingsManager.get("integration.netatmo.refresh_token")).toBe("SECRET-NETATMO-TOKEN");
  });

  it("swallows refresh() errors from the canary without throwing", async () => {
    const deviceManager = makeMockDeviceManager();
    const deps: PluginDeps = {
      logger,
      eventBus: makeEventBusProxy(CANARY_ID, eventBus, logger),
      settingsManager: makeSettingsManagerProxy(CANARY_ID, settingsManager, logger),
      deviceManager: makeDeviceManagerProxy(CANARY_ID, deviceManager, logger),
      pluginDir: "/tmp/canary",
      dataDir: "/tmp/canary-data",
    };
    const canary = createCanaryPlugin(deps, attempts);
    const wrapped = wrapPluginMethods(canary, CANARY_ID, logger);

    // refresh() in the canary throws "canary refresh boom" — wrapper
    // must swallow and log it without propagating
    await expect(wrapped.refresh?.()).resolves.toBeUndefined();
    expectError(logger, { pluginId: CANARY_ID, method: "refresh" });
  });
});
