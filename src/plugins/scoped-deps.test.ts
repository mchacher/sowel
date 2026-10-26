import { describe, it, expect, beforeEach } from "vitest";
import {
  ALLOWED_EMIT_TYPES,
  GLOBAL_READABLE_KEYS,
  makeDeviceManagerProxy,
  makeEventBusProxy,
  makeSettingsManagerProxy,
  wrapPluginMethods,
} from "./scoped-deps.js";
import {
  expectError,
  expectWarn,
  makeMockDeviceManager,
  makeMockEventBus,
  makeMockLogger,
  makeMockSettings,
  type MockLogger,
} from "./__fixtures__/test-helpers.js";
import type { IntegrationPlugin } from "../integrations/integration-registry.js";

// Spec 111 — Unit tests on the three Proxies + the lifecycle wrapper.
// Every "deny" case asserts both the return value and that the inner
// real method was NOT called (the Proxy short-circuits).

describe("SettingsManagerProxy", () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  it("allows read on own prefix", () => {
    const inner = makeMockSettings({ "integration.zigbee2mqtt.mqtt_url": "mqtt://localhost" });
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    expect(proxy.get("integration.zigbee2mqtt.mqtt_url")).toBe("mqtt://localhost");
    expect(inner.get).toHaveBeenCalledWith("integration.zigbee2mqtt.mqtt_url");
  });

  it("blocks read on foreign integration prefix", () => {
    const inner = makeMockSettings({ "integration.netatmo.refresh_token": "SECRET" });
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    expect(proxy.get("integration.netatmo.refresh_token")).toBeUndefined();
    expect(inner.get).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "zigbee2mqtt", key: "integration.netatmo.refresh_token" });
  });

  it.each([...GLOBAL_READABLE_KEYS])("allows read on global key %s", (globalKey) => {
    const inner = makeMockSettings({ [globalKey]: "value" });
    const proxy = makeSettingsManagerProxy("some-plugin", inner, logger);
    expect(proxy.get(globalKey)).toBe("value");
    expect(inner.get).toHaveBeenCalledWith(globalKey);
  });

  it("allows write on own prefix", () => {
    const inner = makeMockSettings();
    const proxy = makeSettingsManagerProxy("netatmo", inner, logger);
    proxy.set("integration.netatmo.refresh_token", "new-token");
    expect(inner.set).toHaveBeenCalledWith("integration.netatmo.refresh_token", "new-token");
  });

  it("throws on write to foreign key", () => {
    const inner = makeMockSettings();
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    expect(() => proxy.set("integration.netatmo.evil", "x")).toThrow(/cannot write/);
    expect(inner.set).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "zigbee2mqtt", key: "integration.netatmo.evil" });
  });

  it("throws on setMany when any key is foreign", () => {
    const inner = makeMockSettings();
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    expect(() =>
      proxy.setMany({
        "integration.zigbee2mqtt.foo": "ok",
        "integration.netatmo.bar": "evil",
      }),
    ).toThrow(/foreign setMany/);
    expect(inner.setMany).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "zigbee2mqtt", keys: ["integration.netatmo.bar"] });
  });

  it("allows setMany when all keys are on own prefix", () => {
    const inner = makeMockSettings();
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    proxy.setMany({
      "integration.zigbee2mqtt.foo": "1",
      "integration.zigbee2mqtt.bar": "2",
    });
    expect(inner.setMany).toHaveBeenCalledWith({
      "integration.zigbee2mqtt.foo": "1",
      "integration.zigbee2mqtt.bar": "2",
    });
  });

  it("returns empty record from getAll", () => {
    const inner = makeMockSettings({ "integration.netatmo.refresh_token": "SECRET" });
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    expect(proxy.getAll()).toEqual({});
    expect(inner.getAll).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "zigbee2mqtt" });
  });

  it("returns empty from getByPrefix on foreign prefix", () => {
    const inner = makeMockSettings({ "integration.netatmo.refresh_token": "SECRET" });
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    expect(proxy.getByPrefix("integration.netatmo.")).toEqual({});
    expect(inner.getByPrefix).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "zigbee2mqtt", prefix: "integration.netatmo." });
  });

  it("passes through getByPrefix on own prefix", () => {
    const inner = makeMockSettings({
      "integration.zigbee2mqtt.mqtt_url": "mqtt://localhost",
      "integration.zigbee2mqtt.base_topic": "z2m",
    });
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    const result = proxy.getByPrefix("integration.zigbee2mqtt.");
    expect(result).toEqual({
      "integration.zigbee2mqtt.mqtt_url": "mqtt://localhost",
      "integration.zigbee2mqtt.base_topic": "z2m",
    });
  });

  it("blocks getMqttConfig from non-zigbee2mqtt plugin", () => {
    const inner = makeMockSettings();
    const proxy = makeSettingsManagerProxy("netatmo", inner, logger);
    expect(() => proxy.getMqttConfig()).toThrow(/restricted to zigbee2mqtt/);
    expect(inner.getMqttConfig).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "netatmo" });
  });

  it("allows getMqttConfig from zigbee2mqtt", () => {
    const inner = makeMockSettings({ "integration.zigbee2mqtt.mqtt_url": "mqtt://b" });
    const proxy = makeSettingsManagerProxy("zigbee2mqtt", inner, logger);
    expect(proxy.getMqttConfig()).toBeTruthy();
    expect(inner.getMqttConfig).toHaveBeenCalled();
  });

  it("blocks getZ2mConfig from non-zigbee2mqtt plugin", () => {
    const inner = makeMockSettings();
    const proxy = makeSettingsManagerProxy("tasmota", inner, logger);
    expect(() => proxy.getZ2mConfig()).toThrow(/restricted/);
    expect(inner.getZ2mConfig).not.toHaveBeenCalled();
  });
});

