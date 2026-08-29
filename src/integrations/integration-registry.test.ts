import { describe, it, expect, vi, afterEach } from "vitest";
import { IntegrationRegistry } from "./integration-registry.js";
import type { IntegrationPlugin } from "./integration-registry.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent, IntegrationStatus } from "../shared/types.js";

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

  // ============================================================
  // Issue #702 — connection transitions and readiness
  // ============================================================

  describe("status watch", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function setup(initial: IntegrationStatus) {
      vi.useFakeTimers();
      const registry = new IntegrationRegistry(logger);
      const eventBus = new EventBus(logger);
      const emitted: EngineEvent[] = [];
      eventBus.on((e) => emitted.push(e));
      let status = initial;
      registry.register(createMockPlugin({ id: "z2m", getStatus: () => status }));
      return {
        registry,
        eventBus,
        emitted,
        set: (s: IntegrationStatus) => {
          status = s;
        },
      };
    }

    it("emits system.integration.connected when a plugin finishes connecting", () => {
      const { registry, eventBus, emitted, set } = setup("disconnected");
      registry.startStatusWatch(eventBus);

      set("connected");
      vi.advanceTimersByTime(2000);

      expect(emitted).toEqual([{ type: "system.integration.connected", integrationId: "z2m" }]);
      registry.stopStatusWatch();
    });

    it("does not report the status it found at boot as a transition", () => {
      const { registry, eventBus, emitted } = setup("connected");
      registry.startStatusWatch(eventBus);

      vi.advanceTimersByTime(10_000);

      expect(emitted).toHaveLength(0);
      registry.stopStatusWatch();
    });

    it("emits disconnected when a connected plugin drops", () => {
      const { registry, eventBus, emitted, set } = setup("connected");
      registry.startStatusWatch(eventBus);

      set("error");
      vi.advanceTimersByTime(2000);

      expect(emitted).toEqual([{ type: "system.integration.disconnected", integrationId: "z2m" }]);
      registry.stopStatusWatch();
    });

    it("reports each transition once, not on every sweep", () => {
      const { registry, eventBus, emitted, set } = setup("disconnected");
      registry.startStatusWatch(eventBus);

      set("connected");
      vi.advanceTimersByTime(20_000);

      expect(emitted).toHaveLength(1);
      registry.stopStatusWatch();
    });

    it("survives a plugin whose getStatus throws", () => {
      vi.useFakeTimers();
      const registry = new IntegrationRegistry(logger);
      const eventBus = new EventBus(logger);
      registry.register(
        createMockPlugin({
          id: "broken",
          getStatus: () => {
            throw new Error("boom");
          },
        }),
      );
      registry.startStatusWatch(eventBus);

      expect(() => vi.advanceTimersByTime(4000)).not.toThrow();
      registry.stopStatusWatch();
    });

    it("reports recovery after a flap the sampler could not see", () => {
      const { registry, eventBus, emitted, set } = setup("connected");
      registry.startStatusWatch(eventBus);

      // The plugin dropped and recovered between two samples. Both samples read
      // "connected", so nothing would be emitted and an order held during the
      // flap would never be released.
      registry.noteUnreachable("z2m");
      set("connected");
      vi.advanceTimersByTime(2000);

      expect(emitted).toEqual([{ type: "system.integration.connected", integrationId: "z2m" }]);
      registry.stopStatusWatch();
    });

    it("ignores noteUnreachable for an integration it does not know", () => {
      const { registry, eventBus, emitted } = setup("connected");
      registry.startStatusWatch(eventBus);

      expect(() => registry.noteUnreachable("ghost")).not.toThrow();
      vi.advanceTimersByTime(4000);

      expect(emitted).toHaveLength(0);
      registry.stopStatusWatch();
    });

    it("stops sweeping once stopped", () => {
      const { registry, eventBus, emitted, set } = setup("disconnected");
      registry.startStatusWatch(eventBus);
      registry.stopStatusWatch();

      set("connected");
      vi.advanceTimersByTime(10_000);

      expect(emitted).toHaveLength(0);
    });
  });

  describe("waitForConnections", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves as soon as every configured integration is connected", async () => {
      const registry = new IntegrationRegistry(logger);
      registry.register(createMockPlugin({ id: "a", getStatus: () => "connected" }));
      registry.register(createMockPlugin({ id: "b", getStatus: () => "connected" }));

      await expect(registry.waitForConnections(5000)).resolves.toEqual({ pending: [] });
    });

    it("ignores integrations the user has not configured", async () => {
      const registry = new IntegrationRegistry(logger);
      registry.register(createMockPlugin({ id: "a", getStatus: () => "connected" }));
      registry.register(
        createMockPlugin({
          id: "unused",
          isConfigured: () => false,
          getStatus: () => "not_configured",
        }),
      );

      await expect(registry.waitForConnections(5000)).resolves.toEqual({ pending: [] });
    });

    it("does not wait on an integration that needs the user to finish setup", async () => {
      const registry = new IntegrationRegistry(logger);
      registry.register(createMockPlugin({ id: "a", getStatus: () => "connected" }));
      // Configured, but reporting not_configured: an OAuth flow it cannot
      // complete on its own. Waiting the full timeout on it delays every boot.
      registry.register(
        createMockPlugin({
          id: "oauth",
          isConfigured: () => true,
          getStatus: () => "not_configured",
        }),
      );

      await expect(registry.waitForConnections(5000)).resolves.toEqual({ pending: [] });
    });

    it("gives up after the timeout and names what is still missing", async () => {
      const registry = new IntegrationRegistry(logger);
      registry.register(createMockPlugin({ id: "a", getStatus: () => "connected" }));
      registry.register(createMockPlugin({ id: "cloud", getStatus: () => "disconnected" }));

      // One unreachable cloud integration must not hold the engine forever.
      const result = await registry.waitForConnections(600);

      expect(result).toEqual({ pending: ["cloud"] });
    });

    it("resolves once a slow integration catches up", async () => {
      const registry = new IntegrationRegistry(logger);
      let status: IntegrationStatus = "disconnected";
      registry.register(createMockPlugin({ id: "slow", getStatus: () => status }));

      const pending = registry.waitForConnections(5000);
      setTimeout(() => {
        status = "connected";
      }, 300);

      await expect(pending).resolves.toEqual({ pending: [] });
    });
  });
});
