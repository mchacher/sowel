import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import {
  OrderReceiptTracker,
  RECEIPT_GUARD_MS,
  RECEIPT_WINDOW_MS,
} from "./order-receipt-tracker.js";
import { EquipmentManager } from "./equipment-manager.js";
import { DeviceManager } from "../devices/device-manager.js";
import { ZoneManager } from "../zones/zone-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { applyMigrations } from "../test-helpers/migrations.js";
import type { EngineEvent, OrderReceiptStatus, OrderSource } from "../shared/types.js";

// Spec 188 — the receipt tracker ties a device's receipt back to the last
// order dispatched on that device/key, re-emits it per equipment, and alarms.

const logger = createLogger("silent").logger;

const GATE = { id: "eq-gate", name: "Portail", zoneId: "z-cour" };
const COOP = { id: "eq-coop", name: "Poulailler", zoneId: "z-jardin" };
const DEVICES: Record<string, { integrationId: string }> = {
  "dev-gate": { integrationId: "lora2mqtt" },
  "dev-coop": { integrationId: "lora2mqtt" },
  "dev-z2m": { integrationId: "zigbee2mqtt" },
};

let bus: EventBus;
let events: EngineEvent[];
let clock: { now: number };
let tracker: OrderReceiptTracker;

const ofType = <T extends EngineEvent["type"]>(type: T) =>
  events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);

function dispatch(
  opts: { equipment?: typeof GATE; deviceId?: string; value?: unknown; source?: OrderSource } = {},
): void {
  const equipment = opts.equipment ?? GATE;
  tracker.recordDispatch({
    deviceId: opts.deviceId ?? "dev-gate",
    orderKey: "command",
    equipmentId: equipment.id,
    alias: "command",
    value: opts.value ?? "open",
    ...(opts.source ? { source: opts.source } : {}),
  });
}

function receipt(
  status: OrderReceiptStatus,
  opts: { deviceId?: string; integrationId?: string; late?: boolean } = {},
): void {
  const deviceId = opts.deviceId ?? "dev-gate";
  bus.emit({
    type: "device.order.receipt",
    integrationId: opts.integrationId ?? DEVICES[deviceId]?.integrationId ?? "lora2mqtt",
    deviceId,
    orderKey: "command",
    status,
    ...(opts.late !== undefined ? { late: opts.late } : {}),
  });
}

