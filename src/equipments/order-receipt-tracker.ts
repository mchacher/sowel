import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { EquipmentManager, OrderDispatch } from "./equipment-manager.js";
import type { OrderReceiptStatus } from "../shared/types.js";

// ============================================================
// Spec 188 — order delivery receipt
//
// `executeOrder` resolving means the order reached the integration. Some
// integrations (LoRa) can say more: what the device made of it. They report it
// as `device.order.receipt`, keyed by device and order key. This tracker ties
// each receipt back to the last order dispatched on that device/key, re-emits
// it at the equipment level for the UI and shared access, and raises an alarm
// when the device refused the order, never got it, or never confirmed it.
//
// It never resends anything: an impulse resent after a lost receipt reverses a
// gate (decided 2026-10-26).
// ============================================================

/** A receipt for an order older than this is not about anything we remember. */
export const RECEIPT_WINDOW_MS = 120_000;

const ALARM_SOURCE = "order-receipt";

const FAILURES: ReadonlySet<OrderReceiptStatus> = new Set([
  "refused",
  "not_received",
  "unconfirmed",
]);
const UPGRADABLE: ReadonlySet<OrderReceiptStatus> = new Set(["not_received", "unconfirmed"]);

interface DispatchRecord extends OrderDispatch {
  at: number;
  /** Null until the device answers `pending` for THIS dispatch. */
  status: OrderReceiptStatus | null;
}

/**
 * Whether `next` may follow `current` for one order. Decides, without an
 * order id on the wire, which receipts belong to the order we remember:
 *
 * - nothing before `pending`: a receipt reaching a dispatch whose device has
 *   not yet said it would answer belongs to the order this one replaced, or
 *   comes from a device that never answers;
 * - a `late` receipt only upgrades a `not_received` / `unconfirmed`: on an
 *   order still in flight it can only be the previous order's;
 * - `delivered` and `refused` are final; `not_received` and `unconfirmed` can
 *   still become `delivered` or `refused`.
 */
function accepts(
  current: OrderReceiptStatus | null,
  next: OrderReceiptStatus,
  late: boolean,
): boolean {
  if (current === null) return next === "pending";
  if (current === "pending" || current === "received") {
    if (late) return false;
    return next !== "pending" && next !== current;
  }
  if (UPGRADABLE.has(current)) return next === "delivered" || next === "refused";
  return false;
}

export class OrderReceiptTracker {
  private readonly logger: Logger;
  private readonly orders = new Map<string, DispatchRecord>();
  /** `equipmentId:alias` with a receipt alarm standing. */
  private readonly raised = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly equipmentManager: Pick<EquipmentManager, "getById">,
    private readonly deviceManager: Pick<DeviceManager, "getById">,
    logger: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.logger = logger.child({ module: "order-receipt-tracker" });
  }

  init(): void {
    this.unsubscribe = this.eventBus.onType("device.order.receipt", (event) => {
      try {
        this.handleReceipt(
          event.integrationId,
          event.deviceId,
          event.orderKey,
          event.status,
          event.late === true,
        );
      } catch (err) {
        this.logger.error({ err }, "Order receipt handling failed");
      }
    });
    this.logger.info("Order receipt tracker started");
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.orders.clear();
    this.raised.clear();
  }

  /**
   * Called by the equipment manager just before an order is handed to the
   * plugin. A second order on the same device/key replaces the first.
   */
  recordDispatch(dispatch: OrderDispatch): void {
    const now = this.now();
    this.orders.set(`${dispatch.deviceId}:${dispatch.orderKey}`, {
      ...dispatch,
      at: now,
      status: null,
    });
    // Keep the table to what can still be answered.
    for (const [key, rec] of this.orders) {
      if (now - rec.at > RECEIPT_WINDOW_MS) this.orders.delete(key);
    }
  }

  private handleReceipt(
    integrationId: string,
    deviceId: string,
    orderKey: string,
    status: OrderReceiptStatus,
    late: boolean,
  ): void {
    // The event bus proxy already pins integrationId to the emitting plugin;
    // this pins the device to that integration, so a plugin cannot report on
    // another integration's devices.
    const device = this.deviceManager.getById(deviceId);
    if (!device || device.integrationId !== integrationId) {
      this.logger.warn(
        { integrationId, deviceId, orderKey, status },
        "Order receipt ignored: device not owned by the reporting integration",
      );
      return;
    }

    const key = `${deviceId}:${orderKey}`;
    const rec = this.orders.get(key);
    if (!rec || this.now() - rec.at > RECEIPT_WINDOW_MS) {
      this.logger.debug({ deviceId, orderKey, status }, "Order receipt with no recent order");
      return;
    }
    if (!accepts(rec.status, status, late)) {
      this.logger.debug(
        { deviceId, orderKey, status, late, current: rec.status },
        "Order receipt does not belong to the last order",
      );
      return;
    }

    const upgraded = rec.status !== null && UPGRADABLE.has(rec.status);
    rec.status = status;
    const isLate = late || upgraded;

    const level = FAILURES.has(status) ? "warn" : "info";
    if (status !== "pending" && status !== "received") {
      this.logger[level](
        {
          equipmentId: rec.equipmentId,
          alias: rec.alias,
          value: rec.value,
          status,
          ...(isLate ? { late: true } : {}),
        },
        "Order receipt",
      );
    }

    this.eventBus.emit({
      type: "equipment.order.receipt",
      equipmentId: rec.equipmentId,
      orderAlias: rec.alias,
      status,
      ...(isLate ? { late: true } : {}),
      ...(rec.source !== undefined ? { source: rec.source } : {}),
    });

    this.updateAlarm(rec, status);
  }

  /**
   * R3 — a failure raises the alarm once; only `delivered` resolves it. A new
   * order merely answering `pending` leaves it standing, as spec 141 does for
   * a superseded order: "recovered" means the device confirmed something.
   */
  private updateAlarm(rec: DispatchRecord, status: OrderReceiptStatus): void {
    const id = `${rec.equipmentId}:${rec.alias}`;
    const equipment = this.equipmentManager.getById(rec.equipmentId);
    const name = equipment?.name ?? rec.equipmentId;
    const zoneId = equipment?.zoneId ?? null;
    const what =
      rec.value === null || rec.value === undefined
        ? `order "${rec.alias}"`
        : `order "${rec.alias}" → ${String(rec.value)}`;

    if (FAILURES.has(status) && !this.raised.has(id)) {
      this.raised.add(id);
      const outcome =
        status === "refused"
          ? "refused by the device"
          : status === "not_received"
            ? "not received by the device"
            : "not confirmed by the device";
      this.eventBus.emit({
        type: "system.alarm.raised",
        alarmId: `${ALARM_SOURCE}:${id}`,
        level: "warning",
        source: ALARM_SOURCE,
        message: `${name}: ${what} ${outcome}`,
        zoneId,
      });
    } else if (status === "delivered" && this.raised.has(id)) {
      this.raised.delete(id);
      this.eventBus.emit({
        type: "system.alarm.resolved",
        alarmId: `${ALARM_SOURCE}:${id}`,
        source: ALARM_SOURCE,
        message: `${name}: ${what} confirmed by the device`,
        zoneId,
      });
    }
  }
}