describe("EventBusProxy", () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  it.each([...ALLOWED_EMIT_TYPES])("allows whitelisted event type %s", (eventType) => {
    const inner = makeMockEventBus();
    const proxy = makeEventBusProxy("zigbee2mqtt", inner, logger);
    // Build a minimal event matching the type — every allowed type has at
    // least integrationId or alarm-shaped fields; we just exercise the gate.
    if (
      eventType === "system.integration.connected" ||
      eventType === "system.integration.disconnected"
    ) {
      proxy.emit({ type: eventType, integrationId: "zigbee2mqtt" });
    } else if (eventType === "system.alarm.raised") {
      proxy.emit({
        type: "system.alarm.raised",
        alarmId: "x",
        level: "error",
        source: "z",
        message: "boom",
      });
    } else if (eventType === "system.alarm.resolved") {
      proxy.emit({
        type: "system.alarm.resolved",
        alarmId: "x",
        source: "z",
        message: "ok",
      });
    }
    expect(inner.emit).toHaveBeenCalled();
  });

  it("drops non-whitelisted event types silently", () => {
    const inner = makeMockEventBus();
    const proxy = makeEventBusProxy("zigbee2mqtt", inner, logger);
    proxy.emit({
      type: "equipment.data.changed",
      equipmentId: "fake",
    } as unknown as Parameters<typeof proxy.emit>[0]);
    expect(inner.emit).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "zigbee2mqtt", eventType: "equipment.data.changed" });
  });

  it("drops impersonation of another integration", () => {
    const inner = makeMockEventBus();
    const proxy = makeEventBusProxy("zigbee2mqtt", inner, logger);
    proxy.emit({ type: "system.integration.connected", integrationId: "netatmo" });
    expect(inner.emit).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "zigbee2mqtt", claimed: "netatmo" });
  });

  it("passes through on/onType subscriptions", () => {
    const inner = makeMockEventBus();
    const proxy = makeEventBusProxy("zigbee2mqtt", inner, logger);
    proxy.on(() => {});
    proxy.onType("system.started", () => {});
    expect(inner.on).toHaveBeenCalled();
    expect(inner.onType).toHaveBeenCalled();
  });
});

