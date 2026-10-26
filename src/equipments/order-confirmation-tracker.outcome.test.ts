import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import {
  OrderConfirmationTracker,
  GATE_OPEN_WINDOW_MS,
  GATE_CLOSE_WINDOW_MS,
  END_STATE_WINDOW_MS,
} from "./order-confirmation-tracker.js";
import type { EquipmentManager } from "./equipment-manager.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { IntegrationRegistry } from "../integrations/integration-registry.js";
import type { EngineEvent } from "../shared/types.js";

// ============================================================
// Spec 188 — order outcome from reported state.
//
// Shapes from a live instance: the gate "Portail" (type gate, order `command`
// enum [pulse], data `closed` + virtual `state`), and the coop door (type
// shutter, order alias `state` key `door` OPEN/CLOSE/STOP, data `door`
// OPENING/OPEN/CLOSING/CLOSED/FAULT/UNKNOWN and `position` 0/50/100, `why` on
// the same device).
// ============================================================

const logger = createLogger("silent").logger;

type Outcome = Extract<EngineEvent, { type: "equipment.order.outcome" }>;

interface Binding {
  alias: string;
  value: unknown;
  deviceId: string;
  key: string;
  type?: string;
  enumValues?: string[];
}

describe("OrderConfirmationTracker — spec 188 outcomes", () => {
  let eventBus: EventBus;
  let tracker: OrderConfirmationTracker;
  let emitted: EngineEvent[];
  let equipmentType: string;
  let invertDirection: boolean;
  let bindings: Binding[];
  let orderBindings: { alias: string; deviceId: string; key: string }[];
  let deviceStatus: Record<string, "online" | "offline">;
  let deviceData: Record<string, unknown>;
  let integrationStatus: "connected" | "disconnected";
  let executeOrderCalls: unknown[];

  const equipmentManager = {
    getById: (id: string) => ({ id, name: "Portail", type: equipmentType, invertDirection }),
    getDataBindingsWithValues: () => bindings,
    getOrderBindingsWithDetails: () => orderBindings,
    executeOrder: vi.fn(async (...args: unknown[]) => {
      executeOrderCalls.push(args);
      return { success: true };
    }),
  } as unknown as EquipmentManager;

  const deviceManager = {
    getById: (id: string) => ({
      id,
      status: deviceStatus[id] ?? "online",
      integrationId: "lora",
      sourceDeviceId: id,
    }),
    getDeviceDataValue: (_integrationId: string, sourceDeviceId: string, key: string) =>
      deviceData[`${sourceDeviceId}:${key}`] ?? null,
  } as unknown as DeviceManager;

  const integrationRegistry = {
    noteUnreachable: () => {},
    getById: () => ({
      getStatus: () => integrationStatus,
      getPollingInfo: () => null,
    }),
  } as unknown as IntegrationRegistry;

  const outcomes = (): Outcome[] =>
    emitted.filter((e): e is Outcome => e.type === "equipment.order.outcome");
  const statuses = (): string[] => outcomes().map((o) => o.status);
  const alarmsRaised = () => emitted.filter((e) => e.type === "system.alarm.raised");
  const alarmsResolved = () => emitted.filter((e) => e.type === "system.alarm.resolved");

  function order(alias: string, value: unknown): void {
    eventBus.emit({
      type: "equipment.order.executed",
      equipmentId: "eq-1",
      orderAlias: alias,
      value,
      source: { kind: "manual", userId: "u1" },
    });
  }

  function equipmentData(alias: string, value: unknown): void {
    const b = bindings.find((x) => x.alias === alias);
    if (b) b.value = value;
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: "eq-1",
      alias,
      value,
      previous: null,
    });
  }

  function deviceReport(deviceId: string, key: string, value: unknown): void {
    deviceData[`${deviceId}:${key}`] = value;
    eventBus.emit({
      type: "device.data.updated",
      deviceId,
      deviceName: deviceId,
      dataId: `${deviceId}:${key}`,
      key,
      value,
      previous: null,
      timestamp: new Date().toISOString(),
    });
  }

  function gate(closed: unknown): void {
    equipmentType = "gate";
    bindings = [
      { alias: "closed", value: closed, deviceId: "portail", key: "closed", type: "boolean" },
      {
        alias: "state",
        value: closed === true ? "closed" : closed === false ? "open" : "unknown",
        deviceId: "",
        key: "gate_state",
        type: "enum",
      },
    ];
    orderBindings = [{ alias: "command", deviceId: "portail", key: "cmd" }];
  }

  function coop(door: string, pos: number | null = null): void {
    equipmentType = "shutter";
    bindings = [
      { alias: "door", value: door, deviceId: "coop", key: "door", type: "enum" },
      { alias: "position", value: pos, deviceId: "coop", key: "pos", type: "number" },
    ];
    orderBindings = [{ alias: "state", deviceId: "coop", key: "door" }];
    deviceData["coop:door"] = door;
    if (pos !== null) deviceData["coop:pos"] = pos;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus(logger);
    emitted = [];
    deviceStatus = {};
    deviceData = {};
    invertDirection = false;
    integrationStatus = "connected";
    executeOrderCalls = [];
    eventBus.on((e) => emitted.push(e));
    tracker = new OrderConfirmationTracker(
      eventBus,
      equipmentManager,
      deviceManager,
      integrationRegistry,
      logger,
    );
    tracker.init();
    // Past the status settle window, so an offline status is evidence.
    vi.advanceTimersByTime(61_000);
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  // ── transition (O2) ─────────────────────────────────────────

  describe("gate impulse", () => {
    it("closed gate opening 2 s after the pulse: pending then confirmed, expected open, no alarm", () => {
      gate(true);
      order("command", "pulse");
      vi.advanceTimersByTime(2_000);
      equipmentData("closed", false);
      expect(statuses()).toEqual(["pending", "confirmed"]);
      expect(outcomes().every((o) => o.expected === "open")).toBe(true);
      vi.advanceTimersByTime(GATE_CLOSE_WINDOW_MS);
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("closed gate with nothing for 15 s: unconfirmed, localized alarm raised", () => {
      gate(true);
      order("command", "pulse");
      vi.advanceTimersByTime(GATE_OPEN_WINDOW_MS - 1);
      expect(statuses()).toEqual(["pending"]);
      vi.advanceTimersByTime(1);
      expect(statuses()).toEqual(["pending", "unconfirmed"]);
      expect(alarmsRaised()).toEqual([
        expect.objectContaining({
          alarmId: "order-unconfirmed:eq-1:command",
          level: "warning",
          messageKey: "alarms.orderOutcome.unconfirmedNoMovement",
          messageParams: { equipment: "Portail" },
        }),
      ]);
    });

    it("open gate closing after 40 s: confirmed, expected close", () => {
      gate(false);
      order("command", "pulse");
      vi.advanceTimersByTime(40_000);
      equipmentData("closed", true);
      expect(statuses()).toEqual(["pending", "confirmed"]);
      expect(outcomes()[1].expected).toBe("close");
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("open gate with nothing for 60 s: unconfirmed, alarm « still open »", () => {
      gate(false);
      order("command", "pulse");
      vi.advanceTimersByTime(GATE_CLOSE_WINDOW_MS);
      expect(statuses()).toEqual(["pending", "unconfirmed"]);
      expect(alarmsRaised()[0]).toMatchObject({
        messageKey: "alarms.orderOutcome.unconfirmedStillOpen",
      });
    });

    it("unconfirmed, then the gate closes at 90 s: alarm resolved and outcome confirmed", () => {
      gate(false);
      order("command", "pulse");
      vi.advanceTimersByTime(90_000);
      equipmentData("closed", true);
      expect(statuses()).toEqual(["pending", "unconfirmed", "confirmed"]);
      expect(alarmsResolved()).toHaveLength(1);
    });

    it("a flip long after the window resolves the alarm but is not shown as this order's outcome", () => {
      gate(true);
      order("command", "pulse");
      vi.advanceTimersByTime(3 * 3_600_000);
      equipmentData("closed", false);
      expect(statuses()).toEqual(["pending", "unconfirmed"]);
      expect(alarmsResolved()).toHaveLength(1);
    });

    it("an exempt pulse (state unknown) does not resolve the previous pulse's alarm", () => {
      gate(true);
      order("command", "pulse");
      vi.advanceTimersByTime(GATE_OPEN_WINDOW_MS);
      expect(alarmsRaised()).toHaveLength(1);
      bindings[0].value = null;
      order("command", "pulse");
      expect(alarmsResolved()).toHaveLength(0);
      // The expected state still resolves it.
      equipmentData("closed", false);
      expect(alarmsResolved()).toHaveLength(1);
    });

    it("gate state unknown: exempt, nothing emitted, no alarm", () => {
      gate(null);
      order("command", "pulse");
      vi.advanceTimersByTime(GATE_CLOSE_WINDOW_MS * 2);
      expect(outcomes()).toHaveLength(0);
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("gate device offline: exempt, nothing emitted, no alarm", () => {
      gate(true);
      deviceStatus.portail = "offline";
      order("command", "pulse");
      vi.advanceTimersByTime(GATE_CLOSE_WINDOW_MS * 2);
      expect(outcomes()).toHaveLength(0);
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("reads the derived `state` when the gate has no `closed` binding", () => {
      gate(true);
      bindings = bindings.filter((b) => b.alias !== "closed");
      order("command", "pulse");
      equipmentData("state", "unknown"); // the engine's own pending toggle
      expect(statuses()).toEqual(["pending"]);
      equipmentData("state", "open");
      expect(statuses()).toEqual(["pending", "confirmed"]);
    });

    it("opens then closes inside the window: confirmed once, at the opening", () => {
      gate(true);
      order("command", "pulse");
      equipmentData("closed", true); // heartbeat of the state at dispatch
      expect(statuses()).toEqual(["pending"]);
      equipmentData("closed", false);
      equipmentData("closed", true);
      expect(statuses()).toEqual(["pending", "confirmed"]);
    });

    it("second pulse during the window: first cancelled, new expectation from the current state", () => {
      gate(true);
      order("command", "pulse");
      vi.advanceTimersByTime(3_000);
      // The gate opened but the report was lost; the state now reads open.
      bindings[0].value = false;
      order("command", "pulse");
      vi.advanceTimersByTime(GATE_OPEN_WINDOW_MS);
      // The first order's 15 s window was cancelled: no unconfirmed for it.
      expect(statuses()).toEqual(["pending", "pending"]);
      expect(outcomes()[1].expected).toBe("close");
      equipmentData("closed", true);
      expect(statuses()).toEqual(["pending", "pending", "confirmed"]);
      expect(alarmsRaised()).toHaveLength(0);
    });
  });

  // ── end_state (O3) ──────────────────────────────────────────

  describe("cover / door", () => {
    it("CLOSE on an open door, then CLOSING, CLOSED: pending, moving, confirmed", () => {
      coop("OPEN", 100);
      deviceReport("coop", "door", "CLOSED"); // vocabulary seen earlier
      deviceReport("coop", "door", "OPEN");
      order("state", "CLOSE");
      deviceReport("coop", "door", "CLOSING");
      deviceReport("coop", "door", "CLOSED");
      expect(statuses()).toEqual(["pending", "moving", "confirmed"]);
      expect(outcomes()[0].expected).toBe("close");
    });

    it("OPEN confirmed by position 100 without a door change", () => {
      coop("CLOSED", 0);
      order("state", "OPEN");
      equipmentData("position", 100);
      expect(statuses()).toEqual(["pending", "confirmed"]);
    });

    it("CLOSE then FAULT with why = BOTTOM: fault with the detail, alarm raised", () => {
      coop("OPEN", 100);
      deviceReport("coop", "door", "CLOSED");
      deviceReport("coop", "door", "OPEN");
      order("state", "CLOSE");
      deviceData["coop:why"] = "BOTTOM";
      deviceReport("coop", "door", "FAULT");
      expect(statuses()).toEqual(["pending", "fault"]);
      expect(outcomes()[1].detail).toBe("BOTTOM");
      expect(alarmsRaised()[0]).toMatchObject({
        messageKey: "alarms.orderOutcome.faultBottom",
        messageParams: { equipment: "Portail" },
      });
      expect(emitted).toContainEqual(
        expect.objectContaining({ type: "equipment.order.unconfirmed", reason: "device_fault" }),
      );
    });

    it("a reason landing after the FAULT is added to the line", () => {
      coop("FAULT", 50);
      order("state", "CLOSE");
      deviceReport("coop", "door", "FAULT");
      expect(outcomes()[1]).toMatchObject({ status: "fault" });
      expect(outcomes()[1].detail).toBeUndefined();
      deviceReport("coop", "why", "WIRING");
      expect(outcomes()[2]).toMatchObject({ status: "fault", detail: "WIRING" });
    });

    it("fault, then CLOSED reported later: alarm resolved", () => {
      coop("CLOSING", 50);
      order("state", "CLOSE");
      deviceReport("coop", "door", "FAULT");
      vi.advanceTimersByTime(5 * 60_000);
      deviceReport("coop", "door", "CLOSED");
      expect(statuses()).toEqual(["pending", "fault", "confirmed"]);
      expect(alarmsRaised()).toHaveLength(1);
      expect(alarmsResolved()).toHaveLength(1);
    });

    it("CLOSE while the door is already CLOSED: confirmed at once", () => {
      coop("CLOSED", 0);
      order("state", "CLOSE");
      expect(statuses()).toEqual(["confirmed"]);
      vi.advanceTimersByTime(END_STATE_WINDOW_MS * 2);
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("a shutter inverted in Sowel is left to spec 141", () => {
      coop("CLOSED", 0);
      deviceReport("coop", "door", "CLOSED");
      invertDirection = true;
      order("state", "OPEN");
      vi.advanceTimersByTime(END_STATE_WINDOW_MS * 2);
      expect(outcomes()).toHaveLength(0);
    });

    it("STOP: exempt", () => {
      coop("CLOSING", 50);
      order("state", "STOP");
      vi.advanceTimersByTime(END_STATE_WINDOW_MS * 2);
      expect(outcomes()).toHaveLength(0);
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("UNKNOWN reported, nothing else for 60 s: unconfirmed", () => {
      coop("CLOSED", 0);
      order("state", "OPEN");
      deviceReport("coop", "door", "UNKNOWN");
      vi.advanceTimersByTime(END_STATE_WINDOW_MS);
      expect(statuses()).toEqual(["pending", "unconfirmed"]);
      expect(alarmsRaised()[0]).toMatchObject({ messageKey: "alarms.orderOutcome.unconfirmed" });
    });
  });

  // ── vocabulary guard (O4) ───────────────────────────────────

  describe("vocabulary guard", () => {
    it("a Zigbee2MQTT-like cover reporting only OPEN / CLOSE stays exempt", () => {
      equipmentType = "shutter";
      bindings = [
        {
          alias: "state",
          value: "OPEN",
          deviceId: "z2m-cover",
          key: "state",
          type: "enum",
          enumValues: ["OPEN", "CLOSE", "STOP"],
        },
        { alias: "position", value: 100, deviceId: "z2m-cover", key: "position" },
      ];
      orderBindings = [{ alias: "state", deviceId: "z2m-cover", key: "state" }];
      deviceReport("z2m-cover", "state", "CLOSE");
      deviceReport("z2m-cover", "state", "OPEN");
      order("state", "CLOSE");
      equipmentData("position", 0); // position alone never enables the mapping
      equipmentData("state", "CLOSE"); // the cover echoes the command (spec 141)
      vi.advanceTimersByTime(END_STATE_WINDOW_MS * 2);
      expect(outcomes()).toHaveLength(0);
      expect(alarmsRaised()).toHaveLength(0);
    });

    it("a device that reported CLOSED once since start, now OPEN, is tracked", () => {
      coop("OPEN", 100);
      deviceReport("coop", "door", "CLOSED");
      deviceReport("coop", "door", "OPEN");
      order("state", "CLOSE");
      expect(statuses()).toEqual(["pending"]);
    });

    it("a door reading OPEN with no end-state word seen since start stays exempt", () => {
      coop("OPEN", 100);
      order("state", "CLOSE");
      vi.advanceTimersByTime(END_STATE_WINDOW_MS * 2);
      expect(outcomes()).toHaveLength(0);
      expect(alarmsRaised()).toHaveLength(0);
    });
  });

  // ── never replayed (O9) ─────────────────────────────────────

  describe("no replay", () => {
    it("an unconfirmed pulse is not re-dispatched when the gate device comes back online", () => {
      gate(true);
      order("command", "pulse");
      vi.advanceTimersByTime(GATE_OPEN_WINDOW_MS);
      eventBus.emit({
        type: "device.status_changed",
        deviceId: "portail",
        deviceName: "portail",
        status: "online",
      });
      expect(executeOrderCalls).toHaveLength(0);
    });

    it("a pulse while the integration is down is not replayed when it connects; unconfirmed after the grace", () => {
      gate(true);
      integrationStatus = "disconnected";
      eventBus.emit({
        type: "equipment.order.failed",
        equipmentId: "eq-1",
        orderAlias: "command",
        value: "pulse",
        error: "integration disconnected",
      });
      integrationStatus = "connected";
      eventBus.emit({ type: "system.integration.connected", integrationId: "lora" });
      eventBus.emit({
        type: "device.status_changed",
        deviceId: "portail",
        deviceName: "portail",
        status: "online",
      });
      expect(executeOrderCalls).toHaveLength(0);
      vi.advanceTimersByTime(60_000);
      expect(statuses()).toEqual(["unconfirmed"]);
      // Held like a stateless order: no alarm, and nothing left pending.
      expect(alarmsRaised()).toHaveLength(0);
      equipmentData("closed", false);
      expect(statuses()).toEqual(["unconfirmed"]);
    });

    it("a coop CLOSE while the integration is down is not replayed either", () => {
      coop("OPEN", 100);
      deviceReport("coop", "door", "CLOSED");
      deviceReport("coop", "door", "OPEN");
      integrationStatus = "disconnected";
      eventBus.emit({
        type: "equipment.order.failed",
        equipmentId: "eq-1",
        orderAlias: "state",
        value: "CLOSE",
        error: "integration disconnected",
      });
      eventBus.emit({ type: "system.integration.connected", integrationId: "lora" });
      expect(executeOrderCalls).toHaveLength(0);
    });
  });

  it("orders outside O1 emit no outcome (a light ON)", () => {
    equipmentType = "light_onoff";
    bindings = [{ alias: "state", value: "OFF", deviceId: "l1", key: "state", type: "boolean" }];
    orderBindings = [{ alias: "state", deviceId: "l1", key: "state" }];
    order("state", "ON");
    equipmentData("state", "ON");
    expect(outcomes()).toHaveLength(0);
  });
});
