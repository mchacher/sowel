import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "./equipment-manager.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { IntegrationRegistry } from "../integrations/integration-registry.js";
import type {
  DataBindingWithValue,
  DataType,
  Equipment,
  OrderOutcomeExpected,
  OrderOutcomeStatus,
  OrderSource,
} from "../shared/types.js";
import { ORDER_OUTCOME_ALARM_SOURCE, wordOrderOutcomeAlarm } from "./order-outcome-messages.js";

// ============================================================
// Spec 141 — order delivery confirmation
//
// executeOrder succeeding means the order reached the integration, not the
// device. This tracker watches every confirmable order, expects the mirror
// data binding (same alias) to report the ordered value within a bounded
// delay, and otherwise raises a user-visible alarm (which the notification
// pipeline forwards as a push). When the target device comes back online,
// the last unconfirmed order is re-dispatched once within a bounded window.
//
// Spec 188 adds two tracking kinds for orders that have no mirror value:
//   - `transition`: a gate impulse, proven by the gate state flipping;
//   - `end_state`: a cover OPEN / CLOSE, proven by the end state it reaches,
//     only once the device has shown it speaks that vocabulary (O4).
// Both emit `equipment.order.outcome` on every status change and are never
// re-dispatched (O9): a second impulse reverses a gate.
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
/**
 * Spec 188 O2 — window for a gate impulse from closed: the gate's contact
 * reports it open within 1–2 s; 15 s covers the radio retries and a
 * heartbeat-only report.
 */
export const GATE_OPEN_WINDOW_MS = 15_000;
/**
 * Spec 188 O2 — window for a gate impulse from open: the pulse may close, stop
 * or reverse it; the travel is about 34 s and nothing is observable before
 * `closed`, so 60 s covers a reversal followed by a full close.
 */
export const GATE_CLOSE_WINDOW_MS = 60_000;
/** Spec 188 O3 — window for a cover OPEN / CLOSE (the coop motor cuts at 50 s). */
export const END_STATE_WINDOW_MS = 60_000;
/**
 * Spec 188 O4 — words a cover state can carry that are never commands. A mirror
 * that reported one of them speaks the end-state vocabulary, so CLOSE can be
 * confirmed by CLOSED without false-alarming the covers that echo OPEN / CLOSE.
 */
const END_STATE_VOCABULARY = new Set(["CLOSED", "OPENING", "CLOSING", "FAULT"]);
/**
 * Spec 188 — how long after its window a tracked order may still be shown as
 * confirmed (the tile line, the guest's journal row). A gate report lost on
 * the radio comes back with the next 60 s heartbeat; a flip hours later is
 * someone else's doing and must not read as this order's outcome. The alarm
 * itself is resolved by the expected state whenever it comes (O6).
 */
export const LATE_OUTCOME_GRACE_MS = 300_000;
/** The device key a fault reason is read from (spec 188 O3). */
const FAULT_REASON_KEY = "why";
/** Fault reasons the UI words itself (spec 188 O6); others are shown raw. */
const KNOWN_FAULT_REASONS = new Set(["BOTTOM", "WIRING"]);
/** A `why` that says there is no reason: read as no detail at all. */
const NO_FAULT_REASON = "NONE";
/**
 * Spec 188 O6 — how long a FAULT's alarm waits for the device's reason. The
 * reason is another key of the same report and may land a moment after the
 * FAULT itself; raising at once would push the alarm twice, bare then worded.
 */
const FAULT_REASON_SETTLE_MS = 1_000;

/** Spec 188 O3 — a device's `why` as a fault detail; undefined when it gives none. */
function faultReasonOf(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const reason = String(v).trim().toUpperCase();
  return reason === "" || reason === NO_FAULT_REASON ? undefined : reason;
}

/** OrderSource channel identifying the tracker's own re-dispatches. */
export const RETRY_CHANNEL = "delivery-retry";