describe("DeviceManagerProxy", () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  it("throws on upsertFromDiscovery with foreign integrationId", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    expect(() =>
      proxy.upsertFromDiscovery("netatmo", "netatmo_hc", {
        friendlyName: "x",
        data: [],
        orders: [],
      }),
    ).toThrow(/cannot.*upsertFromDiscovery/);
    expect(inner.upsertFromDiscovery).not.toHaveBeenCalled();
    expectWarn(logger, { pluginId: "zigbee2mqtt", integrationId: "netatmo" });
  });

  it("allows upsertFromDiscovery on own integrationId", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    proxy.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", {
      friendlyName: "bulb_1",
      data: [],
      orders: [],
    });
    expect(inner.upsertFromDiscovery).toHaveBeenCalledWith(
      "zigbee2mqtt",
      "zigbee2mqtt",
      expect.objectContaining({ friendlyName: "bulb_1" }),
    );
  });

  it("throws on updateDeviceData with foreign integrationId", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    expect(() => proxy.updateDeviceData("netatmo", "x", { a: 1 })).toThrow(
      /cannot.*updateDeviceData/,
    );
    expect(inner.updateDeviceData).not.toHaveBeenCalled();
  });

  it("allows updateDeviceData on own integrationId", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    proxy.updateDeviceData("zigbee2mqtt", "src", { state: "on" });
    expect(inner.updateDeviceData).toHaveBeenCalledWith(
      "zigbee2mqtt",
      "src",
      { state: "on" },
      undefined,
    );
  });

  it("throws on updateDeviceStatus with foreign integrationId", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    expect(() => proxy.updateDeviceStatus("netatmo", "x", "offline")).toThrow(
      /cannot.*updateDeviceStatus/,
    );
    expect(inner.updateDeviceStatus).not.toHaveBeenCalled();
  });

  it("throws on markRemoved with foreign integrationId", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    expect(() => proxy.markRemoved("netatmo", "x")).toThrow(/cannot.*markRemoved/);
    expect(inner.markRemoved).not.toHaveBeenCalled();
  });

  it("throws on removeStaleDevices with foreign integrationId", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    expect(() => proxy.removeStaleDevices("netatmo", new Set())).toThrow(
      /cannot.*removeStaleDevices/,
    );
    expect(inner.removeStaleDevices).not.toHaveBeenCalled();
  });

  it("throws on migrateIntegrationId when target is foreign", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("shelly-mqtt", inner, logger);
    expect(() => proxy.migrateIntegrationId("old-id", "tasmota")).toThrow(
      /can only migrate to own id/,
    );
    expect(inner.migrateIntegrationId).not.toHaveBeenCalled();
  });

  it("allows migrateIntegrationId when target equals own id", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("shelly-mqtt", inner, logger);
    proxy.migrateIntegrationId("old-id", "shelly-mqtt");
    expect(inner.migrateIntegrationId).toHaveBeenCalledWith("old-id", "shelly-mqtt", undefined);
  });

  it("blocks admin update", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    expect(() => proxy.update("device-id", { name: "renamed" })).toThrow(/cannot.*update/);
    expect(inner.update).not.toHaveBeenCalled();
  });

  it("blocks admin delete", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    expect(() => proxy.delete("device-id")).toThrow(/cannot.*delete/);
    expect(inner.delete).not.toHaveBeenCalled();
  });

  it("passes through read methods", () => {
    const inner = makeMockDeviceManager();
    const proxy = makeDeviceManagerProxy("zigbee2mqtt", inner, logger);
    proxy.getAll();
    proxy.getById("some-id");
    proxy.getDeviceData("some-id");
    proxy.logSummary();
    expect(inner.getAll).toHaveBeenCalled();
    expect(inner.getById).toHaveBeenCalledWith("some-id");
    expect(inner.getDeviceData).toHaveBeenCalledWith("some-id");
    expect(inner.logSummary).toHaveBeenCalled();
  });
});

