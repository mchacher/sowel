import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import {
  OrderConfirmationTracker,
  RETRY_CHANNEL,
  valuesMatch,
  isConfirmableValue,
  mirrorCanReport,
} from "./order-confirmation-tracker.js";
import type { EquipmentManager } from "./equipment-manager.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { IntegrationRegistry } from "../integrations/integration-registry.js";
import type { EngineEvent } from "../shared/types.js";

const logger = createLogger("silent").logger;

// ============================================================
// Value helpers
// ============================================================

describe("valuesMatch", () => {
  it("matches boolean-like wire values across representations", () => {
    expect(valuesMatch("ON", "on")).toBe(true);
    expect(valuesMatch("ON", true)).toBe(true);
    expect(valuesMatch("OFF", false)).toBe(true);
    expect(valuesMatch("ON", "OFF")).toBe(false);
  });

  it("matches numbers regardless of representation", () => {
    expect(valuesMatch(25, "25")).toBe(true);
    expect(valuesMatch("25.0", 25)).toBe(true);
    expect(valuesMatch(25, 26)).toBe(false);
  });

  it("compares other strings case-insensitively", () => {
    expect(valuesMatch("SMART", "smart")).toBe(true);
    expect(valuesMatch("SMART", "ECO")).toBe(false);
  });
});

describe("isConfirmableValue", () => {
  it("accepts boolean-like and numeric values", () => {
    expect(isConfirmableValue("ON")).toBe(true);
    expect(isConfirmableValue(false)).toBe(true);
    expect(isConfirmableValue(25)).toBe(true);
    expect(isConfirmableValue("25")).toBe(true);
  });

  it("accepts enum members and rejects cross-vocabulary enums", () => {
    expect(isConfirmableValue("SMART", ["OFF", "SMART", "BOOST", "ECO"])).toBe(true);
    // Cover order CLOSE vs state vocabulary OPEN/CLOSED — exempt.
    expect(isConfirmableValue("CLOSE", ["OPEN", "CLOSED"])).toBe(false);
    expect(isConfirmableValue("STOP", ["OPEN", "CLOSED"])).toBe(false);
    expect(isConfirmableValue("SMART", undefined)).toBe(false);
  });
});

describe("mirrorCanReport", () => {
  it("refuses a wattage as the mirror of a boolean order, and the reverse", () => {
    expect(mirrorCanReport(true, "number")).toBe(false);
    expect(mirrorCanReport("OFF", "number")).toBe(false);
    expect(mirrorCanReport(25, "boolean")).toBe(false);
  });

  it("keeps every mirror that could actually report the value", () => {
    expect(mirrorCanReport(true, "boolean")).toBe(true);
    // An ON/OFF enum is a real mirror for a boolean order, and stays one.
    expect(mirrorCanReport(true, "enum")).toBe(true);
    expect(mirrorCanReport(25, "number")).toBe(true);
    expect(mirrorCanReport("SMART", "enum")).toBe(true);
    expect(mirrorCanReport(true, undefined)).toBe(true);
  });
});

// ============================================================
// Tracker behavior
// ============================================================