const ALARM_SOURCE = ORDER_OUTCOME_ALARM_SOURCE;

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
  /**
   * Set when the confirmation is read from the ordered device's own data
   * rather than from an equipment binding, because no binding on this
   * equipment could mirror the order (issue #901).
   */
  deviceMirror?: { deviceId: string; key: string };
  source?: OrderSource | undefined;
  /**
   * Spec 188 — how this order is proven. `mirror` is spec 141's rule (the
   * ordered value appears on the mirror); the two others are O1's kinds.
   */
  kind: "mirror" | "transition" | "end_state";
  /** Spec 188 — the movement a `transition` / `end_state` order should cause. */
  expected?: OrderOutcomeExpected;
  /** Spec 188 — the equipment alias whose flip proves a `transition`. */
  gateAlias?: "closed" | "state";
  /** Spec 188 — the equipment alias of an `end_state` mirror binding. */
  stateAlias?: string;
  /** Spec 188 — the last outcome emitted, so only a change is emitted. */
  lastStatus?: OrderOutcomeStatus;
  /** Spec 188 — the device's fault reason, once it reported FAULT. */
  detail?: string;
  /**
   * Spec 188 O6 — what the raised alarm says (key and parameters), so that a
   * tracked order re-words an alarm it inherited or whose reason came late.
   */
  alarmWording?: string;
}

/** Spec 188 O1 — the tracking an order gets, when it is one of the new kinds. */
type TrackedKind =
  | {
      kind: "transition";
      expected: OrderOutcomeExpected;
      gateAlias: "closed" | "state";
      timeoutMs: number;
    }
  | {
      kind: "end_state";
      expected: OrderOutcomeExpected;
      mirror?: DataBindingWithValue;
      deviceMirror?: { deviceId: string; key: string };
      /** The mirror (or the position) already reports the target. */
      atTarget: boolean;
    };

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

/**
 * Whether a mirror could ever report the ordered value. An alias is not a
 * vocabulary: on a submetered thermostat `power` is a boolean order to the
 * cloud device and a wattage read from a clamp, so comparing them can only
 * ever be false and the watchdog would alarm on every order (issue #901).
 * Narrow on purpose: boolean against number, both ways, and nothing else.
 * A boolean ordered against an ON/OFF enum is a real mirror, and stays one.
 */
/** Spec 188 — a cover state word, upper-cased; null for anything else. */
function stateWord(v: unknown): string | null {
  return typeof v === "string" ? v.trim().toUpperCase() : null;
}

/** Spec 188 — a gate contact as a boolean "closed", null when it says nothing. */
function closedFlag(v: unknown): boolean | null {
  const n = normalizeValue(v);
  if (typeof n === "boolean") return n;
  if (n === 1 || n === 0) return n === 1;
  return null;
}

export function mirrorCanReport(ordered: unknown, mirrorType: DataType | undefined): boolean {
  if (mirrorType === undefined) return true;
  const normalized = normalizeValue(ordered);
  if (typeof normalized === "boolean") return mirrorType !== "number";
  if (typeof normalized === "number") return mirrorType !== "boolean";
  return true;
}

