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
    it("passes orderKey to plugin", async () => {
      const registry = new IntegrationRegistry(logger);
      const calls: unknown[] = [];
      const plugin = createMockPlugin({
        id: "test",
        executeOrder: async (_device, orderKey, value) => {
          calls.push({ orderKey, value });
        },
      });
      registry.register(plugin);

      const device = {
        id: "d1",
        integrationId: "test",
        sourceDeviceId: "dev1",
        name: "Dev1",
      } as any;
      await registry.dispatchOrder("test", device, "state", "ON");

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ orderKey: "state", value: "ON" });
    });

    it("throws for unknown integration", async () => {
      const registry = new IntegrationRegistry(logger);
      const device = { id: "d1", integrationId: "unknown" } as any;
      await expect(registry.dispatchOrder("unknown", device, "state", "ON")).rejects.toThrow(
        /not found/i,
      );
    });
  });
});