describe("OrderConfirmationTracker", () => {
  let eventBus: EventBus;
  let tracker: OrderConfirmationTracker;
  let emitted: EngineEvent[];
  let deviceStatus: Record<string, "online" | "offline">;
  let bindingValue: unknown;
  let executeOrderCalls: Array<{ equipmentId: string; alias: string; value: unknown }>;

  const equipmentManager = {
    getById: (id: string) => ({ id, name: "Pompe Piscine" }),
    getDataBindingsWithValues: vi.fn(() => [
      { alias: "state", value: bindingValue, enumValues: ["ON", "OFF"], deviceId: "dev-1" },
    ]),
    getOrderBindingsWithDetails: vi.fn(() => [{ alias: "state", deviceId: "dev-1" }]),
    executeOrder: vi.fn(async (equipmentId: string, alias: string, value: unknown) => {
      executeOrderCalls.push({ equipmentId, alias, value });
      return { success: true };
    }),
  } as unknown as EquipmentManager;

  const deviceManager = {
    getById: (id: string) => ({
      id,
      status: deviceStatus[id] ?? "online",
      integrationId: "int-1",
    }),
  } as unknown as DeviceManager;

  let pollingIntervalMs: number | null = null;
  let integrationStatus: "connected" | "disconnected" = "connected";
  let noteUnreachableCalls: string[] = [];
  const integrationRegistry = {
    noteUnreachable: (id: string) => {
      noteUnreachableCalls.push(id);
    },
    getById: () => ({
      getStatus: () => integrationStatus,
      getPollingInfo: () =>
        pollingIntervalMs === null
          ? null
          : { lastPollAt: "2026-08-11T00:00:00Z", intervalMs: pollingIntervalMs },
    }),
  } as unknown as IntegrationRegistry;

  function emitOrder(value: unknown, source?: unknown): void {
    eventBus.emit({
      type: "equipment.order.executed",
      equipmentId: "eq-1",
      orderAlias: "state",
      value,
      ...(source !== undefined ? { source } : {}),
    } as EngineEvent);
  }

  function emitData(value: unknown): void {
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: "eq-1",
      alias: "state",
      value,
      previous: null,
    });
  }

  /** Move a device's status the way an integration would, and let the bus see it. */
  function emitDeviceStatus(status: "online" | "offline"): void {
    deviceStatus["dev-1"] = status;
    eventBus.emit({
      type: "device.status_changed",
      deviceId: "dev-1",
      deviceName: "SONOFF",
      status,
    });
  }

  function alarmsRaised(): EngineEvent[] {
    return emitted.filter((e) => e.type === "system.alarm.raised");
  }
  function alarmsResolved(): EngineEvent[] {
    return emitted.filter((e) => e.type === "system.alarm.resolved");
  }
  function unconfirmedEvents(): EngineEvent[] {
    return emitted.filter((e) => e.type === "equipment.order.unconfirmed");
  }

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus(logger);
    emitted = [];
    deviceStatus = {};
    bindingValue = "OFF";
    executeOrderCalls = [];
    pollingIntervalMs = null;
    integrationStatus = "connected";
    noteUnreachableCalls = [];
    eventBus.on((event) => {
      emitted.push(event);
    });
    tracker = new OrderConfirmationTracker(
      eventBus,
      equipmentManager,
      deviceManager,
      integrationRegistry,
      logger,
    );
    tracker.init();
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  it("confirms silently when the state reports the ordered value in time", () => {
    emitOrder("ON");
    vi.advanceTimersByTime(5_000);
    emitData("ON");
    vi.advanceTimersByTime(60_000);

    expect(unconfirmedEvents().length).toBe(0);
    expect(alarmsRaised().length).toBe(0);
  });

  it("confirms immediately when the state already holds the ordered value", () => {
    bindingValue = "OFF";
    emitOrder("OFF");
    vi.advanceTimersByTime(60_000);

    expect(unconfirmedEvents().length).toBe(0);
    expect(alarmsRaised().length).toBe(0);
  });

  it("raises a warning alarm on timeout and resolves on late confirmation", () => {
    emitOrder("ON");
    vi.advanceTimersByTime(31_000);

    const unconfirmed = unconfirmedEvents();
    expect(unconfirmed.length).toBe(1);
    expect(unconfirmed[0]).toMatchObject({ reason: "timeout", value: "ON" });

    const raised = alarmsRaised();
    expect(raised.length).toBe(1);
    expect(raised[0]).toMatchObject({
      alarmId: "order-unconfirmed:eq-1:state",
      level: "warning",
      source: "order-confirmation",
    });
    expect((raised[0] as { message: string }).message).toContain("Pompe Piscine");

    emitData("ON");
    expect(alarmsResolved().length).toBe(1);
  });

  it("marks unconfirmed immediately when every target device is offline", () => {
    bindingValue = "ON";
    emitDeviceStatus("offline");
    emitOrder("OFF");

    const unconfirmed = unconfirmedEvents();
    expect(unconfirmed.length).toBe(1);
    expect(unconfirmed[0]).toMatchObject({ reason: "device_offline" });
    expect(alarmsRaised().length).toBe(1);
  });

  it("re-dispatches once when the device comes back online (incident case)", () => {
    bindingValue = "ON";
    emitDeviceStatus("offline");
    emitOrder("OFF");
    expect(unconfirmedEvents().length).toBe(1);

    emitDeviceStatus("online");

    expect(executeOrderCalls).toEqual([{ equipmentId: "eq-1", alias: "state", value: "OFF" }]);

    // A second reconnect must not re-dispatch again.
    emitDeviceStatus("online");
    expect(executeOrderCalls.length).toBe(1);

    // The device acts after the retry: alarm resolves.
    emitData("OFF");
    expect(alarmsResolved().length).toBe(1);
  });

  it("the retry's own order.executed event re-arms the entry without creating a new one", () => {
    bindingValue = "ON";
    emitDeviceStatus("offline");
    emitOrder("OFF");

    // Echo of the tracker's re-dispatch coming back through the bus.
    emitOrder("OFF", { kind: "external", channel: RETRY_CHANNEL });
    vi.advanceTimersByTime(31_000);

    // One initial device_offline + one timeout after the re-armed retry window,
    // but only ONE alarm (already raised).
    expect(alarmsRaised().length).toBe(1);
  });

  it("carries a raised alarm over to the order that supersedes it", () => {
    bindingValue = "ON";
    emitOrder("OFF");
    vi.advanceTimersByTime(31_000);
    expect(alarmsRaised().length).toBe(1);

    // The recipe re-asserts its intent: the new order gets its own watchdog,
    // but no fake recovery and no duplicate warning are pushed meanwhile.
    emitOrder("OFF");
    vi.advanceTimersByTime(31_000);
    expect(unconfirmedEvents().length).toBe(2);
    expect(alarmsResolved().length).toBe(0);
    expect(alarmsRaised().length).toBe(1);

    // Only the equipment reporting the ordered value resolves it.
    emitData("OFF");
    expect(alarmsResolved().length).toBe(1);
  });

  it("resolves a carried-over alarm when the state already holds the new order", () => {
    bindingValue = "ON";
    emitOrder("OFF");
    vi.advanceTimersByTime(31_000);
    expect(alarmsRaised().length).toBe(1);

    bindingValue = "OFF";
    emitOrder("OFF");
    expect(alarmsResolved().length).toBe(1);
  });

  it("ignores an offline status left behind by the last shutdown", () => {
    // Boot: the database still holds what the previous shutdown persisted and
    // the integration has not replayed its availability topics yet.
    deviceStatus["dev-1"] = "offline";
    emitOrder("ON");

    expect(unconfirmedEvents().length).toBe(0);
    expect(alarmsRaised().length).toBe(0);

    // Availability lands a second later, the state follows: silent confirmation.
    emitDeviceStatus("online");
    vi.advanceTimersByTime(1_000);
    emitData("ON");
    vi.advanceTimersByTime(60_000);

    expect(alarmsRaised().length).toBe(0);
  });

  it("re-dispatches on reconnect for an order sent at a device believed offline", () => {
    deviceStatus["dev-1"] = "offline";
    emitOrder("ON");
    expect(alarmsRaised().length).toBe(0);

    emitDeviceStatus("online");
    expect(executeOrderCalls).toEqual([{ equipmentId: "eq-1", alias: "state", value: "ON" }]);
  });

  it("falls back to the watchdog when a boot-time offline status turns out true", () => {
    deviceStatus["dev-1"] = "offline";
    emitOrder("ON");
    vi.advanceTimersByTime(31_000);

    // Delayed by the watchdog, but named for what the status says by then.
    expect(unconfirmedEvents()[0]).toMatchObject({ reason: "device_offline" });
    expect(alarmsRaised().length).toBe(1);
  });

  it("trusts a persisted offline status once the settle window has passed", () => {
    vi.advanceTimersByTime(61_000);
    deviceStatus["dev-1"] = "offline";
    emitOrder("ON");

    expect(unconfirmedEvents()[0]).toMatchObject({ reason: "device_offline" });
    expect(alarmsRaised().length).toBe(1);
  });

  it("exempts orders without a mirror data binding", () => {
    (equipmentManager.getDataBindingsWithValues as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      [],
    );
    emitOrder("ON");
    vi.advanceTimersByTime(60_000);

    expect(unconfirmedEvents().length).toBe(0);
    expect(alarmsRaised().length).toBe(0);
  });

  it("exempts cross-vocabulary enum orders", () => {
    (equipmentManager.getDataBindingsWithValues as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { alias: "state", value: "CLOSED", enumValues: ["OPEN", "CLOSED"], deviceId: "dev-1" },
    ]);
    emitOrder("CLOSE");
    vi.advanceTimersByTime(60_000);

    expect(alarmsRaised().length).toBe(0);
  });

  it("does not re-dispatch entries older than the TTL", () => {
    bindingValue = "ON";
    emitDeviceStatus("offline");
    emitOrder("OFF");

    vi.advanceTimersByTime(3_700_000); // beyond the 1h TTL
    emitDeviceStatus("online");

    expect(executeOrderCalls.length).toBe(0);
  });

  it("stretches the watchdog to twice the poll interval for polling integrations", () => {
    pollingIntervalMs = 60_000; // cloud integration polling every minute
    emitOrder("ON");

    // A fixed 30 s watchdog would have false-alarmed here.
    vi.advanceTimersByTime(31_000);
    expect(alarmsRaised().length).toBe(0);

    // Still pending at 2 x interval minus a margin.
    vi.advanceTimersByTime(85_000); // t = 116 s
    expect(alarmsRaised().length).toBe(0);

    // Past 2 x interval (120 s) the alarm fires.
    vi.advanceTimersByTime(10_000); // t = 126 s
    expect(alarmsRaised().length).toBe(1);
  });

  it("numeric orders confirm numerically", () => {
    (equipmentManager.getDataBindingsWithValues as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { alias: "state", value: 24, deviceId: "dev-1" },
    ]);
    emitOrder(25);
    emitData("25");
    vi.advanceTimersByTime(60_000);

    expect(alarmsRaised().length).toBe(0);
  });

  // ============================================================
  // Issue #702 — orders that never reached the wire
  // ============================================================

  describe("orders lost to a disconnected integration (#702)", () => {
    function emitOrderFailed(value: unknown, source?: unknown): void {
      eventBus.emit({
        type: "equipment.order.failed",
        equipmentId: "eq-1",
        orderAlias: "state",
        value,
        error: "Integration int-1 not connected",
        ...(source !== undefined ? { source } : {}),
      } as EngineEvent);
    }

    function emitIntegrationConnected(integrationId = "int-1"): void {
      integrationStatus = "connected";
      eventBus.emit({ type: "system.integration.connected", integrationId });
    }

    it("holds an order its integration could not carry, and replays it on connect", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      expect(executeOrderCalls).toHaveLength(0);

      emitIntegrationConnected();

      expect(executeOrderCalls).toEqual([{ equipmentId: "eq-1", alias: "state", value: "ON" }]);
    });

    it("heals a boot-window loss silently, with no alarm and no push", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      // The integration is back within the grace window, which is the ordinary
      // restart. Alarming on the failure itself would push a failure and a
      // recovery notification per held order on every reboot.
      vi.advanceTimersByTime(5_000);
      expect(alarmsRaised()).toHaveLength(0);
      expect(unconfirmedEvents()).toHaveLength(0);

      emitIntegrationConnected();
      emitData("ON");
      vi.advanceTimersByTime(120_000);

      expect(executeOrderCalls).toHaveLength(1);
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("surfaces the loss once the integration stays away", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      vi.advanceTimersByTime(60_001);

      expect(unconfirmedEvents()).toHaveLength(1);
      expect(unconfirmedEvents()[0]).toMatchObject({ reason: "integration_disconnected" });
      expect(alarmsRaised()).toHaveLength(1);
    });

    it("replays once only, however many times the integration reconnects", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      emitIntegrationConnected();
      emitIntegrationConnected();
      emitIntegrationConnected();

      expect(executeOrderCalls).toHaveLength(1);
    });

    it("does not replay an order when a different integration connects", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      emitIntegrationConnected("some-other-integration");

      expect(executeOrderCalls).toHaveLength(0);
    });

    it("does not replay a command whose window has passed", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      // A schedule-driven OFF replayed long after its slot would be worse than
      // the command that was lost, so the replay window is short.
      vi.advanceTimersByTime(300_001);
      emitIntegrationConnected();

      expect(executeOrderCalls).toHaveLength(0);
      // The alarm stays raised: the order genuinely never landed.
      expect(alarmsResolved()).toHaveLength(0);
    });

    it("applies the same short window to the device-online trigger", () => {
      // Both triggers must agree on the window. The device path used to carry
      // a one hour TTL, which silently overrode this one: an integration
      // reconnect correctly declined the replay, and the device coming online
      // a moment later did it anyway.
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      vi.advanceTimersByTime(300_001);
      emitDeviceStatus("online");

      expect(executeOrderCalls).toHaveLength(0);
    });

    it("still replays on device-online when the connect event was missed", () => {
      // A plugin that drops and recovers between two status sweeps emits no
      // connected event, so the device path is the remaining way out.
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      integrationStatus = "connected";
      emitDeviceStatus("online");

      expect(executeOrderCalls).toHaveLength(1);
    });

    it("releases a stateless order's inherited alarm instead of orphaning it", () => {
      // An alarmed order superseded by one nothing can confirm: the entry is
      // dropped after its replay, so the alarm has to be resolved here or it
      // stands until the next restart.
      emitOrder("ON");
      vi.advanceTimersByTime(60_000);
      expect(alarmsRaised()).toHaveLength(1);

      (equipmentManager.getDataBindingsWithValues as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        [],
      );
      integrationStatus = "disconnected";
      emitOrderFailed("WAKE");

      expect(alarmsResolved()).toHaveLength(1);
    });

    it("marks the integration unreachable so a flap still produces a transition", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      expect(noteUnreachableCalls).toEqual(["int-1"]);
    });

    it("resolves the alarm when the replayed order is finally observed", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");
      vi.advanceTimersByTime(60_001);
      expect(alarmsRaised()).toHaveLength(1);

      emitIntegrationConnected();
      emitData("ON");

      expect(alarmsResolved()).toHaveLength(1);
    });

    it("does not enrol its own replay when that fails again", () => {
      integrationStatus = "disconnected";
      emitOrderFailed("ON");
      emitIntegrationConnected();
      expect(executeOrderCalls).toHaveLength(1);

      // The replay lands while the integration has dropped again.
      integrationStatus = "disconnected";
      emitOrderFailed("ON", { kind: "external", channel: RETRY_CHANNEL });
      emitIntegrationConnected();

      // Still one: a replay that fails must not start the cycle over.
      expect(executeOrderCalls).toHaveLength(1);
    });

    it("ignores a failure raised by an integration that was connected", () => {
      // A plugin that threw while reachable is a different problem, with no
      // reconnect signal to hang a replay on.
      integrationStatus = "connected";
      emitOrderFailed("ON");

      expect(unconfirmedEvents()).toHaveLength(0);
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("ignores an order the equipment already satisfies", () => {
      bindingValue = "ON";
      integrationStatus = "disconnected";
      emitOrderFailed("ON");

      expect(alarmsRaised()).toHaveLength(0);
      expect(unconfirmedEvents()).toHaveLength(0);
    });

    it("replays a stateless order without raising an alarm nothing could resolve", () => {
      (equipmentManager.getDataBindingsWithValues as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        [],
      );
      integrationStatus = "disconnected";
      emitOrderFailed("WAKE");

      expect(alarmsRaised()).toHaveLength(0);

      emitIntegrationConnected();

      expect(executeOrderCalls).toEqual([{ equipmentId: "eq-1", alias: "state", value: "WAKE" }]);
    });
  });
});