export class OrderConfirmationTracker {
  private readonly logger: Logger;
  private readonly pending: Map<string, PendingOrder> = new Map();
  private readonly unsubs: Array<() => void> = [];
  /** Devices whose status we have observed since start — see offlineIsEvidence. */
  private readonly statusSeen: Set<string> = new Set();
  /**
   * Spec 188 O4 — `deviceId:key` mirrors that have reported an end-state word
   * (CLOSED, OPENING, CLOSING, FAULT) since start.
   */
  private readonly endStateSpoken: Set<string> = new Set();
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
      // A device-level mirror is not bound to the equipment, so no
      // equipment.data.changed will ever carry it (issue #901).
      this.eventBus.onType("device.data.updated", (event) => {
        try {
          this.handleDeviceDataUpdated(event.deviceId, event.key, event.value);
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
    this.endStateSpoken.clear();
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
    const retirePrevious = (): void => {
      if (!previous) return;
      // A FAULT still inside its reason settle window raises its alarm now,
      // so that the order replacing it inherits it rather than lose it.
      const faultSettling =
        previous.lastStatus === "fault" && !previous.alarmRaised && previous.timer !== null;
      if (previous.timer) clearTimeout(previous.timer);
      previous.timer = null;
      if (faultSettling) this.raiseAlarm(previous, "device_fault");
      this.pending.delete(key);
    };

    const { deviceIds, integrationIds, targets } = this.targetsFor(equipmentId, alias);
    const bindings = this.equipmentManager.getDataBindingsWithValues(equipmentId);

    // Spec 188 O1 — a gate impulse or a cover OPEN / CLOSE is chosen before
    // the confirmability test, which would exempt both.
    const tracked = this.classify(
      this.equipmentManager.getById(equipmentId),
      alias,
      value,
      bindings,
      deviceIds,
      targets,
    );
    if (tracked) {
      retirePrevious();
      this.trackOutcome(tracked, {
        equipmentId,
        alias,
        value,
        previous,
        deviceIds,
        integrationIds,
        source,
      });
      return;
    }

    const { mirror, deviceMirror } = this.resolveMirror(bindings, alias, value, deviceIds, targets);
    // No observable effect (scenes, stateless orders), a cross-vocabulary enum
    // (cover CLOSE vs state CLOSED), or nothing that could ever report this
    // value — exempt. A carried-over alarm has nothing left to confirm it, so
    // it is released here.
    if ((!mirror && !deviceMirror) || !isConfirmableValue(value, mirror?.enumValues)) {
      if (previous && previous.kind !== "mirror") {
        this.supersedeTrackedByExempt(previous);
        return;
      }
      retirePrevious();
      if (previous?.alarmRaised) this.resolveAlarm(previous, "superseded by an exempt order");
      return;
    }
    retirePrevious();

    const entry: PendingOrder = {
      equipmentId,
      alias,
      value,
      orderedAt: Date.now(),
      timer: null,
      timeoutMs: this.confirmationTimeoutFor(deviceIds),
      unconfirmed: false,
      alarmRaised: previous?.alarmRaised ?? false,
      ...(previous?.alarmWording !== undefined ? { alarmWording: previous.alarmWording } : {}),
      retried: false,
      offlineAtDispatch: this.allTargetsOffline(deviceIds),
      redispatchTtlMs: REDISPATCH_TTL_MS,
      neverDispatched: false,
      confirmable: true,
      deviceIds,
      integrationIds,
      ...(deviceMirror !== undefined ? { deviceMirror } : {}),
      source,
      kind: "mirror",
    };

    // Already in the ordered state (e.g. OFF ordered while already OFF):
    // nothing will change, confirm immediately.
    const current = mirror ? mirror.value : this.readDeviceValue(deviceMirror);
    if (valuesMatch(value, current)) {
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

  // ── Spec 188 — outcome from reported state ───────────────────

  /**
   * O7 — an exempt order (a pulse while the gate state reads "unknown", a
   * STOP) on an equipment whose tracked order is still open. The exempt order
   * can prove nothing, so it must not erase what the tracked one can still
   * prove: a gate keeps its window, its timer and its alarm, and its outcome
   * still comes. The engine marks a gate's `state` "unknown" from a pulse until
   * the next report, so a second press inside the window is exactly this case.
   *
   * A cover order interrupted this way (a STOP while the door travels) can no
   * longer reach its end state because of the person who stopped it: its line
   * ends as unconfirmed at once, without an alarm. One that already has an
   * alarm, or a final status, is kept as it is, waiting for the expected state.
   */
  private supersedeTrackedByExempt(previous: PendingOrder): void {
    if (
      previous.kind !== "end_state" ||
      previous.alarmRaised ||
      (previous.lastStatus !== "pending" && previous.lastStatus !== "moving")
    ) {
      return;
    }
    if (previous.timer) clearTimeout(previous.timer);
    previous.timer = null;
    this.pending.delete(`${previous.equipmentId}:${previous.alias}`);
    this.emitOutcome(previous, "unconfirmed");
  }

  /** O9 — a gate impulse, whatever the gate state: never replayed. */
  private isGatePulse(equipment: Equipment | null | undefined, value: unknown): boolean {
    return equipment?.type === "gate" && stateWord(value) === "PULSE";
  }

  /**
   * O1 — whether this order is a gate impulse or a cover OPEN / CLOSE the
   * reported state can prove. Null means spec 141's path, unchanged.
   */
  private classify(
    equipment: Equipment | null | undefined,
    alias: string,
    value: unknown,
    bindings: DataBindingWithValue[],
    deviceIds: string[],
    targets: { deviceId: string; key: string }[],
  ): TrackedKind | null {
    if (!equipment) return null;
    const word = stateWord(value);
    if (equipment.type === "gate" && word === "PULSE") {
      const gate = this.readGateState(bindings);
      if (!gate) return null; // O2 — state unknown: exempt, today's behaviour
      return gate.closed
        ? {
            kind: "transition",
            expected: "open",
            gateAlias: gate.alias,
            timeoutMs: GATE_OPEN_WINDOW_MS,
          }
        : {
            kind: "transition",
            expected: "close",
            gateAlias: gate.alias,
            timeoutMs: GATE_CLOSE_WINDOW_MS,
          };
    }
    // A shutter inverted in Sowel (spec 154) sends the opposite of what it
    // reports, so its end state cannot prove the order: left to spec 141.
    if (
      equipment.type === "shutter" &&
      !equipment.invertDirection &&
      (word === "OPEN" || word === "CLOSE")
    ) {
      const { mirror, deviceMirror } = this.resolveMirror(
        bindings,
        alias,
        value,
        deviceIds,
        targets,
      );
      const at = mirror
        ? { deviceId: mirror.deviceId, key: mirror.key, current: mirror.value }
        : deviceMirror
          ? { ...deviceMirror, current: this.readDeviceValue(deviceMirror) }
          : null;
      if (!at) return null;
      // O4 — only a mirror that has spoken the end-state vocabulary.
      const current = stateWord(at.current);
      const spoken =
        (current !== null && END_STATE_VOCABULARY.has(current)) ||
        (at.deviceId !== "" && this.endStateSpoken.has(`${at.deviceId}:${at.key}`));
      if (!spoken) return null;
      const expected: OrderOutcomeExpected = word === "OPEN" ? "open" : "close";
      const position = bindings.find((b) => b.alias === "position")?.value;
      const atTarget =
        current === (expected === "open" ? "OPEN" : "CLOSED") ||
        this.positionAtTarget(expected, position);
      return {
        kind: "end_state",
        expected,
        ...(mirror ? { mirror } : {}),
        ...(deviceMirror && !mirror ? { deviceMirror } : {}),
        atTarget,
      };
    }
    return null;
  }

  /**
   * O2 — the gate state at dispatch: its `closed` binding, else its `state`
   * binding. Null when unknown: no value, or every device behind it offline.
   */
  private readGateState(
    bindings: DataBindingWithValue[],
  ): { closed: boolean; alias: "closed" | "state" } | null {
    const closedBinding = bindings.find((b) => b.alias === "closed");
    if (closedBinding) {
      const closed = closedFlag(closedBinding.value);
      if (closed === null || this.allTargetsOffline([closedBinding.deviceId])) return null;
      return { closed, alias: "closed" };
    }
    const stateBinding = bindings.find((b) => b.alias === "state");
    if (!stateBinding) return null;
    const state = stateWord(stateBinding.value);
    if (state !== "OPEN" && state !== "CLOSED") return null;
    // The `state` of a gate is derived from its contact bindings: it is
    // unknown when every device behind them is offline.
    const behind = [
      ...new Set(
        [stateBinding, ...bindings.filter((b) => b !== stateBinding)]
          .map((b) => b.deviceId)
          .filter((id) => id !== ""),
      ),
    ];
    if (behind.length > 0 && this.allTargetsOffline(behind)) return null;
    return { closed: state === "CLOSED", alias: "state" };
  }

  private positionAtTarget(expected: OrderOutcomeExpected, position: unknown): boolean {
    const n = normalizeValue(position);
    if (typeof n !== "number") return false;
    return expected === "open" ? n === 100 : n === 0;
  }

  /** Create the pending entry of a `transition` / `end_state` order. */
  private trackOutcome(
    tracked: TrackedKind,
    ctx: {
      equipmentId: string;
      alias: string;
      value: unknown;
      previous: PendingOrder | undefined;
      deviceIds: string[];
      integrationIds: string[];
      source: OrderSource | undefined;
    },
  ): void {
    const { equipmentId, alias, value, previous, deviceIds, integrationIds, source } = ctx;
    const entry: PendingOrder = {
      equipmentId,
      alias,
      value,
      orderedAt: Date.now(),
      timer: null,
      timeoutMs:
        tracked.kind === "transition"
          ? tracked.timeoutMs
          : Math.max(END_STATE_WINDOW_MS, this.confirmationTimeoutFor(deviceIds)),
      unconfirmed: false,
      alarmRaised: previous?.alarmRaised ?? false,
      ...(previous?.alarmWording !== undefined ? { alarmWording: previous.alarmWording } : {}),
      // O9 — never re-dispatched, neither on a device reconnect nor on an
      // integration connect: a second impulse reverses a gate.
      retried: true,
      offlineAtDispatch: this.allTargetsOffline(deviceIds),
      redispatchTtlMs: REDISPATCH_TTL_MS,
      neverDispatched: false,
      confirmable: true,
      deviceIds,
      integrationIds,
      source,
      kind: tracked.kind,
      expected: tracked.expected,
      ...(tracked.kind === "transition" ? { gateAlias: tracked.gateAlias } : {}),
      ...(tracked.kind === "end_state" && tracked.mirror
        ? { stateAlias: tracked.mirror.alias }
        : {}),
      ...(tracked.kind === "end_state" && tracked.deviceMirror
        ? { deviceMirror: tracked.deviceMirror }
        : {}),
    };

    // O3 — already at the target: confirmed at once, as in spec 141.
    if (tracked.kind === "end_state" && tracked.atTarget) {
      this.emitOutcome(entry, "confirmed");
      if (entry.alarmRaised) this.resolveAlarm(entry, "state finally confirmed");
      return;
    }

    this.pending.set(`${equipmentId}:${alias}`, entry);
    this.emitOutcome(entry, "pending");

    if (entry.offlineAtDispatch && this.offlineIsEvidence(deviceIds)) {
      this.markUnconfirmed(entry, "device_offline");
      return;
    }
    this.armTimer(entry);
  }

  /**
   * A reported value on a tracked order's equipment or mirror device. `via`
   * says where it came from: an equipment alias, or the device mirror.
   */
  private observeTracked(
    entry: PendingOrder,
    via: { alias: string } | { deviceMirror: true },
    value: unknown,
  ): void {
    if (entry.neverDispatched) return;
    if (entry.kind === "transition") {
      if (!("alias" in via) || via.alias !== entry.gateAlias) return;
      const reached =
        entry.gateAlias === "closed"
          ? closedFlag(value) === (entry.expected === "close")
          : stateWord(value) === (entry.expected === "open" ? "OPEN" : "CLOSED");
      // O2 — only the first flip counts; the value at dispatch (a heartbeat)
      // and "unknown" leave the window running.
      if (reached) this.confirmTracked(entry, value);
      return;
    }
    if (entry.kind !== "end_state") return;
    if ("alias" in via && via.alias === "position") {
      // O4 — position confirms only once the vocabulary enabled the mapping,
      // which it did for this entry to exist.
      if (this.positionAtTarget(entry.expected ?? "open", value)) this.confirmTracked(entry, value);
      return;
    }
    const isMirror =
      "deviceMirror" in via
        ? entry.deviceMirror !== undefined
        : entry.stateAlias !== undefined && via.alias === entry.stateAlias;
    if (!isMirror) return;
    const word = stateWord(value);
    const open = entry.expected === "open";
    if (word === (open ? "OPEN" : "CLOSED")) {
      this.confirmTracked(entry, value);
      return;
    }
    // After the window or a fault, only the target still matters (O6).
    if (entry.unconfirmed) return;
    if (word === (open ? "OPENING" : "CLOSING")) {
      this.emitOutcome(entry, "moving");
    } else if (word === "FAULT") {
      const detail = this.readFaultReason(entry);
      if (detail !== undefined) entry.detail = detail;
      this.markUnconfirmed(entry, "device_fault");
    }
  }

  /** O3 — the device's own reason for a FAULT, read from its `why` key. */
  private readFaultReason(entry: PendingOrder): string | undefined {
    const deviceId = entry.deviceMirror?.deviceId ?? this.endStateDeviceOf(entry);
    if (!deviceId) return undefined;
    return faultReasonOf(this.readDeviceValue({ deviceId, key: FAULT_REASON_KEY }));
  }

  /** The device behind an `end_state` mirror binding. */
  private endStateDeviceOf(entry: PendingOrder): string | undefined {
    if (!entry.stateAlias) return undefined;
    return this.equipmentManager
      .getDataBindingsWithValues(entry.equipmentId)
      .find((b) => b.alias === entry.stateAlias && b.deviceId !== "")?.deviceId;
  }

  private confirmTracked(entry: PendingOrder, value: unknown): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (Date.now() - entry.orderedAt <= entry.timeoutMs + LATE_OUTCOME_GRACE_MS) {
      this.emitOutcome(entry, "confirmed");
    }
    if (entry.alarmRaised) {
      this.resolveAlarm(entry, "state finally confirmed");
      this.logger.info(
        { equipmentId: entry.equipmentId, alias: entry.alias, value },
        "Unconfirmed order finally confirmed by equipment state",
      );
    }
    this.pending.delete(`${entry.equipmentId}:${entry.alias}`);
  }

  /** O5 — emit a tracked order's outcome, on a change only. */
  private emitOutcome(entry: PendingOrder, status: OrderOutcomeStatus, force = false): void {
    if (entry.kind === "mirror") return;
    if (!force && entry.lastStatus === status) return;
    entry.lastStatus = status;
    this.eventBus.emit({
      type: "equipment.order.outcome",
      equipmentId: entry.equipmentId,
      orderAlias: entry.alias,
      value: entry.value,
      status,
      ...(entry.expected !== undefined ? { expected: entry.expected } : {}),
      ...(status === "fault" && entry.detail !== undefined ? { detail: entry.detail } : {}),
      ...(entry.source !== undefined ? { source: entry.source } : {}),
    });
  }

  /** O6 — the i18n key and parameters the UI words a tracked order's alarm from. */
  private outcomeAlarmWording(
    entry: PendingOrder,
    name: string,
    reason: "timeout" | "device_offline" | "integration_disconnected" | "device_fault",
  ): { messageKey: string; messageParams: Record<string, string> } | null {
    if (entry.kind === "mirror") return null;
    if (reason === "device_fault") {
      if (entry.detail === undefined) {
        return { messageKey: "alarms.orderOutcome.fault", messageParams: { equipment: name } };
      }
      if (KNOWN_FAULT_REASONS.has(entry.detail)) {
        const suffix = entry.detail.charAt(0) + entry.detail.slice(1).toLowerCase();
        return {
          messageKey: `alarms.orderOutcome.fault${suffix}`,
          messageParams: { equipment: name },
        };
      }
      return {
        messageKey: "alarms.orderOutcome.faultDetail",
        messageParams: { equipment: name, detail: entry.detail },
      };
    }
    if (entry.kind === "transition") {
      return {
        messageKey:
          entry.expected === "close"
            ? "alarms.orderOutcome.unconfirmedStillOpen"
            : "alarms.orderOutcome.unconfirmedNoMovement",
        messageParams: { equipment: name },
      };
    }
    return { messageKey: "alarms.orderOutcome.unconfirmed", messageParams: { equipment: name } };
  }

  /**
   * Where the effect of this order will be observed.
   *
   * The mirror used to be "any data binding carrying the order's alias", which
   * assumes an alias means one thing per equipment. It does not: on a
   * submetered thermostat `power` is both the boolean sent to the cloud device
   * and the wattage read from a clamp, and the tracker then compared `true` to
   * `646` on every order and alarmed 15 times out of 15 (issue #901).
   *
   * Order of preference:
   *   1. a binding on the very device the order was sent to;
   *   2. the established cross-device binding, when it could report the value;
   *   3. the ordered device's own data under the order key, which is where a
   *      cloud thermostat publishes the state nobody bound;
   *   4. nothing, and the order is tracked without an alarm.
   */
  private resolveMirror(
    bindings: DataBindingWithValue[],
    alias: string,
    value: unknown,
    deviceIds: string[],
    targets: { deviceId: string; key: string }[],
  ): { mirror?: DataBindingWithValue; deviceMirror?: { deviceId: string; key: string } } {
    const candidates = bindings.filter((b) => b.alias === alias);

    const onTarget = candidates.find((b) => deviceIds.includes(b.deviceId));
    if (onTarget) return { mirror: onTarget };

    const crossDevice = candidates.find((b) => mirrorCanReport(value, b.type));
    if (crossDevice) return { mirror: crossDevice };

    for (const target of targets) {
      const device = this.deviceManager.getById(target.deviceId);
      if (!device) continue;
      const current = this.deviceManager.getDeviceDataValue(
        device.integrationId,
        device.sourceDeviceId,
        target.key,
      );
      // A key the device has never reported tells us nothing about whether it
      // could: better no watchdog than one that can only expire.
      if (current === null) continue;
      if (!mirrorCanReport(value, typeof current === "number" ? "number" : "boolean")) continue;
      return { deviceMirror: { deviceId: target.deviceId, key: target.key } };
    }

    return {};
  }

  /** Current value of a device-level mirror, for the already-in-state check. */
  private readDeviceValue(mirror: { deviceId: string; key: string } | undefined): unknown {
    if (!mirror) return undefined;
    const device = this.deviceManager.getById(mirror.deviceId);
    if (!device) return undefined;
    return this.deviceManager.getDeviceDataValue(
      device.integrationId,
      device.sourceDeviceId,
      mirror.key,
    );
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
  ): {
    deviceIds: string[];
    integrationIds: string[];
    targets: { deviceId: string; key: string }[];
  } {
    const targets = this.equipmentManager
      .getOrderBindingsWithDetails(equipmentId)
      .filter((b) => b.alias === alias)
      .map((b) => ({ deviceId: b.deviceId, key: b.key }));
    const deviceIds = targets.map((t) => t.deviceId);
    const integrationIds = [
      ...new Set(
        deviceIds
          .map((id) => this.deviceManager.getById(id)?.integrationId)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    return { deviceIds, integrationIds, targets };
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
    reason: "timeout" | "device_offline" | "integration_disconnected" | "device_fault",
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
    // Spec 188 O5 — a tracked order's line reads fault or unconfirmed.
    this.emitOutcome(entry, reason === "device_fault" ? "fault" : "unconfirmed");

    // Spec 188 O6 — a FAULT's alarm waits a moment for the device's reason,
    // so that it is pushed once, worded with it.
    if (reason === "device_fault") {
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (this.pending.get(`${entry.equipmentId}:${entry.alias}`) !== entry) return;
        this.raiseAlarm(entry, reason);
      }, FAULT_REASON_SETTLE_MS);
      return;
    }
    this.raiseAlarm(entry, reason);
  }

  /**
   * Raise the order's alarm. A stateless order (a scene, a display wake) has
   * nothing that could ever report the ordered value, so an alarm on it could
   * never resolve: it stays out of the alarm surface.
   *
   * An alarm already standing is carried over as it is (spec 141), except that
   * a tracked order re-raises it, same id, when its wording changed (spec 188
   * O6): an alarm inherited from an earlier order, or a FAULT whose reason came
   * late, must say what this order met.
   */
  private raiseAlarm(
    entry: PendingOrder,
    reason: "timeout" | "device_offline" | "integration_disconnected" | "device_fault",
  ): void {
    if (!entry.confirmable) return;
    const name = this.equipmentManager.getById(entry.equipmentId)?.name ?? entry.equipmentId;
    const wording = this.outcomeAlarmWording(entry, name, reason);
    const signature = wording
      ? `${wording.messageKey}(${JSON.stringify(wording.messageParams)})`
      : undefined;
    if (entry.alarmRaised && (signature === undefined || signature === entry.alarmWording)) return;

    const detail =
      reason === "device_offline"
        ? "device offline"
        : reason === "integration_disconnected"
          ? "integration unreachable"
          : reason === "device_fault"
            ? `device reported FAULT${entry.detail !== undefined ? ` (${entry.detail})` : ""}`
            : `no state change within ${Math.round(entry.timeoutMs / 1000)}s`;
    // `message` stays English (logs, Telegram); a tracked order's says what the
    // UI and the push say, in English.
    const message =
      (wording && wordOrderOutcomeAlarm(wording.messageKey, wording.messageParams, "en")) ??
      `Order not confirmed: ${name} ${entry.alias} → ${String(entry.value)} (${detail})`;
    entry.alarmRaised = true;
    if (signature !== undefined) entry.alarmWording = signature;
    this.eventBus.emit({
      type: "system.alarm.raised",
      alarmId: this.alarmId(entry),
      level: "warning",
      source: ALARM_SOURCE,
      message,
      ...(wording ?? {}),
    });
  }

  // ── Confirmation ─────────────────────────────────────────────

  private handleDataChanged(equipmentId: string, alias: string, value: unknown): void {
    // Spec 188 — a tracked order is proven by another alias than its own
    // (`closed`, `state`, `position`), so every one on this equipment looks.
    for (const tracked of [...this.pending.values()]) {
      if (tracked.kind === "mirror" || tracked.equipmentId !== equipmentId) continue;
      this.observeTracked(tracked, { alias }, value);
    }
    const entry = this.pending.get(`${equipmentId}:${alias}`);
    if (!entry || entry.kind !== "mirror" || entry.deviceMirror) return;
    this.confirm(entry, value);
  }

  /**
   * The ordered device reporting its own state, for an order whose effect no
   * equipment binding could mirror (issue #901).
   */
  private handleDeviceDataUpdated(deviceId: string, key: string, value: unknown): void {
    // Spec 188 O4 — remember every mirror that spoke the end-state vocabulary.
    const word = stateWord(value);
    if (word !== null && END_STATE_VOCABULARY.has(word)) {
      this.endStateSpoken.add(`${deviceId}:${key}`);
    }
    for (const entry of [...this.pending.values()]) {
      if (key === FAULT_REASON_KEY && entry.lastStatus === "fault") {
        this.refreshFaultReason(entry, deviceId, value);
        continue;
      }
      if (entry.deviceMirror?.deviceId !== deviceId) continue;
      if (entry.deviceMirror.key !== key) continue;
      if (entry.kind === "mirror") this.confirm(entry, value);
      else this.observeTracked(entry, { deviceMirror: true }, value);
    }
  }

  /**
   * Spec 188 O3 — the reason may land after the FAULT itself (two keys of one
   * report): the line gains it, and so does the alarm once it is raised.
   */
  private refreshFaultReason(entry: PendingOrder, deviceId: string, value: unknown): void {
    const owner = entry.deviceMirror?.deviceId ?? this.endStateDeviceOf(entry);
    const detail = faultReasonOf(value);
    if (owner !== deviceId || detail === undefined || detail === entry.detail) return;
    entry.detail = detail;
    this.emitOutcome(entry, "fault", true);
    if (entry.alarmRaised) this.raiseAlarm(entry, "device_fault");
  }

  private confirm(entry: PendingOrder, value: unknown): void {
    if (!valuesMatch(entry.value, value)) return;

    if (entry.timer) clearTimeout(entry.timer);
    if (entry.alarmRaised) {
      this.resolveAlarm(entry, "state finally confirmed");
      this.logger.info(
        { equipmentId: entry.equipmentId, alias: entry.alias, value },
        "Unconfirmed order finally confirmed by equipment state",
      );
    }
    this.pending.delete(`${entry.equipmentId}:${entry.alias}`);
  }

  private resolveAlarm(entry: PendingOrder, why: string): void {
    const name = this.equipmentManager.getById(entry.equipmentId)?.name ?? entry.equipmentId;
    // Spec 188 O6 — a tracked order's recovery is worded like its alarm.
    const keyed =
      entry.kind !== "mirror" && why === "state finally confirmed"
        ? {
            messageKey: "alarms.orderOutcome.recovered",
            messageParams: { equipment: name },
          }
        : null;
    this.eventBus.emit({
      type: "system.alarm.resolved",
      alarmId: this.alarmId(entry),
      source: ALARM_SOURCE,
      message: keyed
        ? (wordOrderOutcomeAlarm(keyed.messageKey, keyed.messageParams, "en") ??
          `Order confirmation recovered: ${name} ${entry.alias} (${why})`)
        : `Order confirmation recovered: ${name} ${entry.alias} (${why})`,
      ...(keyed ?? {}),
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

    const { deviceIds, integrationIds, targets } = this.targetsFor(equipmentId, alias);
    const unreachable = integrationIds.filter(
      (id) => this.integrationRegistry.getById(id)?.getStatus() !== "connected",
    );
    if (unreachable.length === 0) return;

    const key = `${equipmentId}:${alias}`;
    const previous = this.pending.get(key);

    const bindings = this.equipmentManager.getDataBindingsWithValues(equipmentId);
    const equipment = this.equipmentManager.getById(equipmentId);
    // Spec 188 O9 — an order that never reached the wire changed nothing, and
    // the ones this spec tracks are never replayed (a second impulse reverses
    // a gate): a gate impulse, whatever the gate state, or a cover order the
    // state could have proven, is not held at all. Its caller already got the
    // dispatch error, and the integration's `order-fail` alarm stands. It is
    // not surfaced as an outcome either: « no confirmation » would read as a
    // command lost on the way, when it was never sent. Whatever was pending
    // on the equipment — a tracked order still in its window, its alarm — is
    // left exactly as it was, and so is any tracked order an exempt held one
    // (a STOP) would otherwise replace.
    const tracked = this.classify(equipment, alias, value, bindings, deviceIds, targets);
    if (tracked || this.isGatePulse(equipment, value) || (previous && previous.kind !== "mirror")) {
      this.logger.warn(
        { equipmentId, alias, value, error, integrationIds: unreachable },
        "Order could not be dispatched — not held: it is never replayed",
      );
      for (const id of unreachable) this.integrationRegistry.noteUnreachable(id);
      return;
    }
    if (previous) {
      if (previous.timer) clearTimeout(previous.timer);
      this.pending.delete(key);
    }

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
      kind: "mirror",
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
