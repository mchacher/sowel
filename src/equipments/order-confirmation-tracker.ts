import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "./equipment-manager.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { IntegrationRegistry } from "../integrations/integration-registry.js";
import type { OrderSource } from "../shared/types.js";

// ============================================================
// Spec 141 — order delivery confirmation
//
// executeOrder succeeding means the order reached the integration, not the
// device. This tracker watches every confirmable order, expects the mirror
// data binding (same alias) to report the ordered value within a bounded
// delay, and otherwise raises a user-visible alarm (which the notification
// pipeline forwards as a push). When the target device comes back online,
// the last unconfirmed order is re-dispatched once within a bounded window.
// ============================================================

/**
 * Base delay after which a dispatched order without an observed effect is
 * unconfirmed. For devices behind polling integrations the effective timeout
 * is stretched to twice the poll interval: their mirror binding cannot move
 * before the next poll, and a fixed 30 s would false-alarm on every order to
 * a cloud device (Panasonic, MCZ, ...).
 */
const CONFIRMATION_TIMEOUT_MS = 30_000;
/** Maximum age of an unconfirmed order eligible for the reconnect re-dispatch. */
const REDISPATCH_TTL_MS = 3_600_000;
/** OrderSource channel identifying the tracker's own re-dispatches. */
export const RETRY_CHANNEL = "delivery-retry";

const ALARM_SOURCE = "order-confirmation";

interface PendingOrder {
  equipmentId: string;
  alias: string;
  value: unknown;
  orderedAt: number;
  timer: NodeJS.Timeout | null;
  /** Effective watchdog delay for this order (poll-interval aware). */
  timeoutMs: number;
  unconfirmed: boolean;
  alarmRaised: boolean;
  retried: boolean;
  deviceIds: string[];
  source?: OrderSource | undefined;
}

/** Normalize a value for comparison: boolean-like strings → boolean, numeric strings → number. */
function normalizeValue(v: unknown): unknown {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "on" || s === "true") return true;
    if (s === "off" || s === "false") return false;
    if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
    return s;
  }
  return v;
}

export function valuesMatch(ordered: unknown, actual: unknown): boolean {
  return Object.is(normalizeValue(ordered), normalizeValue(actual));
}

/**
 * A value is confirmable against a binding when comparing it to the binding's
 * vocabulary is meaningful: boolean-like, numeric, or a member of the
 * binding's enumValues. Cross-vocabulary enums (cover CLOSE vs CLOSED) are
 * exempt instead of producing false alarms.
 */
export function isConfirmableValue(ordered: unknown, enumValues?: string[]): boolean {
  const normalized = normalizeValue(ordered);
  if (typeof normalized === "boolean" || typeof normalized === "number") return true;
  if (typeof normalized === "string" && enumValues) {
    return enumValues.some((e) => e.toLowerCase() === normalized);
  }
  return false;
}

