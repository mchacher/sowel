import { describe, it, expect } from "vitest";
import { IntegrationRegistry } from "./integration-registry.js";
import type { IntegrationPlugin } from "./integration-registry.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("silent").logger;

function createMockPlugin(overrides: Partial<IntegrationPlugin> = {}): IntegrationPlugin {
  return {
    id: "test-plugin",
    name: "Test",
    description: "Test plugin",
    icon: "Plug",
    getStatus: () => "connected",
    isConfigured: () => true,
    getSettingsSchema: () => [],
    start: async () => {},
    stop: async () => {},
    executeOrder: async () => {},
    ...overrides,
  };
}

describe("IntegrationRegistry", () => {
  describe("dispatchOrder", () => {
    it("passes dispatchConfig to v1 plugin (no apiVersion)", async () => {
      const registry = new IntegrationRegistry(logger);
      const calls: unknown[] = [];
      const plugin = createMockPlugin({
        id: "v1-plugin",
        executeOrder: async (_device, dispatchConfigOrKey, value) => {
          calls.push({ arg: dispatchConfigOrKey, value });
        },
      });
      registry.register(plugin);

      const device = {
        id: "d1",
        integrationId: "v1-plugin",
        sourceDeviceId: "dev1",
        name: "Dev1",
      } as any;
      const dispatchConfig = { topic: "z2m/dev1/set", payloadKey: "state" };
      await registry.dispatchOrder("v1-plugin", device, "state", dispatchConfig, "ON");

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ arg: dispatchConfig, value: "ON" });
    });

    it("passes orderKey string to v2 plugin", async () => {
      const registry = new IntegrationRegistry(logger);
      const calls: unknown[] = [];
      const plugin = createMockPlugin({
        id: "v2-plugin",
        apiVersion: 2,
        executeOrder: async (_device, orderKeyOrDc, value) => {
          calls.push({ arg: orderKeyOrDc, value });
        },
      });
      registry.register(plugin);

      const device = {
        id: "d1",
        integrationId: "v2-plugin",
        sourceDeviceId: "dev1",
        name: "Dev1",
      } as any;
      const dispatchConfig = { topic: "old/topic", payloadKey: "state" };
      await registry.dispatchOrder("v2-plugin", device, "state", dispatchConfig, "OPEN");

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ arg: "state", value: "OPEN" });
    });

    it("throws for unknown integration", async () => {
      const registry = new IntegrationRegistry(logger);

      const device = { id: "d1", integrationId: "unknown" } as any;
      await expect(registry.dispatchOrder("unknown", device, "state", {}, "ON")).rejects.toThrow(
        /not found/i,
      );
    });

    it("treats apiVersion 1 as v1", async () => {
      const registry = new IntegrationRegistry(logger);
      const calls: unknown[] = [];
      const plugin = createMockPlugin({
        id: "explicit-v1",
        apiVersion: 1,
        executeOrder: async (_device, arg, value) => {
          calls.push({ arg, value });
        },
      });
      registry.register(plugin);

      const device = { id: "d1" } as any;
      const dc = { topic: "test" };
      await registry.dispatchOrder("explicit-v1", device, "state", dc, "OFF");

      expect(calls[0]).toEqual({ arg: dc, value: "OFF" });
    });
  });
});
