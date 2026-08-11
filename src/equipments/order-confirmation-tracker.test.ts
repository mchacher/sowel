import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import {
  OrderConfirmationTracker,
  RETRY_CHANNEL,
  valuesMatch,
  isConfirmableValue,
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
  const integrationRegistry = {
    getById: () => ({
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
    deviceStatus["dev-1"] = "offline";
    emitOrder("OFF");

    const unconfirmed = unconfirmedEvents();
    expect(unconfirmed.length).toBe(1);
    expect(unconfirmed[0]).toMatchObject({ reason: "device_offline" });
    expect(alarmsRaised().length).toBe(1);
  });

  it("re-dispatches once when the device comes back online (incident case)", () => {
    bindingValue = "ON";
    deviceStatus["dev-1"] = "offline";
    emitOrder("OFF");
    expect(unconfirmedEvents().length).toBe(1);

    deviceStatus["dev-1"] = "online";
    eventBus.emit({
      type: "device.status_changed",
      deviceId: "dev-1",
      deviceName: "SONOFF",
      status: "online",
    });

    expect(executeOrderCalls).toEqual([{ equipmentId: "eq-1", alias: "state", value: "OFF" }]);

    // A second reconnect must not re-dispatch again.
    eventBus.emit({
      type: "device.status_changed",
      deviceId: "dev-1",
      deviceName: "SONOFF",
      status: "online",
    });
    expect(executeOrderCalls.length).toBe(1);

    // The device acts after the retry: alarm resolves.
    emitData("OFF");
    expect(alarmsResolved().length).toBe(1);
  });

  it("the retry's own order.executed event re-arms the entry without creating a new one", () => {
    bindingValue = "ON";
    deviceStatus["dev-1"] = "offline";
    emitOrder("OFF");

    // Echo of the tracker's re-dispatch coming back through the bus.
    emitOrder("OFF", { kind: "external", channel: RETRY_CHANNEL });
    vi.advanceTimersByTime(31_000);

    // One initial device_offline + one timeout after the re-armed retry window,
    // but only ONE alarm (already raised).
    expect(alarmsRaised().length).toBe(1);
  });

  it("a newer order supersedes the pending one and resolves its alarm", () => {
    bindingValue = "ON";
    emitOrder("OFF");
    vi.advanceTimersByTime(31_000);
    expect(alarmsRaised().length).toBe(1);

    emitOrder("OFF");
    expect(alarmsResolved().length).toBe(1);

    // The new order gets its own watchdog.
    vi.advanceTimersByTime(31_000);
    expect(alarmsRaised().length).toBe(2);
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
    deviceStatus["dev-1"] = "offline";
    emitOrder("OFF");

    vi.advanceTimersByTime(3_700_000); // beyond the 1h TTL
    deviceStatus["dev-1"] = "online";
    eventBus.emit({
      type: "device.status_changed",
      deviceId: "dev-1",
      deviceName: "SONOFF",
      status: "online",
    });

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
});
