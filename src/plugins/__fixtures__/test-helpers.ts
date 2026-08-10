import { vi, expect, type MockedFunction } from "vitest";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";

// Shared helpers for spec 111 tests (scoped-deps unit + integration).

export interface MockLogger extends Logger {
  warn: MockedFunction<Logger["warn"]>;
  error: MockedFunction<Logger["error"]>;
  info: MockedFunction<Logger["info"]>;
  debug: MockedFunction<Logger["debug"]>;
  trace: MockedFunction<Logger["trace"]>;
  fatal: MockedFunction<Logger["fatal"]>;
}

export function makeMockLogger(): MockLogger {
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: "silent",
    silent: vi.fn(),
  } as unknown as MockLogger;
  // Child returns self so the logger spy is observable through nesting
  (logger as unknown as { child: () => Logger }).child = (): Logger => logger;
  return logger;
}

/**
 * Assert that `logger.warn` was called at least once with a context object
 * matching the given partial. Asserts on the context object only, not the
 * message string, to stay stable across wording tweaks (see plan.md
 * § "Logger assertion pattern").
 */
export function expectWarn(logger: MockLogger, expected: Record<string, unknown>): void {
  expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining(expected), expect.any(String));
}

export function expectError(logger: MockLogger, expected: Record<string, unknown>): void {
  expect(logger.error).toHaveBeenCalledWith(expect.objectContaining(expected), expect.any(String));
}

// ============================================================
// SettingsManager mock — minimal in-memory store
// ============================================================

export function makeMockSettings(initial: Record<string, string> = {}): SettingsManager {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn((k: string) => store.get(k)),
    set: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    setMany: vi.fn((entries: Record<string, string>) => {
      for (const [k, v] of Object.entries(entries)) store.set(k, v);
    }),
    getAll: vi.fn(() => Object.fromEntries(store)),
    getByPrefix: vi.fn((prefix: string) => {
      const out: Record<string, string> = {};
      for (const [k, v] of store) if (k.startsWith(prefix)) out[k] = v;
      return out;
    }),
    isMqttConfigured: vi.fn(() => store.has("integration.zigbee2mqtt.mqtt_url")),
    getMqttConfig: vi.fn(() => ({
      url: store.get("integration.zigbee2mqtt.mqtt_url") ?? "mqtt://localhost",
      username: store.get("integration.zigbee2mqtt.mqtt_username"),
      password: store.get("integration.zigbee2mqtt.mqtt_password"),
      clientId: store.get("integration.zigbee2mqtt.mqtt_client_id") ?? "sowel",
    })),
    getZ2mConfig: vi.fn(() => {
      const raw = store.get("integration.zigbee2mqtt.base_topic") ?? "zigbee2mqtt";
      const baseTopics = raw
        .split(",")
        .map((entry) => entry.split(":")[0]!.trim())
        .filter(Boolean);
      return { baseTopic: baseTopics[0] ?? "zigbee2mqtt", baseTopics };
    }),
  } as unknown as SettingsManager;
}

// ============================================================
// EventBus mock — captures every emitted event
// ============================================================

export interface MockEventBus extends EventBus {
  emitted: import("../../shared/types.js").EngineEvent[];
  emit: MockedFunction<EventBus["emit"]>;
}

export function makeMockEventBus(): MockEventBus {
  const emitted: import("../../shared/types.js").EngineEvent[] = [];
  const bus = {
    emit: vi.fn((event: import("../../shared/types.js").EngineEvent) => {
      emitted.push(event);
    }),
    on: vi.fn(() => () => {}),
    onType: vi.fn(() => () => {}),
    emitted,
  } as unknown as MockEventBus;
  return bus;
}

// ============================================================
// DeviceManager mock — minimal, only what the Proxy touches
// ============================================================

export function makeMockDeviceManager(): DeviceManager {
  return {
    upsertFromDiscovery: vi.fn(),
    updateDeviceData: vi.fn(),
    updateDeviceStatus: vi.fn(),
    markRemoved: vi.fn(),
    removeStaleDevices: vi.fn(),
    migrateIntegrationId: vi.fn(() => 0),
    update: vi.fn(),
    delete: vi.fn(() => true),
    getAll: vi.fn(() => []),
    getAllWithData: vi.fn(() => []),
    getById: vi.fn(() => null),
    getByIdWithDetails: vi.fn(() => null),
    getDeviceData: vi.fn(() => []),
    getDeviceDataValue: vi.fn(() => undefined),
    getDeviceDataLastUpdated: vi.fn(() => undefined),
    getDeviceOrders: vi.fn(() => []),
    getRawExpose: vi.fn(() => null),
    getDeviceCount: vi.fn(() => 0),
    getStatusCounts: vi.fn(() => ({})),
    logSummary: vi.fn(),
  } as unknown as DeviceManager;
}