// ============================================================
// Issue #901 — the alias is not a vocabulary
//
// A submetered thermostat: the `power` order is a boolean sent to the cloud
// device, while the `power` data binding is the wattage read from a clamp on
// the same appliance. Measured on production before this fix: 15 power orders,
// 15 alarms, and every one of them a false positive.
// ============================================================

describe("OrderConfirmationTracker — submetered thermostat (issue #901)", () => {
  let eventBus: EventBus;
  let tracker: OrderConfirmationTracker;
  let emitted: EngineEvent[];
  /** What the Panasonic device itself publishes under `power`, or null. */
  let devicePower: boolean | null;
  /** Bindings of the equipment: the clamp wattage, plus optionally the device state. */
  let bindings: Record<string, unknown>[];

  const equipmentManager = {
    getById: (id: string) => ({ id, name: "PAC" }),
    getDataBindingsWithValues: vi.fn(() => bindings),
    getOrderBindingsWithDetails: vi.fn(() => [
      { alias: "power", deviceId: "dev-pac", key: "power" },
    ]),
    executeOrder: vi.fn(async () => ({ success: true })),
  } as unknown as EquipmentManager;

  const deviceManager = {
    getById: (id: string) => ({
      id,
      status: "online",
      integrationId: "panasonic_cc",
      sourceDeviceId: `src-${id}`,
    }),
    getDeviceDataValue: (_integrationId: string, sourceDeviceId: string, key: string) =>
      sourceDeviceId === "src-dev-pac" && key === "power" ? devicePower : null,
  } as unknown as DeviceManager;

  const integrationRegistry = {
    noteUnreachable: () => {},
    getById: () => ({
      getStatus: () => "connected",
      // The real plugin polls every 300 s, so the watchdog is 600 s.
      getPollingInfo: () => ({ lastPollAt: "2026-09-04T00:00:00Z", intervalMs: 300_000 }),
    }),
  } as unknown as IntegrationRegistry;

  function emitOrder(value: unknown): void {
    eventBus.emit({
      type: "equipment.order.executed",
      equipmentId: "eq-pac",
      orderAlias: "power",
      value,
    } as EngineEvent);
  }

  /** The Panasonic device reporting its own state, one poll later. */
  function emitDevicePower(value: boolean): void {
    devicePower = value;
    eventBus.emit({
      type: "device.data.updated",
      deviceId: "dev-pac",
      deviceName: "PAC",
      dataId: "dd-1",
      key: "power",
      value,
      previous: !value,
      timestamp: "2026-09-04T10:36:00Z",
    } as EngineEvent);
  }

  function alarmsRaised(): EngineEvent[] {
    return emitted.filter((e) => e.type === "system.alarm.raised");
  }
  function unconfirmedEvents(): EngineEvent[] {
    return emitted.filter((e) => e.type === "equipment.order.unconfirmed");
  }

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus(logger);
    emitted = [];
    devicePower = false;
    bindings = [{ alias: "power", value: 646, type: "number", deviceId: "dev-clamp" }];
    eventBus.on((event) => {
      emitted.push(event);
    });
    tracker = new OrderConfirmationTracker(
      eventBus,
      equipmentManager,
      deviceManager,
      integrationRegistry,
      logger,
    );
    tracker.init();
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  it("confirms from the ordered device's own state when a wattage holds the alias", () => {
    emitOrder(true);
    vi.advanceTimersByTime(120_000);
    emitDevicePower(true);
    vi.advanceTimersByTime(600_000);

    expect(unconfirmedEvents().length).toBe(0);
    expect(alarmsRaised().length).toBe(0);
  });

  it("still alarms when the ordered device reports the opposite state", () => {
    emitOrder(true);
    // The device answers, and says it did not switch: that is a real failure.
    emitDevicePower(false);
    vi.advanceTimersByTime(601_000);

    expect(unconfirmedEvents().length).toBe(1);
    expect(alarmsRaised().length).toBe(1);
  });

  it("stays out of the alarm surface when nothing could report the value", () => {
    // The cloud device publishes no state under the order key either.
    devicePower = null;
    emitOrder(true);
    vi.advanceTimersByTime(601_000);

    expect(unconfirmedEvents().length).toBe(0);
    expect(alarmsRaised().length).toBe(0);
  });

  it("prefers a binding on the ordered device over one on another device", () => {
    bindings = [
      { alias: "power", value: 646, type: "number", deviceId: "dev-clamp" },
      { alias: "power", value: true, type: "boolean", deviceId: "dev-pac" },
    ];

    // Already in the ordered state, seen through the right binding: nothing to
    // watch. Against the clamp, `true` versus `646` would have armed a
    // watchdog that could only expire.
    emitOrder(true);
    vi.advanceTimersByTime(601_000);

    expect(unconfirmedEvents().length).toBe(0);
    expect(alarmsRaised().length).toBe(0);
  });
});