describe("wrapPluginMethods", () => {
  let logger: MockLogger;

  function makeStubPlugin(overrides: Partial<IntegrationPlugin> = {}): IntegrationPlugin {
    return {
      id: "stub",
      name: "Stub",
      description: "Stub plugin",
      icon: "Zap",
      getStatus: () => "connected",
      isConfigured: () => true,
      getSettingsSchema: () => [],
      start: async () => {},
      stop: async () => {},
      executeOrder: async () => {},
      ...overrides,
    };
  }

  beforeEach(() => {
    logger = makeMockLogger();
  });

  it("swallows refresh() errors and returns undefined", async () => {
    const plugin = makeStubPlugin({
      refresh: async () => {
        throw new Error("refresh boom");
      },
    });
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    await expect(wrapped.refresh?.()).resolves.toBeUndefined();
    expectError(logger, { pluginId: "stub", method: "refresh" });
  });

  it("rethrows executeOrder() errors", async () => {
    const plugin = makeStubPlugin({
      executeOrder: async () => {
        throw new Error("order boom");
      },
    });
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    await expect(
      wrapped.executeOrder({ id: "x", integrationId: "stub" } as never, "k", "v"),
    ).rejects.toThrow("order boom");
    expectError(logger, { pluginId: "stub", method: "executeOrder" });
  });

  it("rethrows start() errors", async () => {
    const plugin = makeStubPlugin({
      start: async () => {
        throw new Error("start boom");
      },
    });
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    await expect(wrapped.start()).rejects.toThrow("start boom");
  });

  it("rethrows stop() errors", async () => {
    const plugin = makeStubPlugin({
      stop: async () => {
        throw new Error("stop boom");
      },
    });
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    await expect(wrapped.stop()).rejects.toThrow("stop boom");
  });

  it('returns "error" when getStatus() throws', () => {
    const plugin = makeStubPlugin({
      getStatus: () => {
        throw new Error("status boom");
      },
    });
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    expect(wrapped.getStatus()).toBe("error");
    expectError(logger, { pluginId: "stub", method: "getStatus" });
  });

  it("returns false when isConfigured() throws", () => {
    const plugin = makeStubPlugin({
      isConfigured: () => {
        throw new Error("cfg boom");
      },
    });
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    expect(wrapped.isConfigured()).toBe(false);
  });

  it("returns [] when getSettingsSchema() throws", () => {
    const plugin = makeStubPlugin({
      getSettingsSchema: () => {
        throw new Error("schema boom");
      },
    });
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    expect(wrapped.getSettingsSchema()).toEqual([]);
  });

  it("passes through non-throwing methods", async () => {
    const plugin = makeStubPlugin();
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    expect(wrapped.getStatus()).toBe("connected");
    expect(wrapped.isConfigured()).toBe(true);
    await expect(wrapped.start()).resolves.toBeUndefined();
  });

  it("does not wrap optional methods that are not present", () => {
    const plugin = makeStubPlugin();
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    expect(wrapped.refresh).toBeUndefined();
    expect(wrapped.getOAuthUrl).toBeUndefined();
    expect(wrapped.handleOAuthCallback).toBeUndefined();
    expect(wrapped.getPollingInfo).toBeUndefined();
  });

  it("wraps optional methods that are present", () => {
    const plugin = makeStubPlugin({
      refresh: async () => {},
      getOAuthUrl: () => "https://example.com",
      getPollingInfo: () => ({ lastPollAt: new Date().toISOString(), intervalMs: 1000 }),
    });
    const wrapped = wrapPluginMethods(plugin, "stub", logger);
    expect(wrapped.refresh).toBeDefined();
    expect(wrapped.getOAuthUrl?.()).toBe("https://example.com");
    expect(wrapped.getPollingInfo?.()).toMatchObject({ intervalMs: 1000 });
  });
});