export class OrderConfirmationTracker {
  private readonly logger: Logger;
  private readonly pending: Map<string, PendingOrder> = new Map();
  private readonly unsubs: Array<() => void> = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly equipmentManager: EquipmentManager,
    private readonly deviceManager: DeviceManager,
    private readonly integrationRegistry: IntegrationRegistry,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "order-confirmation-tracker" });
  }

  init(): void {
    this.unsubs.push(
      this.eventBus.onType("equipment.order.executed", (event) => {
        try {
          this.handleOrderExecuted(event.equipmentId, event.orderAlias, event.value, event.source);
        } catch (err) {
          this.logger.error({ err }, "Order tracking failed");
        }
      }),
      this.eventBus.onType("equipment.data.changed", (event) => {
        try {
          this.handleDataChanged(event.equipmentId, event.alias, event.value);
        } catch (err) {
          this.logger.error({ err }, "Confirmation check failed");
        }
      }),
      this.eventBus.onType("device.status_changed", (event) => {
        try {
          if (event.status === "online") this.handleDeviceOnline(event.deviceId);
        } catch (err) {
          this.logger.error({ err }, "Reconnect re-dispatch failed");
        }
      }),
    );
    this.logger.info("Order confirmation tracker started");
  }

  destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  // ── Order dispatch ───────────────────────────────────────────

  private handleOrderExecuted(
    equipmentId: string,
    alias: string,
    value: unknown,
    source?: OrderSource,
  ): void {
    const key = `${equipmentId}:${alias}`;

    // Our own reconnect re-dispatch: re-arm the existing entry (keeping
    // retried=true so only one retry can ever happen), never create a new one.
    if (source?.kind === "external" && source.channel === RETRY_CHANNEL) {
      const entry = this.pending.get(key);
      if (entry) this.armTimer(entry);
      return;
    }

    // A newer order supersedes the pending one.
    const previous = this.pending.get(key);
    if (previous) {
      if (previous.timer) clearTimeout(previous.timer);
      if (previous.alarmRaised) {
        this.resolveAlarm(previous, "superseded by a new order");
      }
      this.pending.delete(key);
    }

    const bindings = this.equipmentManager.getDataBindingsWithValues(equipmentId);
    const mirror = bindings.find((b) => b.alias === alias);
    if (!mirror) return; // no observable effect — exempt (scenes, stateless orders)
    if (!isConfirmableValue(value, mirror.enumValues)) return; // cross-vocabulary enum — exempt

    const deviceIds = this.equipmentManager
      .getOrderBindingsWithDetails(equipmentId)
      .filter((b) => b.alias === alias)
      .map((b) => b.deviceId);

    const entry: PendingOrder = {
      equipmentId,
      alias,
      value,
      orderedAt: Date.now(),
      timer: null,
      timeoutMs: this.confirmationTimeoutFor(deviceIds),
      unconfirmed: false,
      alarmRaised: false,
      retried: false,
      deviceIds,
      source,
    };

    // Already in the ordered state (e.g. OFF ordered while already OFF):
    // nothing will change, confirm immediately.
    if (valuesMatch(value, mirror.value)) return;

    this.pending.set(key, entry);

    // Every target device offline: the command cannot have been delivered,
    // no point waiting for the timeout.
    const devices = deviceIds.map((id) => this.deviceManager.getById(id)).filter((d) => d !== null);
    if (devices.length > 0 && devices.every((d) => d.status === "offline")) {
      this.markUnconfirmed(entry, "device_offline");
      return;
    }

    this.armTimer(entry);
  }

  /**
   * The watchdog delay for an order targeting these devices. Polling
   * integrations cannot reflect the effect before their next poll, so the
   * timeout stretches to twice the largest poll interval involved.
   */
  private confirmationTimeoutFor(deviceIds: string[]): number {
    let timeout = CONFIRMATION_TIMEOUT_MS;
    for (const deviceId of deviceIds) {
      const device = this.deviceManager.getById(deviceId);
      if (!device) continue;
      const polling = this.integrationRegistry.getById(device.integrationId)?.getPollingInfo?.();
      if (polling && polling.intervalMs > 0) {
        timeout = Math.max(timeout, 2 * polling.intervalMs);
      }
    }
    return timeout;
  }

  private armTimer(entry: PendingOrder): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.markUnconfirmed(entry, "timeout");
    }, entry.timeoutMs);
  }

  private markUnconfirmed(entry: PendingOrder, reason: "timeout" | "device_offline"): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.unconfirmed = true;

    const name = this.equipmentManager.getById(entry.equipmentId)?.name ?? entry.equipmentId;
    this.logger.warn(
      {
        equipmentId: entry.equipmentId,
        equipmentName: name,
        alias: entry.alias,
        value: entry.value,
        reason,
      },
      "Order not confirmed by equipment state",
    );

    this.eventBus.emit({
      type: "equipment.order.unconfirmed",
      equipmentId: entry.equipmentId,
      orderAlias: entry.alias,
      value: entry.value,
      reason,
      ...(entry.source !== undefined ? { source: entry.source } : {}),
    });

    if (!entry.alarmRaised) {
      entry.alarmRaised = true;
      const detail =
        reason === "device_offline"
          ? "device offline"
          : `no state change within ${Math.round(entry.timeoutMs / 1000)}s`;
      this.eventBus.emit({
        type: "system.alarm.raised",
        alarmId: this.alarmId(entry),
        level: "warning",
        source: ALARM_SOURCE,
        message: `Order not confirmed: ${name} ${entry.alias} → ${String(entry.value)} (${detail})`,
      });
    }
  }

  // ── Confirmation ─────────────────────────────────────────────

  private handleDataChanged(equipmentId: string, alias: string, value: unknown): void {
    const entry = this.pending.get(`${equipmentId}:${alias}`);
    if (!entry) return;
    if (!valuesMatch(entry.value, value)) return;

    if (entry.timer) clearTimeout(entry.timer);
    if (entry.alarmRaised) {
      this.resolveAlarm(entry, "state finally confirmed");
      this.logger.info(
        { equipmentId, alias, value },
        "Unconfirmed order finally confirmed by equipment state",
      );
    }
    this.pending.delete(`${equipmentId}:${alias}`);
  }

  private resolveAlarm(entry: PendingOrder, why: string): void {
    const name = this.equipmentManager.getById(entry.equipmentId)?.name ?? entry.equipmentId;
    this.eventBus.emit({
      type: "system.alarm.resolved",
      alarmId: this.alarmId(entry),
      source: ALARM_SOURCE,
      message: `Order confirmation recovered: ${name} ${entry.alias} (${why})`,
    });
  }

  private alarmId(entry: PendingOrder): string {
    return `order-unconfirmed:${entry.equipmentId}:${entry.alias}`;
  }

  // ── Reconnect re-dispatch ────────────────────────────────────

  private handleDeviceOnline(deviceId: string): void {
    for (const entry of this.pending.values()) {
      if (!entry.unconfirmed || entry.retried) continue;
      if (!entry.deviceIds.includes(deviceId)) continue;
      if (Date.now() - entry.orderedAt > REDISPATCH_TTL_MS) continue;

      entry.retried = true;
      const name = this.equipmentManager.getById(entry.equipmentId)?.name ?? entry.equipmentId;
      this.logger.warn(
        {
          equipmentId: entry.equipmentId,
          equipmentName: name,
          alias: entry.alias,
          value: entry.value,
          deviceId,
        },
        "Device back online — re-dispatching last unconfirmed order",
      );
      void this.equipmentManager
        .executeOrder(entry.equipmentId, entry.alias, entry.value, {
          kind: "external",
          channel: RETRY_CHANNEL,
        })
        .catch((err: unknown) => {
          this.logger.error(
            { err, equipmentId: entry.equipmentId, alias: entry.alias },
            "Re-dispatch after reconnect failed",
          );
        });
    }
  }
}