describe("OrderReceiptTracker", () => {
  beforeEach(() => {
    bus = new EventBus(logger);
    events = [];
    bus.on((e) => events.push(e));
    clock = { now: 1_000_000 };
    tracker = new OrderReceiptTracker(
      bus,
      { getById: (id: string) => [GATE, COOP].find((e) => e.id === id) ?? null } as never,
      {
        getById: (id: string) => (DEVICES[id] ? { id, ...DEVICES[id] } : null),
      } as never,
      logger,
      () => clock.now,
    );
    tracker.init();
  });
  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  it("re-emits pending then delivered per equipment, without an alarm", () => {
    const source: OrderSource = { kind: "manual", userId: "u1" };
    dispatch({ source });
    receipt("pending");
    receipt("delivered");

    expect(ofType("equipment.order.receipt")).toEqual([
      {
        type: "equipment.order.receipt",
        equipmentId: GATE.id,
        orderAlias: "command",
        status: "pending",
        source,
      },
      {
        type: "equipment.order.receipt",
        equipmentId: GATE.id,
        orderAlias: "command",
        status: "delivered",
        source,
      },
    ]);
    expect(ofType("system.alarm.raised")).toHaveLength(0);
    expect(ofType("system.alarm.resolved")).toHaveLength(0);
  });

  it("raises a warning naming the equipment and the value on unconfirmed", () => {
    dispatch({ value: "open" });
    receipt("pending");
    receipt("unconfirmed");

    const raised = ofType("system.alarm.raised");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      alarmId: `order-receipt:${GATE.id}:command`,
      level: "warning",
      source: "order-receipt",
      zoneId: GATE.zoneId,
    });
    expect(raised[0].message).toContain("Portail");
    expect(raised[0].message).toContain("open");
    expect(raised[0].message).toContain("not confirmed");
    // The banner words it in the viewer's language.
    expect(raised[0]).toMatchObject({
      messageKey: "alarms.orderReceipt.unconfirmed",
      messageParams: { equipment: "Portail" },
    });
  });

  it("resolves the alarm on a late delivered, flagged late", () => {
    dispatch();
    receipt("pending");
    receipt("unconfirmed");
    receipt("delivered", { late: true });

    expect(ofType("equipment.order.receipt").at(-1)).toMatchObject({
      status: "delivered",
      late: true,
    });
    expect(ofType("system.alarm.resolved")).toEqual([
      expect.objectContaining({ alarmId: `order-receipt:${GATE.id}:command` }),
    ]);
  });

  it.each(["refused", "not_received"] as const)("raises the alarm on %s", (status) => {
    dispatch();
    receipt("pending");
    receipt(status);
    expect(ofType("system.alarm.raised")).toHaveLength(1);
    expect(ofType("equipment.order.receipt").at(-1)).toMatchObject({ status });
  });

  it("upgrades not_received to delivered and resolves the alarm", () => {
    dispatch();
    receipt("pending");
    receipt("not_received");
    receipt("delivered");

    expect(ofType("equipment.order.receipt").map((e) => e.status)).toEqual([
      "pending",
      "not_received",
      "delivered",
    ]);
    expect(ofType("equipment.order.receipt").at(-1)).toMatchObject({ late: true });
    expect(ofType("system.alarm.resolved")).toHaveLength(1);
  });

  // The integration discards a superseded order's receipts, so a late final
  // answer reaching an order in flight is that order's own.
  it("takes a late final receipt on an order in flight as its answer", () => {
    dispatch({ value: "open" });
    receipt("pending");
    receipt("received");
    receipt("delivered", { late: true });
    expect(ofType("equipment.order.receipt").map((e) => [e.status, e.late])).toEqual([
      ["pending", undefined],
      ["received", undefined],
      ["delivered", true],
    ]);
    // A late non-final status is still nothing to act on.
    dispatch();
    receipt("pending");
    receipt("received", { late: true });
    expect(ofType("equipment.order.receipt").at(-1)).toMatchObject({ status: "pending" });
  });

  it("turns an order still pending 60 s after dispatch into unconfirmed, once", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    dispatch();
    receipt("pending");
    receipt("received");
    vi.advanceTimersByTime(RECEIPT_GUARD_MS - 1);
    expect(ofType("system.alarm.raised")).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(ofType("equipment.order.receipt").at(-1)).toMatchObject({ status: "unconfirmed" });
    expect(ofType("system.alarm.raised")).toHaveLength(1);
    // The integration's own late answer still upgrades it.
    receipt("delivered", { late: true });
    expect(ofType("system.alarm.resolved")).toHaveLength(1);
  });

  it("leaves the guard idle when the answer came, or a newer order took over", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    dispatch();
    receipt("pending");
    receipt("delivered");
    dispatch({ equipment: COOP, deviceId: "dev-coop" });
    receipt("pending", { deviceId: "dev-coop" });
    dispatch({ equipment: COOP, deviceId: "dev-coop" });
    vi.advanceTimersByTime(RECEIPT_GUARD_MS * 2);
    expect(ofType("equipment.order.receipt").map((e) => e.status)).toEqual([
      "pending",
      "delivered",
      "pending",
    ]);
  });

  it("drops a receipt reaching a dispatch whose device has not answered pending yet", () => {
    dispatch({ value: "open" });
    receipt("pending");
    dispatch({ value: "close" });
    // Belongs to the first order: the second has not been acknowledged.
    receipt("delivered");
    expect(ofType("equipment.order.receipt").map((e) => e.status)).toEqual(["pending"]);
  });

  it("keeps the alarm standing when a new order only answers pending", () => {
    dispatch();
    receipt("pending");
    receipt("unconfirmed");
    dispatch();
    receipt("pending");

    expect(ofType("system.alarm.raised")).toHaveLength(1);
    expect(ofType("system.alarm.resolved")).toHaveLength(0);
    // A second failure does not raise it twice.
    receipt("unconfirmed");
    expect(ofType("system.alarm.raised")).toHaveLength(1);
    // The next confirmed order resolves it.
    dispatch();
    receipt("pending");
    receipt("delivered");
    expect(ofType("system.alarm.resolved")).toHaveLength(1);
  });

  it("ignores a receipt with no order dispatched in the last 2 minutes", () => {
    dispatch();
    clock.now += RECEIPT_WINDOW_MS + 1;
    receipt("pending");
    receipt("unconfirmed");
    receipt("pending", { deviceId: "dev-coop" });

    expect(ofType("equipment.order.receipt")).toHaveLength(0);
    expect(ofType("system.alarm.raised")).toHaveLength(0);
  });

  it("emits nothing for a device that never sends pending", () => {
    dispatch();
    receipt("delivered");
    receipt("unconfirmed");
    expect(ofType("equipment.order.receipt")).toHaveLength(0);
    expect(ofType("system.alarm.raised")).toHaveLength(0);
  });

  it("ignores a receipt for a device another integration owns", () => {
    dispatch({ deviceId: "dev-z2m" });
    receipt("pending", { deviceId: "dev-z2m", integrationId: "lora2mqtt" });
    expect(ofType("equipment.order.receipt")).toHaveLength(0);
  });

  it("keeps one equipment's receipts away from another's", () => {
    dispatch();
    dispatch({ equipment: COOP, deviceId: "dev-coop" });
    receipt("pending");
    receipt("pending", { deviceId: "dev-coop" });
    receipt("refused", { deviceId: "dev-coop" });

    const byEq = ofType("equipment.order.receipt").map((e) => [e.equipmentId, e.status]);
    expect(byEq).toEqual([
      [GATE.id, "pending"],
      [COOP.id, "pending"],
      [COOP.id, "refused"],
    ]);
    expect(ofType("system.alarm.raised")[0].alarmId).toBe(`order-receipt:${COOP.id}:command`);
  });
});

