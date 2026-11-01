/**
 * Spec 191 — EV charge sessions: lifecycle, live accounting, attribution.
 *
 * Event-driven, never reads InfluxDB: sessions work without it, and the raw
 * bucket's retention never limits a long session.
 *
 *   ev_charger `vehicle`      → open / close (FR1)
 *   metered charger `power`   → open at 500 W, close after 30 min under it
 *                               (spec 193: a charger with no vehicle state)
 *   ev_charger `power`/`energy` → WindowAccountant (the car per window)
 *   main meter live `energy`  → HouseGridLedger (the import over time)
 *                             → queued windows priced once covered (FR2)
 *   electric_vehicle reports  → evidence per candidate → attribute() after the
 *                               grace period (FR3); driving legs (FR5)
 *
 * Every session is saved at each change. A stop prices the windows still
 * waiting for their grid readings; a crash loses them (the last few minutes).
 * Handlers never throw on the bus.
 */

import { randomUUID } from "node:crypto";
import type { EventBus } from "../../core/event-bus.js";
import type { Logger } from "../../core/logger.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import {
  EV_CHARGER_ALIASES,
  EV_VEHICLE_STATE_CATEGORY,
  METERED_CHARGER_THRESHOLD_W,
  METERED_SESSION_END_MS,
  isEvVehicleState,
} from "../../shared/ev-charger-contract.js";
import { ELECTRIC_VEHICLE_ALIASES } from "../../shared/electric-vehicle-contract.js";
import { localDateStr } from "../../shared/local-date.js";
import type {
  EvChargeSession,
  EvSessionAttributionReason,
  EvVehicleMonthSummary,
  TariffPrices,
} from "../../shared/types.js";
import type { TariffClassifier } from "../tariff-classifier.js";
import {
  type AttributionResult,
  START_SLACK_MS,
  attribute,
  charged,
  emptyEvidence,
  foldPower,
  matches,
  startBattery,
  foldReport,
  type ReportAlias,
  type VehicleEvidence,
} from "./attribution.js";
import { onBattery, onCharging, onMileage } from "./driving.js";
import { type EvSessionStore, type SessionRecord, toSession } from "./ev-session-store.js";
import { monthSummary, whPerBatteryPoint } from "./summary.js";
import { HouseGridLedger } from "./house-grid.js";
import {
  type CarWindow,
  HOLD_LIMIT_MS,
  WINDOW_S,
  WindowAccountant,
  type WindowMeasure,
  poolImport,
  settleWindow,
} from "./window-accountant.js";

export const GRACE_MS = 2 * 3_600_000;
export const MIN_SESSION_WH = 100;
const TICK_MS = 30_000;
/**
 * Audit A1 — a window is priced once a grid delta covering its end has
 * arrived, or this long after its end without one (the meter is silent: all
 * grid, never invented solar).
 */
const GRID_WAIT_MS = 3 * 60_000;

const REPORT_ALIASES: ReadonlySet<string> = new Set<ReportAlias>([
  "plugged",
  "charging_state",
  "battery_level",
  "at_home",
]);

/**
 * What the charger itself reports. Only these keep its held power alive:
 * computed data (`energy_hour`, `energy_day`… from the EnergyAggregator) is
 * emitted on the charger too, hourly, and must not revive a stale reading.
 */
const CHARGER_ALIASES: ReadonlySet<string> = new Set(Object.values(EV_CHARGER_ALIASES));

/** Two updates this close together came in the same report. */
const SAME_REPORT_MS = 5_000;

/** Every alias the tracker reads: anything else is dropped before any lookup. */
const RELEVANT_ALIASES: ReadonlySet<string> = new Set([
  ...CHARGER_ALIASES,
  ...REPORT_ALIASES,
  ELECTRIC_VEHICLE_ALIASES.mileage,
  ELECTRIC_VEHICLE_ALIASES.chargePower,
]);

/** Spec 194 — a car's charging power under this is no charge (no sample). */
const CAR_POWER_MIN_W = 100;
/** Spec 194 — how far back a charger's power readings are kept, to compare late reports. */
const POWER_LOG_MS = 3 * 3_600_000;
/** Spec 194 — a car's report is compared with the charger's readings this close to it. */
const POWER_NEAR_MS = 2 * 60_000;

/** SQLite timestamps use a space (`2026-11-01 10:49:35Z`); ISO uses a `T`. */
function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}

/** A car another session claims (spec 193 FR4): sure or a guess, and why. */
interface Claim {
  vehicleId: string;
  sure: boolean;
  reason: EvSessionAttributionReason | null;
}

/** What a user may set a session to (FR4). */
export type AttributionTarget =
  { target: "vehicle"; vehicleId: string } | { target: "other" } | { target: "unattributed" };

export class EvSessionError extends Error {
  constructor(
    message: string,
    readonly code: "not-found" | "invalid-vehicle",
  ) {
    super(message);
  }
}

/** A local month `YYYY-MM` as an ISO range and a local-day range, end excluded. */
export function monthRange(month: string): {
  fromIso: string;
  toIso: string;
  fromDay: string;
  toDay: string;
} | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const index = Number(m[2]) - 1;
  if (index < 0 || index > 11) return null;
  const from = new Date(year, index, 1);
  const to = new Date(year, index + 1, 1);
  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    fromDay: localDateStr(from),
    toDay: localDateStr(to),
  };
}

interface OpenSession {
  record: SessionRecord;
  acc: WindowAccountant;
  /**
   * The charger has an `energy` binding of its own. Without one, an `energy`
   * event on it is the PowerSubmeterIntegrator's synthetic delta (integrated
   * from a possibly stale power, flushed late): not a meter, ignored.
   */
  hasEnergyMeter: boolean;
  /** Spec 193 — no vehicle state: the session follows the charger's power. */
  metered: boolean;
  /** Metered only: the last reading at the threshold or above, epoch ms. */
  lastActiveMs: number;
  /** Metered only: the last power reading was at the threshold or above. */
  active: boolean;
  /**
   * Metered only: the car reports received while the power is under the
   * threshold. The session may have ended at its last active reading (it is
   * only known 30 min later), so they are folded at close against that end,
   * or into the session if it resumes: a car that leaves right after its
   * charge must not be seen away during its own session.
   */
  tail: Array<{ vehicleId: string; report: Parameters<typeof foldReport>[1] }>;
  /** Spec 194 — the charger's power readings (time, W), to compare a car's own power. */
  powerLog: Array<{ atMs: number; watts: number }>;
}

