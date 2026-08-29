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
/**
 * Maximum age of a never-dispatched order eligible for the replay that follows
 * its integration reconnecting (issue #702). Much tighter than the device
 * reconnect TTL above: this one exists for the boot window and for a short
 * integration outage, and a schedule-driven command replayed long after its
 * slot has passed would be worse than the command that was lost.
 */
const DISCONNECTED_REDISPATCH_TTL_MS = 300_000;
/**
 * Grace given to a held order before it is surfaced as unconfirmed. The
 * integration is expected back within seconds (a boot, an MQTT reconnect), and
 * the replay then resolves the whole thing silently. Alarming on the failure
 * itself would push a failure and a recovery notification per held order on an
 * ordinary restart. Same reasoning as STATUS_SETTLE_MS above: a signal read
 * during the settling window is not yet evidence.
 */
const DISCONNECTED_ALARM_GRACE_MS = 60_000;
/**
 * Settle window after start during which a device's persisted "offline" is not
 * evidence on its own. Statuses survive a restart in SQLite and integrations
 * restore the real one asynchronously — Zigbee2MQTT replays its retained
 * availability topics a second or two after the MQTT connect — so an order
 * dispatched right after boot would otherwise alarm on the status the previous
 * shutdown left behind.
 */
const STATUS_SETTLE_MS = 60_000;
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
  /** Every target device was believed offline when the order was dispatched. */
  offlineAtDispatch: boolean;
  /**
   * How old this order may get and still be replayed. Two triggers can replay
   * it (a device coming online, its integration connecting) and they must agree
   * on the window, or the tighter one is bypassed by the other.
   */
  redispatchTtlMs: number;
  /**
   * The order never reached the wire: its integration was missing or
   * disconnected (issue #702). Such an order is replayed when that integration
   * connects, not when a device comes back online.
   */
  neverDispatched: boolean;
  /**
   * Whether equipment state can ever confirm this order. False for stateless
   * orders (scenes, a display wake) — they are still replayed when they were
   * never dispatched, but they raise no alarm, because nothing could resolve it.
   */
  confirmable: boolean;
  deviceIds: string[];
  /** Integrations behind the order bindings — the replay trigger for #702. */
  integrationIds: string[];
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
  /** Devices whose status we have observed since start — see offlineIsEvidence. */
  private readonly statusSeen: Set<string> = new Set();
  private startedAt = 0;

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
    this.startedAt = Date.now();
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
          this.statusSeen.add(event.deviceId);
          if (event.status === "online") this.handleDeviceOnline(event.deviceId);
        } catch (err) {
          this.logger.error({ err }, "Reconnect re-dispatch failed");
        }
      }),
      // Issue #702 — an order whose integration was unreachable never reached
      // the wire. It is held here and replayed once that integration connects.
      this.eventBus.onType("equipment.order.failed", (event) => {
        try {
          this.handleOrderFailed(
            event.equipmentId,
            event.orderAlias,
            event.value,
            event.error,
            event.source,
          );
        } catch (err) {
          this.logger.error({ err }, "Failed order tracking failed");
        }
      }),
      this.eventBus.onType("system.integration.connected", (event) => {
        try {
          this.handleIntegrationConnected(event.integrationId);
        } catch (err) {
          this.logger.error({ err }, "Integration reconnect re-dispatch failed");
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
    this.statusSeen.clear();
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

    // A newer order supersedes the pending one. Its alarm is carried over
    // rather than resolved and raised again: "recovered" has to mean the
    // equipment finally reported the ordered value, not that the engine tried
    // once more. Re-ordering every few minutes at an unreachable device would
    // otherwise push a recovery/failure pair per attempt.
    const previous = this.pending.get(key);
    if (previous) {
      if (previous.timer) clearTimeout(previous.timer);
      this.pending.delete(key);
    }

    const bindings = this.equipmentManager.getDataBindingsWithValues(equipmentId);
    const mirror = bindings.find((b) => b.alias === alias);
    // No observable effect (scenes, stateless orders) or a cross-vocabulary
    // enum (cover CLOSE vs state CLOSED) — exempt. A carried-over alarm has
    // nothing left to confirm it, so it is released here.
    if (!mirror || !isConfirmableValue(value, mirror.enumValues)) {
      if (previous?.alarmRaised) this.resolveAlarm(previous, "superseded by an exempt order");
      return;
    }

    const { deviceIds, integrationIds } = this.targetsFor(equipmentId, alias);

    const entry: PendingOrder = {
      equipmentId,
      alias,
      value,
      orderedAt: Date.now(),
      timer: null,
      timeoutMs: this.confirmationTimeoutFor(deviceIds),
      unconfirmed: false,
      alarmRaised: previous?.alarmRaised ?? false,
      retried: false,
      offlineAtDispatch: this.allTargetsOffline(deviceIds),
      redispatchTtlMs: REDISPATCH_TTL_MS,
      neverDispatched: false,
      confirmable: true,
      deviceIds,
      integrationIds,
      source,
    };

    // Already in the ordered state (e.g. OFF ordered while already OFF):
    // nothing will change, confirm immediately.
    if (valuesMatch(value, mirror.value)) {
      if (entry.alarmRaised) this.resolveAlarm(entry, "state finally confirmed");
      return;
    }

    this.pending.set(key, entry);

    // Every target device offline: the command cannot have been delivered, no
    // point waiting for the timeout — as long as that status is evidence and
    // not a leftover from the last shutdown.
    if (entry.offlineAtDispatch && this.offlineIsEvidence(deviceIds)) {
      this.markUnconfirmed(entry, "device_offline");
      return;
    }

    this.armTimer(entry);
  }

  /**
   * The devices behind an order alias, and the integrations that own them.
   * The integrations are what #702 keys its replay on: at boot a device
   * persisted as online never emits a status change, so the integration
   * connecting is the only signal that the wire is live again.
   */
  private targetsFor(
    equipmentId: string,
    alias: string,
  ): { deviceIds: string[]; integrationIds: string[] } {
    const deviceIds = this.equipmentManager
      .getOrderBindingsWithDetails(equipmentId)
      .filter((b) => b.alias === alias)
      .map((b) => b.deviceId);
    const integrationIds = [
      ...new Set(
        deviceIds
          .map((id) => this.deviceManager.getById(id)?.integrationId)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    return { deviceIds, integrationIds };
  }

  /** Whether every device behind the order bindings is currently offline. */
  private allTargetsOffline(deviceIds: string[]): boolean {
    const devices = deviceIds.map((id) => this.deviceManager.getById(id)).filter((d) => d !== null);
    return devices.length > 0 && devices.every((d) => d.status === "offline");
  }

  /**
   * Whether an "offline" status can be read as proof that the command could
   * not be delivered. A status we have seen move since start always can be;
   * one restored from the database cannot, until the settle window has passed
   * and every integration has had the time to report. Until then the watchdog
   * decides — the alarm is delayed by the timeout, not lost.
   */
  private offlineIsEvidence(deviceIds: string[]): boolean {
    if (Date.now() - this.startedAt >= STATUS_SETTLE_MS) return true;
    return deviceIds.every((id) => this.statusSeen.has(id));
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
      // Read the reason now rather than at dispatch: a device that went — or
      // stayed — offline meanwhile explains the silence better than a bare
      // timeout, and by now its status has had every chance to settle.
      const reason = this.allTargetsOffline(entry.deviceIds) ? "device_offline" : "timeout";
      this.markUnconfirmed(entry, reason);
    }, entry.timeoutMs);
  }

  private markUnconfirmed(
    entry: PendingOrder,
    reason: "timeout" | "device_offline" | "integration_disconnected",
  ): void {
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

    // A stateless order (a scene, a display wake) has nothing that could ever
    // report the ordered value, so an alarm on it could never resolve. It is
    // still tracked and replayed — it just stays out of the alarm surface.
    if (!entry.alarmRaised && entry.confirmable) {
      entry.alarmRaised = true;
      const detail =
        reason === "device_offline"
          ? "device offline"
          : reason === "integration_disconnected"
            ? "integration unreachable"
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

  // ── Undispatched orders (issue #702) ─────────────────────────

  /**
   * An order that failed before reaching the wire because its integration was
   * missing or disconnected. Until #702 this threw out of `executeOrder`
   * without emitting anything, so the command was dropped with only a log line
   * behind it: the recipe's own state advanced as if it had acted, and nothing
   * brought the device back in line until the next trigger.
   *
   * The order is held here and replayed once when that integration connects.
   * Only the undispatched class is held: a failure raised by a plugin that was
   * connected is a different problem with no reconnect signal to hang a replay
   * on, and is left alone.
   */
  private handleOrderFailed(
    equipmentId: string,
    alias: string,
    value: unknown,
    error: string,
    source?: OrderSource,
  ): void {
    // Our own replay failing again must not enrol the order a second time.
    // The existing entry already carries retried=true, so the single-replay
    // guarantee holds.
    if (source?.kind === "external" && source.channel === RETRY_CHANNEL) return;

    const { deviceIds, integrationIds } = this.targetsFor(equipmentId, alias);
    const unreachable = integrationIds.filter(
      (id) => this.integrationRegistry.getById(id)?.getStatus() !== "connected",
    );
    if (unreachable.length === 0) return;

    const key = `${equipmentId}:${alias}`;
    const previous = this.pending.get(key);
    if (previous) {
      if (previous.timer) clearTimeout(previous.timer);
      this.pending.delete(key);
    }

    const bindings = this.equipmentManager.getDataBindingsWithValues(equipmentId);
    const mirror = bindings.find((b) => b.alias === alias);
    const confirmable = mirror !== undefined && isConfirmableValue(value, mirror.enumValues);

    // Already in the ordered state: the command being lost changes nothing.
    if (confirmable && mirror && valuesMatch(value, mirror.value)) {
      if (previous?.alarmRaised) this.resolveAlarm(previous, "state finally confirmed");
      return;
    }

    // A carried-over alarm needs something that can still resolve it. A
    // stateless order cannot, so it is released here rather than left standing
    // until the next restart — same rule the executed path applies to an
    // exempt order superseding an alarmed one.
    if (!confirmable && previous?.alarmRaised) {
      this.resolveAlarm(previous, "superseded by an exempt order");
    }

    const entry: PendingOrder = {
      equipmentId,
      alias,
      value,
      orderedAt: Date.now(),
      timer: null,
      timeoutMs: this.confirmationTimeoutFor(deviceIds),
      unconfirmed: false,
      alarmRaised: confirmable ? (previous?.alarmRaised ?? false) : false,
      retried: false,
      offlineAtDispatch: false,
      redispatchTtlMs: DISCONNECTED_REDISPATCH_TTL_MS,
      neverDispatched: true,
      confirmable,
      deviceIds,
      integrationIds,
      source,
    };
    this.pending.set(key, entry);

    this.logger.warn(
      { equipmentId, alias, value, error, integrationIds: unreachable },
      "Order could not be dispatched — holding it until the integration connects",
    );

    // Make sure the next status sweep sees a transition even if the plugin
    // recovers between two samples: without this, a brief flap emits no
    // connected event and the order would be held with nothing to release it.
    for (const id of unreachable) this.integrationRegistry.noteUnreachable(id);

    // No watchdog on the ordered value: nothing was sent, so there is no effect
    // to wait for. What is timed instead is how long the order stays held —
    // the alarm is for an integration that does not come back.
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.markUnconfirmed(entry, "integration_disconnected");
    }, DISCONNECTED_ALARM_GRACE_MS);
  }

  /**
   * An integration is reachable again: replay every order that was lost
   * because it was not. At boot this is the only usable signal — a device
   * persisted as online never emits a status change when its integration
   * finally connects, so `handleDeviceOnline` would never fire.
   */
  private handleIntegrationConnected(integrationId: string): void {
    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.retried || !entry.neverDispatched) continue;
      if (!entry.integrationIds.includes(integrationId)) continue;
      // Too old to be replayed safely. The entry is kept rather than dropped:
      // if it raised an alarm, a later state report still has to resolve it.
      if (Date.now() - entry.orderedAt > entry.redispatchTtlMs) continue;

      entry.retried = true;
      const name = this.equipmentManager.getById(entry.equipmentId)?.name ?? entry.equipmentId;
      this.logger.warn(
        {
          equipmentId: entry.equipmentId,
          equipmentName: name,
          alias: entry.alias,
          value: entry.value,
          integrationId,
        },
        "Integration connected — re-dispatching the order it could not deliver",
      );
      void this.equipmentManager
        .executeOrder(entry.equipmentId, entry.alias, entry.value, {
          kind: "external",
          channel: RETRY_CHANNEL,
        })
        .catch((err: unknown) => {
          this.logger.error(
            { err, equipmentId: entry.equipmentId, alias: entry.alias },
            "Re-dispatch after integration connect failed",
          );
        });
      // Nothing can ever confirm a stateless order, so it is released as soon
      // as it has been replayed rather than lingering forever.
      if (!entry.confirmable) {
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(key);
      }
    }
  }

  // ── Reconnect re-dispatch ────────────────────────────────────

  private handleDeviceOnline(deviceId: string): void {
    for (const entry of this.pending.values()) {
      if (entry.retried) continue;
      // Unconfirmed, still inside its watchdog after being dispatched at a
      // device believed offline, or never dispatched at all: either way the
      // command may never have landed, and this reconnect is the moment to
      // re-assert it. A held order is eligible here as well as on its
      // integration connecting, because that event can be missed when a plugin
      // drops and recovers between two status sweeps.
      if (!entry.unconfirmed && !entry.offlineAtDispatch && !entry.neverDispatched) continue;
      if (!entry.deviceIds.includes(deviceId)) continue;
      if (Date.now() - entry.orderedAt > entry.redispatchTtlMs) continue;

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