// The plugin reports `pending` from inside executeOrder (it returns at once and
// never waits for the device). The order must already be recorded by then.
describe("OrderReceiptTracker with the equipment manager", () => {
  let db: Database.Database;

  afterEach(() => db.close());

  it("records the dispatch before the plugin runs, so its first receipt lands", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    bus = new EventBus(logger);
    events = [];
    bus.on((e) => events.push(e));

    const deviceId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status, integration_id, source_device_id)
       VALUES (?, 'lora/portail', 'portail', 'portail', 'lora2mqtt', 'online', 'lora2mqtt', 'portail')`,
    ).run(deviceId);
    const orderId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO device_orders (id, device_id, key, type, enum_values) VALUES (?, ?, 'command', 'enum', '["pulse"]')`,
    ).run(orderId, deviceId);

    const plugin = {
      getStatus: () => "connected",
      executeOrder: async (device: { id: string }, orderKey: string) => {
        bus.emit({
          type: "device.order.receipt",
          integrationId: "lora2mqtt",
          deviceId: device.id,
          orderKey,
          status: "pending",
        });
      },
    };
    const deviceManager = new DeviceManager(db, bus, logger);
    const equipments = new EquipmentManager(
      db,
      bus,
      {
        getById: () => plugin,
        dispatchOrder: (_id: string, device: { id: string }, key: string) =>
          plugin.executeOrder(device, key),
      } as never,
      deviceManager,
      logger,
    );
    const zone = new ZoneManager(db, bus, logger).create({ name: "Cour" });
    const gate = equipments.create({ name: "Portail", type: "gate", zoneId: zone.id });
    equipments.addOrderBinding(gate.id, orderId, "command");

    tracker = new OrderReceiptTracker(bus, equipments, deviceManager, logger);
    equipments.registerOrderDispatchObserver((d) => tracker.recordDispatch(d));
    tracker.init();

    await equipments.executeOrder(gate.id, "command", null);

    expect(ofType("equipment.order.receipt")).toEqual([
      expect.objectContaining({ equipmentId: gate.id, orderAlias: "command", status: "pending" }),
    ]);
    tracker.destroy();
  });
});