export class EvSessionTracker {
  private readonly logger: Logger;
  private readonly open = new Map<string, OpenSession>();
  private readonly pending = new Map<string, SessionRecord>();
  /** The house's import per window, from the main meter's live deltas. */
  private readonly ledger = new HouseGridLedger();
  /** Closed car windows waiting for the grid readings that cover them, by start. */
  private readonly queue = new Map<number, Array<{ record: SessionRecord; window: CarWindow }>>();
  /** Metered chargers already warned about a negative power (one warning each). */
  private readonly negativeWarned = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly eventBus: EventBus,
    private readonly equipmentManager: EquipmentManager,
    private readonly tariffClassifier: TariffClassifier,
    private readonly store: EvSessionStore,
    logger: Logger,
    options: { now?: () => number } = {},
  ) {
    this.logger = logger.child({ module: "ev-session-tracker" });
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    this.restore();
    this.unsubscribe = this.eventBus.on((event) => {
      try {
        if (event.type === "equipment.data.changed") {
          this.onData(event.equipmentId, event.alias, event.value, event.sourceTimestamp);
        } else if (event.type === "equipment.removed") {
          this.onRemoved(event.equipmentId);
        }
      } catch (err) {
        this.logger.error({ err }, "EV session handler failed");
      }
    });
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.info(
      { open: this.open.size, pending: this.pending.size },
      "EV session tracker started",
    );
  }

  stop(): void {
    // A restart must not lose the closed windows still waiting for their grid
    // readings: price them with what is in (audit review).
    try {
      this.settleDue(this.now(), true);
    } catch (err) {
      this.logger.error({ err }, "EV session flush at stop failed");
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Close the windows that are due and decide the sessions whose grace is over. */
  tick(): void {
    try {
      const now = this.now();
      for (const s of this.open.values()) this.enqueue(s.record, s.acc.advance(now));
      // Spec 193 — a metered session ends 30 min after its last active reading,
      // dated at that reading.
      for (const [chargerId, s] of [...this.open]) {
        if (s.metered && now - s.lastActiveMs >= METERED_SESSION_END_MS) {
          this.close(chargerId, now, s.lastActiveMs);
        }
      }
      this.settleDue(now);
      for (const record of [...this.pending.values()]) {
        if (record.graceUntil !== null && Date.parse(record.graceUntil) <= now) {
          this.decide(record);
        }
      }
    } catch (err) {
      this.logger.error({ err }, "EV session tick failed");
    }
  }

  // ============================================================
  // Read surface (API)
  // ============================================================

  listByCharger(chargerId: string, month: string): EvChargeSession[] | null {
    const range = monthRange(month);
    if (!range) return null;
    return this.store.listByCharger(chargerId, range.fromIso, range.toIso).map(toSession);
  }

  listByVehicle(vehicleId: string, month: string): EvChargeSession[] | null {
    const range = monthRange(month);
    if (!range) return null;
    return this.store.listByVehicle(vehicleId, range.fromIso, range.toIso).map(toSession);
  }

  /**
   * Spec 192 — the sessions in progress (open, or closed and in their grace
   * period) that would go to this vehicle: attributed to it by hand while
   * open, or that `attribute()` run now would give it. Newest first.
   */
  currentForVehicle(vehicleId: string): EvChargeSession[] {
    return this.liveRecords()
      .filter((record) => {
        if (record.attributionSource === "manual") {
          return record.endedAt === null && record.vehicleId === vehicleId;
        }
        const result = this.resolve(record);
        return result.state === "vehicle" && result.vehicleId === vehicleId;
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(toSession);
  }

  summary(vehicleId: string, month: string): EvVehicleMonthSummary | null {
    const range = monthRange(month);
    if (!range) return null;
    const sessions = this.store
      .listByVehicle(vehicleId, range.fromIso, range.toIso)
      .filter((r) => r.endedAt !== null)
      .map(toSession);
    const driving = this.store.sumDriving(vehicleId, range.fromDay, range.toDay);
    return monthSummary({
      vehicleId,
      month,
      sessions,
      plugInHybrid: this.equipmentManager.getById(vehicleId)?.plugInHybrid === true,
      whPerPoint: whPerBatteryPoint(this.store.listForLearning(vehicleId).map(toSession)),
      driving,
    });
  }

  /** FR4 — a user's choice; final. */
  setAttribution(sessionId: string, choice: AttributionTarget): EvChargeSession {
    const record = this.findRecord(sessionId);
    if (!record) throw new EvSessionError("Session not found", "not-found");

    if (choice.target === "vehicle") {
      const vehicle = this.equipmentManager.getById(choice.vehicleId);
      if (!vehicle || vehicle.type !== "electric_vehicle") {
        throw new EvSessionError("Unknown vehicle", "invalid-vehicle");
      }
      this.assign(record, vehicle.id, vehicle.name);
      record.attribution = "vehicle";
    } else {
      record.vehicleId = null;
      record.vehicleName = null;
      record.vehicleDeleted = false;
      record.batteryStart = null;
      record.batteryEnd = null;
      record.attribution = choice.target === "other" ? "other" : "unattributed";
    }
    record.attributionSource = "manual";
    record.attributionReason = null;
    // A closed session stays followed until its grace ends (its final battery
    // level, audit A4); `decide` then leaves a manual choice alone.
    this.persist(record);
    this.logger.info(
      { sessionId, attribution: record.attribution, vehicleId: record.vehicleId },
      "EV session attributed by hand",
    );
    return toSession(record);
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  private restore(): void {
    const now = this.now();
    for (const record of this.store.listOpen()) {
      const metered = this.chargerIsMetered(record.chargerId);
      this.open.set(record.chargerId, {
        record,
        acc: new WindowAccountant(now),
        hasEnergyMeter: this.chargerHasEnergyMeter(record.chargerId),
        metered,
        lastActiveMs: metered ? this.meteredLastActive(record, now) : now,
        active: !metered || this.chargerDraws(record.chargerId),
        tail: [],
        powerLog: [],
      });
      // Audit A9 — a charger that reports its power only on change would
      // count nothing until its next change: hold its last reading again.
      const reading = this.chargerPowerReading(record.chargerId);
      if (reading && now - reading.atMs <= HOLD_LIMIT_MS) {
        this.open.get(record.chargerId)!.acc.resume(now, reading.watts, reading.atMs);
        this.open
          .get(record.chargerId)!
          .powerLog.push({ atMs: reading.atMs, watts: reading.watts });
      }
      if (!this.equipmentManager.getById(record.chargerId)) {
        this.close(record.chargerId, now);
        continue;
      }
      const { state, changedAtMs } = this.chargerVehicleState(record.chargerId);
      if (state === "disconnected") {
        // Closed at the time of that reading (FR1), not at this start.
        const startMs = Date.parse(record.startedAt);
        const at =
          changedAtMs !== null && changedAtMs >= startMs && changedAtMs <= now ? changedAtMs : now;
        this.close(record.chargerId, at);
      }
    }
    // Issue #1105 — a car may have reported while Sowel was down.
    for (const s of this.open.values()) {
      if (this.seedEvidence(s.record, false)) this.persist(s.record);
    }
    for (const record of this.store.listPending(new Date(now).toISOString())) {
      this.pending.set(record.id, record);
    }

    // A charger already plugged (first start, or a missed event) opens now;
    // a metered one already drawing too (spec 193).
    for (const eq of this.equipmentManager.getAll()) {
      if (eq.type !== "ev_charger" || !eq.enabled || this.open.has(eq.id)) continue;
      if (this.chargerIsMetered(eq.id)) {
        if (this.chargerDraws(eq.id)) this.openSession(eq.id, eq.name, now);
        continue;
      }
      const { state } = this.chargerVehicleState(eq.id);
      if (state === "connected" || state === "charging") this.openSession(eq.id, eq.name, now);
    }
  }

  private openSession(chargerId: string, chargerName: string, now: number): void {
    const nowIso = new Date(now).toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      chargerId,
      chargerName,
      startedAt: nowIso,
      endedAt: null,
      graceUntil: null,
      energyWh: 0,
      estCarWh: 0,
      estGridHpWh: 0,
      estGridHcWh: 0,
      estCostHpEur: null,
      estCostHcEur: null,
      vehicleId: null,
      vehicleName: null,
      vehicleDeleted: false,
      attribution: "pending",
      attributionSource: null,
      attributionReason: null,
      batteryStart: null,
      batteryEnd: null,
      evidence: [],
      updatedAt: nowIso,
    };
    this.open.set(chargerId, {
      record,
      acc: new WindowAccountant(now),
      hasEnergyMeter: this.chargerHasEnergyMeter(chargerId),
      metered: this.chargerIsMetered(chargerId),
      lastActiveMs: now,
      active: true,
      tail: [],
      powerLog: [],
    });
    this.seedEvidence(record, true);
    this.persist(record);
    this.logger.info({ sessionId: record.id, chargerId }, "EV charge session opened");
  }

  /**
   * `now` ends the accounting; `endedAtMs` dates the session (spec 193: a
   * metered session ends at its last active reading, noticed 30 min later).
   */
  private close(chargerId: string, now: number, endedAtMs: number = now): void {
    const s = this.open.get(chargerId);
    if (!s) return;
    this.open.delete(chargerId);
    const record = s.record;
    this.enqueue(record, s.acc.finish(now));
    const endedAt = Math.max(Date.parse(record.startedAt), Math.min(endedAtMs, now));
    record.endedAt = new Date(endedAt).toISOString();
    record.graceUntil = new Date(endedAt + GRACE_MS).toISOString();
    for (const { vehicleId, report } of s.tail) this.foldInto(record, vehicleId, report, endedAt);

    const queuedCarWh = this.queuedCarWh(record);
    const energyWh = record.energyWh > 0 ? record.energyWh : record.estCarWh + queuedCarWh;
    if (energyWh < MIN_SESSION_WH) {
      for (const [startS, entries] of this.queue) {
        const kept = entries.filter((e) => e.record !== record);
        if (kept.length > 0) this.queue.set(startS, kept);
        else this.queue.delete(startS);
      }
      this.store.delete(record.id);
      this.eventBus.emit({
        type: "energy.ev_session.deleted",
        sessionId: record.id,
        chargerId: record.chargerId,
      });
      this.logger.info({ sessionId: record.id }, "EV charge session dropped (under 100 Wh)");
      return;
    }
    // Audit A8 — the meter moved but no window measured the car (no power and
    // no window left): price it all grid over the session rather than not at all.
    if (record.energyWh > 0 && record.estCarWh + queuedCarWh <= 0) {
      const startS = Math.floor(Date.parse(record.startedAt) / 1000);
      this.price(
        record,
        {
          startS,
          lengthS: Math.max(1, Math.round(endedAt / 1000) - startS),
          carWh: record.energyWh,
          fromMs: startS * 1000,
          toMs: endedAt,
          importWh: null,
        },
        this.hasMainMeter(),
        this.prices(),
      );
    }
    // Manual ones too: they take no automatic decision, but still the final
    // battery level reported just after the end (audit A4).
    this.pending.set(record.id, record);
    this.persist(record);
    this.settleDue(now);
    this.logger.info(
      { sessionId: record.id, chargerId, energyWh: Math.round(toSession(record).energyWh) },
      "EV charge session closed",
    );
  }

  /**
   * Issue #1105 — what each car already says: a « charging », « plugged » or
   * battery level it reported just before the session opened counts (from
   * `positiveFrom`), even if its plugin never publishes it again. At the
   * opening (`atOpen`), a car whose last known location is away is noted so
   * (audit A5): it must be seen home during the session to match. Returns
   * whether anything was added.
   */
  private seedEvidence(record: SessionRecord, atOpen: boolean): boolean {
    const startMs = Date.parse(record.startedAt);
    const endMs = record.endedAt === null ? null : Date.parse(record.endedAt);
    let changed = false;
    for (const vehicleId of this.candidateVehicleIds()) {
      const bindings = this.equipmentManager.getDataBindingsWithValues(vehicleId);
      const index = record.evidence.findIndex((e) => e.vehicleId === vehicleId);
      const before = index >= 0 ? record.evidence[index] : emptyEvidence(vehicleId);
      let evidence = before;
      const slackFromMs = before.slackFromMs ?? this.positiveFrom(record, vehicleId);
      if (atOpen) evidence = { ...evidence, slackFromMs };
      const window = { startMs, endMs, positiveFromMs: slackFromMs };
      for (const alias of [
        ELECTRIC_VEHICLE_ALIASES.chargingState,
        ELECTRIC_VEHICLE_ALIASES.plugged,
        ELECTRIC_VEHICLE_ALIASES.batteryLevel,
      ] as const) {
        const binding = bindings.find((b) => b.alias === alias);
        const receivedAtMs = parseTimestamp(binding?.lastUpdated ?? null);
        if (!binding || receivedAtMs === null) continue;
        // Read at the opening, so made before it, even within the same tick
        // (for a restored session: whenever it was made, its own time holds).
        const madeAt = this.vehicleReportedAt(vehicleId, alias) ?? receivedAtMs;
        const at = record.endedAt === null && madeAt >= startMs ? startMs - 1 : madeAt;
        evidence = foldReport(
          evidence,
          { alias, value: binding.value, reportedAtMs: at, receivedAtMs: at },
          window,
        );
      }
      const away =
        bindings.find((b) => b.alias === ELECTRIC_VEHICLE_ALIASES.atHome)?.value === false;
      if (atOpen && away && !evidence.awayAtStart) evidence = { ...evidence, awayAtStart: true };
      if (evidence === before) continue;
      if (index >= 0) record.evidence[index] = evidence;
      else record.evidence.push(evidence);
      changed = true;
    }
    return changed;
  }

  /**
   * Issue #1105 — from when a car's report made before the session started
   * still counts: START_SLACK_MS before it, but never inside another session
   * that may hold this car: this charger's previous one always, one on
   * another charger unless it gives another car (set or provisional, see
   * `givenBy`; audit A6). A report made then belongs to that session.
   */
  private positiveFrom(record: SessionRecord, vehicleId: string): number {
    const startMs = Date.parse(record.startedAt);
    const slackStart = startMs - START_SLACK_MS;
    let from = slackStart;
    for (const other of this.store.listMeeting(
      record.id,
      new Date(slackStart).toISOString(),
      record.startedAt,
    )) {
      if (!this.holds(other, record, vehicleId, slackStart)) continue;
      const end = other.endedAt === null ? startMs : Math.min(Date.parse(other.endedAt), startMs);
      from = Math.max(from, end);
    }
    return from;
  }

  /**
   * Whether `other` holds this car just before `record` opened, so that the
   * car's reports made then belong to it and not to `record`: a session on the
   * same charger always (a late report of its car must not pass to the next
   * one); one given this car by hand; on another charger, one where this car
   * was already charging before the slack (`slackStartMs`). A car first seen
   * there within the slack may be the one that just plugged in here (a
   * metered charger opens on its first 500 W, minutes after the plug-in): its
   * report then counts for both, and the two sessions stay to attribute
   * rather than one of them guessing (P7; audit A6 and its reviews). Evidence
   * without a time (saved before) holds.
   */
  private holds(
    other: SessionRecord,
    record: SessionRecord,
    vehicleId: string,
    slackStartMs: number,
  ): boolean {
    if (other.chargerId === record.chargerId) return true;
    if (other.attributionSource === "manual") {
      return other.attribution === "vehicle" && other.vehicleId === vehicleId;
    }
    const e = other.evidence.find((x) => x.vehicleId === vehicleId);
    if (!e || !charged(e)) return false;
    return e.firstChargingAtMs == null || e.firstChargingAtMs < slackStartMs;
  }

  /** FR3 — at the end of the grace period. */
  private decide(record: SessionRecord): void {
    this.pending.delete(record.id);
    if (record.attributionSource === "manual") return;
    const result = this.resolve(record);
    if (result.state === "vehicle") {
      const name = this.equipmentManager.getById(result.vehicleId)?.name ?? null;
      this.assign(record, result.vehicleId, name);
      record.attribution = "vehicle";
    } else {
      record.attribution = "unattributed";
    }
    record.attributionSource = "auto";
    record.attributionReason = result.reason;
    this.persist(record);
    this.logger.info(
      { sessionId: record.id, attribution: record.attribution, reason: result.reason },
      "EV charge session attributed",
    );
  }

  private assign(record: SessionRecord, vehicleId: string, name: string | null): void {
    const evidence = record.evidence.find((e) => e.vehicleId === vehicleId);
    record.vehicleId = vehicleId;
    record.vehicleName = name;
    record.vehicleDeleted = false;
    record.batteryStart = evidence ? startBattery(evidence) : null;
    record.batteryEnd = evidence?.maxBattery ?? null;
  }

  // ============================================================
  // Events
  // ============================================================

  private onData(
    equipmentId: string,
    alias: string,
    value: unknown,
    sourceTimestamp: number | undefined,
  ): void {
    // Most of the house's traffic is none of this: drop it before any lookup.
    if (!RELEVANT_ALIASES.has(alias)) return;
    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq) return;
    const now = this.now();

    if (eq.type === "ev_charger") {
      this.onCharger(eq.id, eq.name, eq.enabled, alias, value, now);
    } else if (eq.type === "main_energy_meter") {
      // Live ticks only: an aligned historical window says nothing about now.
      if (!eq.enabled || alias !== "energy" || sourceTimestamp !== undefined) return;
      if (typeof value !== "number") return;
      this.ledger.tick(now, value);
      for (const s of this.open.values()) this.enqueue(s.record, s.acc.advance(now));
      this.settleDue(now);
    } else if (eq.type === "electric_vehicle") {
      if (
        REPORT_ALIASES.has(alias) ||
        alias === ELECTRIC_VEHICLE_ALIASES.mileage ||
        alias === ELECTRIC_VEHICLE_ALIASES.chargePower
      ) {
        // A car's report arrives as several updates in one burst, `reported_at`
        // among them in any order: read it once the burst is over.
        queueMicrotask(() => {
          try {
            this.onVehicle(equipmentId, alias, value, now);
          } catch (err) {
            this.logger.error({ err, equipmentId }, "EV vehicle report handling failed");
          }
        });
      }
    }
  }

  private onCharger(
    chargerId: string,
    chargerName: string,
    enabled: boolean,
    alias: string,
    value: unknown,
    now: number,
  ): void {
    if (alias === EV_CHARGER_ALIASES.vehicle) {
      if (!isEvVehicleState(value)) return;
      if (value === "disconnected") this.close(chargerId, now);
      else if (enabled && !this.open.has(chargerId)) this.openSession(chargerId, chargerName, now);
      else this.open.get(chargerId)?.acc.chargerReport(now);
      return;
    }
    if (alias === EV_CHARGER_ALIASES.power && typeof value === "number") {
      const active = value >= METERED_CHARGER_THRESHOLD_W;
      // A metered charger drawing « minus 7 kW » is a clamp mounted the wrong
      // way: no session can open on it. Say so once.
      if (
        value <= -METERED_CHARGER_THRESHOLD_W &&
        !this.negativeWarned.has(chargerId) &&
        this.chargerIsMetered(chargerId)
      ) {
        this.negativeWarned.add(chargerId);
        this.logger.warn(
          { chargerId, chargerName, power: value },
          "Metered charger reads a negative power: its meter may be mounted the wrong way",
        );
      }
      // Spec 193 — a metered charger opens on its power.
      if (active && enabled && !this.open.has(chargerId) && this.chargerIsMetered(chargerId)) {
        this.openSession(chargerId, chargerName, now);
      }
      const open = this.open.get(chargerId);
      if (!open) return;
      open.powerLog.push({ atMs: now, watts: value });
      while (open.powerLog.length > 0 && open.powerLog[0].atMs < now - POWER_LOG_MS) {
        open.powerLog.shift();
      }
      if (open.metered) {
        if (active) {
          open.lastActiveMs = now;
          // It resumed: what the cars said meanwhile belongs to the session.
          for (const { vehicleId, report } of open.tail) {
            this.foldInto(open.record, vehicleId, report, null);
          }
          open.tail = [];
        }
        open.active = active;
      }
      this.enqueue(open.record, open.acc.power(now, value));
      this.settleDue(now);
      return;
    }
    const s = this.open.get(chargerId);
    if (!s) return;
    if (alias === EV_CHARGER_ALIASES.energy) {
      if (!s.hasEnergyMeter || typeof value !== "number") return;
      if (value > 0) s.record.energyWh += value;
      this.enqueue(s.record, s.acc.carEnergy(now, value));
      this.settleDue(now);
    } else if (CHARGER_ALIASES.has(alias)) {
      s.acc.chargerReport(now);
    }
  }

  private onVehicle(vehicleId: string, alias: string, value: unknown, receivedAtMs: number): void {
    if (alias === ELECTRIC_VEHICLE_ALIASES.chargePower) {
      this.onCarPower(vehicleId, value, receivedAtMs);
      return;
    }
    if (REPORT_ALIASES.has(alias)) {
      const reportedAtMs = this.vehicleReportedAt(vehicleId, alias);
      const report = { alias: alias as ReportAlias, value, reportedAtMs, receivedAtMs };
      for (const s of this.open.values()) {
        if (s.metered && !s.active) s.tail.push({ vehicleId, report });
        else this.foldInto(s.record, vehicleId, report, null);
      }
      for (const record of this.pending.values()) {
        this.foldInto(record, vehicleId, report, Date.parse(record.endedAt!));
      }
    }
    this.advanceLeg(vehicleId, alias, value, receivedAtMs);
  }

  /**
   * Spec 194 — the car's own charging power, compared with each open session's
   * charger at the time the car reported it. A report repeated with the same
   * time (a plugin publishing again) is one sample.
   */
  private onCarPower(vehicleId: string, value: unknown, receivedAtMs: number): void {
    if (typeof value !== "number" || !Number.isFinite(value) || value < CAR_POWER_MIN_W) return;
    const atMs =
      this.vehicleReportedAt(vehicleId, ELECTRIC_VEHICLE_ALIASES.chargePower) ?? receivedAtMs;
    for (const s of this.open.values()) {
      if (atMs < Date.parse(s.record.startedAt)) continue;
      const near = this.chargerPowersNear(s, atMs);
      if (near === null) continue;
      const record = s.record;
      const index = record.evidence.findIndex((e) => e.vehicleId === vehicleId);
      const before = index >= 0 ? record.evidence[index] : emptyEvidence(vehicleId);
      if (before.powerSampledAtMs === atMs) continue;
      // Agrees when any reading around the report does (a ramp, a surplus
      // step, the car's clock): disagrees only when none does.
      const sampled = near.map((w) => foldPower(before, value, w));
      const after = {
        ...(sampled.find((e) => (e.powerAgreeing ?? 0) > (before.powerAgreeing ?? 0)) ??
          sampled[0]),
        powerSampledAtMs: atMs,
      };
      if (index >= 0) record.evidence[index] = after;
      else record.evidence.push(after);
      this.persist(record);
    }
  }

  /**
   * The charger's readings within POWER_NEAR_MS of `atMs` (and the one held at
   * its start), when it was drawing all along: none while it was under 500 W
   * — a pause, a charge starting or stopping — where a car's report says
   * nothing about where it charges.
   */
  private chargerPowersNear(s: OpenSession, atMs: number): number[] | null {
    let held: number | null = null;
    const near: number[] = [];
    for (const p of s.powerLog) {
      if (p.atMs < atMs - POWER_NEAR_MS) {
        held = p.watts;
        continue;
      }
      if (p.atMs > atMs + POWER_NEAR_MS) break;
      near.push(p.watts);
    }
    const all = held === null ? near : [held, ...near];
    if (all.length === 0) return null;
    if (all.some((w) => w < METERED_CHARGER_THRESHOLD_W)) return null;
    return all;
  }

  private foldInto(
    record: SessionRecord,
    vehicleId: string,
    report: Parameters<typeof foldReport>[1],
    endMs: number | null,
  ): void {
    const index = record.evidence.findIndex((e) => e.vehicleId === vehicleId);
    const before: VehicleEvidence = index >= 0 ? record.evidence[index] : emptyEvidence(vehicleId);
    const startMs = Date.parse(record.startedAt);
    const at = report.reportedAtMs ?? report.receivedAtMs;
    const after = foldReport(before, report, {
      startMs,
      endMs,
      ...(at < startMs && {
        positiveFromMs: before.slackFromMs ?? this.positiveFrom(record, vehicleId),
      }),
    });
    if (after === before) return;
    if (index >= 0) record.evidence[index] = after;
    else record.evidence.push(after);
    // Audit A3 — a session given to this car (by hand while open) follows its
    // battery to the end, so it can teach the energy per point.
    if (record.attribution === "vehicle" && record.vehicleId === vehicleId) {
      record.batteryStart = startBattery(after);
      record.batteryEnd = after.maxBattery;
    }
    // Emitted: the vehicle page shows a session once a car matches (spec 192).
    this.persist(record);
  }

  private advanceLeg(vehicleId: string, alias: string, value: unknown, atMs: number): void {
    if (alias === ELECTRIC_VEHICLE_ALIASES.mileage) {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      const battery = this.vehicleNumber(vehicleId, ELECTRIC_VEHICLE_ALIASES.batteryLevel);
      const { next, leg } = onMileage(this.store.getLeg(vehicleId), value, battery, atMs);
      this.store.setLeg(vehicleId, next);
      if (leg) this.store.addDriving(vehicleId, localDateStr(new Date(atMs)), leg);
      return;
    }
    const state = this.store.getLeg(vehicleId);
    if (!state) return;
    if (alias === ELECTRIC_VEHICLE_ALIASES.batteryLevel && typeof value === "number") {
      this.store.setLeg(vehicleId, onBattery(state, value));
    } else if (alias === ELECTRIC_VEHICLE_ALIASES.chargingState && value === "charging") {
      this.store.setLeg(vehicleId, onCharging(state));
    }
  }

  private onRemoved(equipmentId: string): void {
    const nowIso = new Date(this.now()).toISOString();
    if (this.open.has(equipmentId)) this.close(equipmentId, this.now());
    // A vehicle: its sessions keep its name and count nowhere. The records
    // held in memory too, or their next save would write the flag back.
    for (const record of [
      ...[...this.open.values()].map((s) => s.record),
      ...this.pending.values(),
    ]) {
      if (record.vehicleId === equipmentId) record.vehicleDeleted = true;
    }
    this.store.markVehicleDeleted(equipmentId, nowIso);
    this.store.deleteLeg(equipmentId);
  }

  // ============================================================
  // Accounting
  // ============================================================

  private enqueue(record: SessionRecord, windows: CarWindow[]): void {
    for (const window of windows) {
      const entries = this.queue.get(window.startS) ?? [];
      entries.push({ record, window });
      this.queue.set(window.startS, entries);
    }
  }

  private queuedCarWh(record: SessionRecord): number {
    let wh = 0;
    for (const entries of this.queue.values()) {
      for (const e of entries) if (e.record === record) wh += e.window.carWh;
    }
    return wh;
  }

  /**
   * Price the windows whose grid readings are in (audit A1), sharing each
   * window's import between its sessions (audit A2), and save the sessions
   * that changed.
   */
  private settleDue(now: number, force = false): void {
    this.ledger.prune(
      Math.min(...this.queue.keys(), Math.floor(now / 1000 / WINDOW_S) * WINDOW_S - WINDOW_S) *
        1000,
    );
    if (this.queue.size === 0) return;
    const hasMainMeter = this.hasMainMeter();
    const prices = this.prices();
    const covered = this.ledger.coveredUntilMs;
    const changed = new Set<SessionRecord>();
    for (const startS of [...this.queue.keys()].sort((a, b) => a - b)) {
      const endMs = (startS + WINDOW_S) * 1000;
      const complete = covered !== null && covered >= endMs;
      const ready = force || !hasMainMeter || complete || now >= endMs + GRID_WAIT_MS;
      if (!ready) break;
      const entries = this.queue.get(startS)!;
      this.queue.delete(startS);
      // A window the meter did not cover to its end is all grid: its missing
      // minutes must not read as solar (never invent solar).
      const from = Math.min(...entries.map((e) => e.window.fromMs));
      const to = Math.max(...entries.map((e) => e.window.toMs));
      const own = entries.map((e) => this.ledger.importBetween(e.window.fromMs, e.window.toMs));
      const windowImport =
        hasMainMeter && complete && own.every((v) => v !== null)
          ? this.ledger.importBetween(from, to)
          : null;
      const imports = poolImport(
        entries.map((e) => e.window.carWh),
        own.map((v) => v ?? 0),
        windowImport,
      );
      entries.forEach((e, i) => {
        this.price(e.record, { ...e.window, importWh: imports[i] }, hasMainMeter, prices);
        changed.add(e.record);
      });
    }
    for (const record of changed) this.persist(record);
  }

  private price(
    r: SessionRecord,
    w: WindowMeasure,
    hasMainMeter: boolean,
    prices: TariffPrices | null,
  ): void {
    const split = this.tariffClassifier.classify(1_000_000, w.startS, w.lengthS);
    const total = split.hp + split.hc;
    const settled = settleWindow(w, {
      hasMainMeter,
      hcShare: total > 0 ? split.hc / total : 0,
      prices,
    });
    r.estCarWh += settled.carWh;
    r.estGridHpWh += settled.gridHpWh;
    r.estGridHcWh += settled.gridHcWh;
    if (settled.costHpEur !== null) r.estCostHpEur = (r.estCostHpEur ?? 0) + settled.costHpEur;
    if (settled.costHcEur !== null) r.estCostHcEur = (r.estCostHcEur ?? 0) + settled.costHcEur;
  }

  private hasMainMeter(): boolean {
    return this.equipmentManager.getAll().some((e) => e.type === "main_energy_meter" && e.enabled);
  }

  private prices(): TariffPrices | null {
    const prices = this.tariffClassifier.getConfig()?.prices;
    if (!prices) return null;
    return (prices.hp ?? 0) > 0 || (prices.hc ?? 0) > 0 ? prices : null;
  }

  // ============================================================
  // Helpers
  // ============================================================

  private persist(record: SessionRecord): void {
    // The charger's current name, not the one it had when the session opened.
    const charger = this.equipmentManager.getById(record.chargerId);
    if (charger) record.chargerName = charger.name;
    record.updatedAt = new Date(this.now()).toISOString();
    this.store.save(record);
    this.eventBus.emit({ type: "energy.ev_session.updated", session: toSession(record) });
  }

  /** The open sessions and those still in their grace period. */
  private liveRecords(): SessionRecord[] {
    return [...[...this.open.values()].map((s) => s.record), ...this.pending.values()];
  }

  /**
   * The attribution of a session, now: its evidence, minus the cars that an
   * overlapping session on another charger gives (spec 193 P4), with its
   * charger's usual vehicle to break a tie. A single match that only stands
   * because a usual-vehicle guess elsewhere took the other car is a guess too:
   * it reads « usual vehicle », never « single match » (audit A7).
   */
  private resolve(record: SessionRecord): AttributionResult {
    const taken = this.takenElsewhere(record);
    const excluded = new Set(taken.keys());
    // Spec 194 review — this session claims a car another one claims too. Of
    // the same strength (both sure, or both guesses, both automatic): it
    // cannot be on both and nothing says which, so both stay to attribute
    // rather than each falling to the other car. Otherwise the stronger claim
    // keeps it: a choice by hand or a sure claim elsewhere takes it from a
    // guess here (spec 193 FR4), a sure claim here keeps it from a guess there.
    const own = this.givenBy(record);
    if (own !== null && own.reason !== null) {
      const other = taken.get(own.vehicleId);
      if (other && other.reason !== null && other.sure === own.sure) {
        const oneCar = this.candidateVehicleIds().length === 1;
        return { state: "unattributed", reason: oneCar ? "no-match" : "several-matches" };
      }
      if (other && own.sure && !other.sure) excluded.delete(own.vehicleId);
    }
    const result = attribute(record.evidence, this.candidateVehicleIds(), {
      usualVehicleId: this.usualVehicleOf(record.chargerId),
      excluded,
      ...this.measures(record),
    });
    if (result.state === "vehicle" && result.reason === "single-match") {
      // A match that only stands because another session took the other car
      // says why that one did: a guess (audit A7), or a measure (spec 194).
      const reasons = [...taken]
        .filter(
          ([vehicleId]) =>
            excluded.has(vehicleId) &&
            record.evidence.some((e) => e.vehicleId === vehicleId && matches(e)),
        )
        .map(([, claim]) => claim);
      if (reasons.some((c) => !c.sure)) return { ...result, reason: "usual-vehicle" };
      const measured = reasons.find(
        (c) => c.reason === "power-match" || c.reason === "energy-match",
      );
      if (measured?.reason) return { ...result, reason: measured.reason };
    }
    return result;
  }

  /**
   * The car a session claims, without P4 (no cycle), and whether it is sure:
   * by hand (sure), or what its own evidence gives — a single match (sure) or
   * its usual vehicle (a guess) — whether it was decided yet or not, so that
   * two sessions claiming one car exclude it from each other in any order.
   * "The only vehicle" rests on no evidence (a guest's car would do the same):
   * it claims none.
   */
  private givenBy(record: SessionRecord): Claim | null {
    if (record.attributionSource === "manual") {
      return record.attribution === "vehicle" && record.vehicleId !== null
        ? { vehicleId: record.vehicleId, sure: true, reason: null }
        : null;
    }
    const result = attribute(record.evidence, this.candidateVehicleIds(), {
      usualVehicleId: this.usualVehicleOf(record.chargerId),
      ...this.measures(record),
    });
    if (result.state !== "vehicle" || result.reason === "only-vehicle") return null;
    return {
      vehicleId: result.vehicleId,
      sure: result.reason !== "usual-vehicle",
      reason: result.reason,
    };
  }

  /**
   * Cars claimed by sessions on other chargers whose time range meets this
   * one, each with whether it is sure (a sure claim wins over a guess).
   */
  private takenElsewhere(record: SessionRecord): Map<string, Claim> {
    const others = new Map<string, SessionRecord>();
    for (const r of this.store.listMeeting(
      record.id,
      record.startedAt,
      record.endedAt ?? "9999-12-31T23:59:59.999Z",
    )) {
      if (r.chargerId !== record.chargerId) others.set(r.id, r);
    }
    // In memory first: the freshest evidence.
    for (const r of this.liveRecords()) {
      if (r.id !== record.id && others.has(r.id)) others.set(r.id, r);
    }
    const taken = new Map<string, Claim>();
    for (const other of others.values()) {
      const given = this.givenBy(other);
      if (given === null) continue;
      const held = taken.get(given.vehicleId);
      if (!held || (!held.sure && given.sure)) taken.set(given.vehicleId, given);
    }
    return taken;
  }

  /**
   * Spec 194 — what the energy signal needs: the session's energy and each car's
   * learned energy per battery point (from its own sessions, this one left out).
   */
  private measures(record: SessionRecord): {
    energyWh: number;
    whPerPoint: Map<string, number>;
  } {
    const whPerPoint = new Map<string, number>();
    // Only a tie needs them: skip the queries for the common single match.
    if (record.evidence.filter(matches).length < 2) {
      return { energyWh: 0, whPerPoint };
    }
    for (const e of record.evidence) {
      const learned = whPerBatteryPoint(
        this.store
          .listForLearning(e.vehicleId)
          .filter((r) => r.id !== record.id)
          .map(toSession),
      );
      if (learned !== null) whPerPoint.set(e.vehicleId, learned);
    }
    return { energyWh: toSession(record).energyWh, whPerPoint };
  }

  private usualVehicleOf(chargerId: string): string | null {
    return this.equipmentManager.getById(chargerId)?.usualVehicleId ?? null;
  }

  /** Spec 193 — a charger without a vehicle state follows its power. */
  private chargerIsMetered(chargerId: string): boolean {
    return !this.equipmentManager
      .getDataBindingsWithValues(chargerId)
      .some(
        (b) => b.alias === EV_CHARGER_ALIASES.vehicle || b.category === EV_VEHICLE_STATE_CATEGORY,
      );
  }

  /**
   * After a restart: now when the charger still draws, else when its power
   * last changed, never before the session started. That is the drop, or a
   * later change of standby noise: an approximation, the true last active
   * reading is not stored (spec 193 edge cases).
   */
  private meteredLastActive(record: SessionRecord, now: number): number {
    const binding = this.equipmentManager
      .getDataBindingsWithValues(record.chargerId)
      .find((b) => b.alias === EV_CHARGER_ALIASES.power);
    const startMs = Date.parse(record.startedAt);
    if (typeof binding?.value === "number" && binding.value >= METERED_CHARGER_THRESHOLD_W) {
      return now;
    }
    const changed = parseTimestamp(binding?.lastChanged ?? null);
    if (changed === null) return startMs;
    return Math.min(now, Math.max(startMs, changed));
  }

  private chargerPowerReading(chargerId: string): { watts: number; atMs: number } | null {
    const binding = this.equipmentManager
      .getDataBindingsWithValues(chargerId)
      .find((b) => b.alias === EV_CHARGER_ALIASES.power);
    const atMs = parseTimestamp(binding?.lastUpdated ?? null);
    if (typeof binding?.value !== "number" || !Number.isFinite(binding.value) || atMs === null) {
      return null;
    }
    return { watts: binding.value, atMs };
  }

  private chargerDraws(chargerId: string): boolean {
    const binding = this.equipmentManager
      .getDataBindingsWithValues(chargerId)
      .find((b) => b.alias === EV_CHARGER_ALIASES.power);
    return typeof binding?.value === "number" && binding.value >= METERED_CHARGER_THRESHOLD_W;
  }

  /** Every vehicle a session may go to (spec 191 P9): the enabled ones. */
  private candidateVehicleIds(): string[] {
    return this.equipmentManager
      .getAll()
      .filter((e) => e.type === "electric_vehicle" && e.enabled)
      .map((e) => e.id);
  }

  private findRecord(sessionId: string): SessionRecord | null {
    for (const s of this.open.values()) if (s.record.id === sessionId) return s.record;
    return this.pending.get(sessionId) ?? this.store.get(sessionId);
  }

  private chargerVehicleState(chargerId: string): {
    state: string | null;
    changedAtMs: number | null;
  } {
    const binding = this.equipmentManager
      .getDataBindingsWithValues(chargerId)
      .find((b) => b.alias === EV_CHARGER_ALIASES.vehicle);
    return {
      state: isEvVehicleState(binding?.value) ? binding.value : null,
      changedAtMs: parseTimestamp(binding?.lastChanged ?? binding?.lastUpdated),
    };
  }

  private chargerHasEnergyMeter(chargerId: string): boolean {
    return this.equipmentManager
      .getDataBindingsWithValues(chargerId)
      .some((b) => b.alias === EV_CHARGER_ALIASES.energy);
  }

  /**
   * The car's own report time for an update, when that update came with it:
   * `reported_at` applies only to the values published in the same report
   * (a Renault battery-status read), not to those of another poll (its
   * location, hence `at_home`), which take the time Sowel received them.
   */
  private vehicleReportedAt(vehicleId: string, alias: string): number | null {
    // The location comes from its own poll, even within 5 s of a battery read
    // (both at the plugin's start): it never takes that report's time.
    if (alias === ELECTRIC_VEHICLE_ALIASES.atHome) return null;
    const bindings = this.equipmentManager.getDataBindingsWithValues(vehicleId);
    const reportedAt = bindings.find((b) => b.alias === ELECTRIC_VEHICLE_ALIASES.reportedAt);
    const own = bindings.find((b) => b.alias === alias);
    const reportedUpdated = parseTimestamp(reportedAt?.lastUpdated);
    const ownUpdated = parseTimestamp(own?.lastUpdated);
    if (reportedUpdated === null || ownUpdated === null) return null;
    if (Math.abs(reportedUpdated - ownUpdated) > SAME_REPORT_MS) return null;
    return parseTimestamp(reportedAt?.value);
  }

  private vehicleNumber(vehicleId: string, alias: string): number | null {
    const binding = this.equipmentManager
      .getDataBindingsWithValues(vehicleId)
      .find((b) => b.alias === alias);
    return typeof binding?.value === "number" && Number.isFinite(binding.value)
      ? binding.value
      : null;
  }
}
