/**
 * Spec 191 — EV charge sessions: lifecycle, live accounting, attribution.
 *
 * Event-driven, never reads InfluxDB: sessions work without it, and the raw
 * bucket's retention never limits a long session.
 *
 *   ev_charger `vehicle`      → open / close (FR1)
 *   metered charger `power`   → open at 500 W, close after 30 min under it
 *                               (spec 193: a charger with no vehicle state)
 *   ev_charger `power`/`energy`, main meter live `energy`
 *                             → WindowAccountant → settleWindow (FR2)
 *   electric_vehicle reports  → evidence per candidate → attribute() after the
 *                               grace period (FR3); driving legs (FR5)
 *
 * Every session is saved at each change, so a restart loses at most the
 * window in progress. Handlers never throw on the bus.
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
import type { EvChargeSession, EvVehicleMonthSummary, TariffPrices } from "../../shared/types.js";
import type { TariffClassifier } from "../tariff-classifier.js";
import {
  type AttributionResult,
  attribute,
  emptyEvidence,
  foldReport,
  type ReportAlias,
  type VehicleEvidence,
} from "./attribution.js";
import { onBattery, onCharging, onMileage } from "./driving.js";
import { type EvSessionStore, type SessionRecord, toSession } from "./ev-session-store.js";
import { monthSummary, whPerBatteryPoint } from "./summary.js";
import { WindowAccountant, type WindowMeasure, settleWindow } from "./window-accountant.js";

export const GRACE_MS = 2 * 3_600_000;
export const MIN_SESSION_WH = 100;
const TICK_MS = 30_000;

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
]);

/** SQLite timestamps use a space (`2026-11-01 10:49:35Z`); ISO uses a `T`. */
function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
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
}

export class EvSessionTracker {
  private readonly logger: Logger;
  private readonly open = new Map<string, OpenSession>();
  private readonly pending = new Map<string, SessionRecord>();
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
      for (const s of this.open.values()) this.settle(s, s.acc.advance(now), true);
      // Spec 193 — a metered session ends 30 min after its last active reading,
      // dated at that reading.
      for (const [chargerId, s] of [...this.open]) {
        if (s.metered && now - s.lastActiveMs >= METERED_SESSION_END_MS) {
          this.close(chargerId, now, s.lastActiveMs);
        }
      }
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
    this.pending.delete(record.id);
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
      });
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
    for (const record of this.store.listPending()) this.pending.set(record.id, record);

    // A charger already plugged (first start, or a missed event) opens now;
    // a metered one already drawing too (spec 193).
    for (const eq of this.equipmentManager.getAll()) {
      if (eq.type !== "ev_charger" || !eq.enabled || this.open.has(eq.id)) continue;
      if (this.chargerIsMetered(eq.id)) {
        const power = this.chargerNumber(eq.id, EV_CHARGER_ALIASES.power);
        if (power !== null && power >= METERED_CHARGER_THRESHOLD_W) {
          this.openSession(eq.id, eq.name, now);
        }
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
    });
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
    this.settle(s, s.acc.finish(now), false);

    const record = s.record;
    const endedAt = Math.max(Date.parse(record.startedAt), Math.min(endedAtMs, now));
    record.endedAt = new Date(endedAt).toISOString();
    record.graceUntil = new Date(endedAt + GRACE_MS).toISOString();

    if (toSession(record).energyWh < MIN_SESSION_WH) {
      this.store.delete(record.id);
      this.eventBus.emit({
        type: "energy.ev_session.deleted",
        sessionId: record.id,
        chargerId: record.chargerId,
      });
      this.logger.info({ sessionId: record.id }, "EV charge session dropped (under 100 Wh)");
      return;
    }
    if (record.attributionSource !== "manual") this.pending.set(record.id, record);
    this.persist(record);
    this.logger.info(
      { sessionId: record.id, chargerId, energyWh: Math.round(toSession(record).energyWh) },
      "EV charge session closed",
    );
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
    record.batteryStart = evidence?.firstBattery ?? null;
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
      for (const s of this.open.values()) this.settle(s, s.acc.grid(now, value), true);
    } else if (eq.type === "electric_vehicle") {
      if (REPORT_ALIASES.has(alias) || alias === ELECTRIC_VEHICLE_ALIASES.mileage) {
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
      // Spec 193 — a metered charger opens on its power.
      if (active && enabled && !this.open.has(chargerId) && this.chargerIsMetered(chargerId)) {
        this.openSession(chargerId, chargerName, now);
      }
      const open = this.open.get(chargerId);
      if (!open) return;
      if (open.metered && active) open.lastActiveMs = now;
      this.settle(open, open.acc.power(now, value), true);
      return;
    }
    const s = this.open.get(chargerId);
    if (!s) return;
    if (alias === EV_CHARGER_ALIASES.power) {
      return;
    } else if (alias === EV_CHARGER_ALIASES.energy) {
      if (!s.hasEnergyMeter || typeof value !== "number") return;
      if (value > 0) s.record.energyWh += value;
      this.settle(s, s.acc.carEnergy(now, value), true);
    } else if (CHARGER_ALIASES.has(alias)) {
      s.acc.chargerReport(now);
    }
  }

  private onVehicle(vehicleId: string, alias: string, value: unknown, receivedAtMs: number): void {
    if (REPORT_ALIASES.has(alias)) {
      const reportedAtMs = this.vehicleReportedAt(vehicleId, alias);
      const report = { alias: alias as ReportAlias, value, reportedAtMs, receivedAtMs };
      for (const s of this.open.values()) this.foldInto(s.record, vehicleId, report, null);
      for (const record of this.pending.values()) {
        this.foldInto(record, vehicleId, report, Date.parse(record.endedAt!));
      }
    }
    this.advanceLeg(vehicleId, alias, value, receivedAtMs);
  }

  private foldInto(
    record: SessionRecord,
    vehicleId: string,
    report: Parameters<typeof foldReport>[1],
    endMs: number | null,
  ): void {
    const index = record.evidence.findIndex((e) => e.vehicleId === vehicleId);
    const before: VehicleEvidence = index >= 0 ? record.evidence[index] : emptyEvidence(vehicleId);
    const after = foldReport(before, report, { startMs: Date.parse(record.startedAt), endMs });
    if (after === before) return;
    if (index >= 0) record.evidence[index] = after;
    else record.evidence.push(after);
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

  /** Price closed windows into the session; `save` when it stays open. */
  private settle(s: OpenSession, windows: WindowMeasure[], save: boolean): void {
    if (windows.length === 0) return;
    const hasMainMeter = this.equipmentManager
      .getAll()
      .some((e) => e.type === "main_energy_meter" && e.enabled);
    const prices = this.prices();
    const r = s.record;
    for (const w of windows) {
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
    if (save) this.persist(r);
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
   * charger's usual vehicle to break a tie.
   */
  private resolve(record: SessionRecord): AttributionResult {
    return attribute(record.evidence, this.candidateVehicleIds(), {
      usualVehicleId: this.usualVehicleOf(record.chargerId),
      excluded: this.takenElsewhere(record),
    });
  }

  /** The car a session gives, without P4 (no cycle): set, or its provisional result. */
  private givenBy(record: SessionRecord): string | null {
    if (record.attribution === "vehicle") return record.vehicleId;
    if (record.attribution !== "pending" || record.attributionSource === "manual") return null;
    const result = attribute(record.evidence, this.candidateVehicleIds(), {
      usualVehicleId: this.usualVehicleOf(record.chargerId),
    });
    return result.state === "vehicle" ? result.vehicleId : null;
  }

  /** Cars given by sessions on other chargers whose time range meets this one. */
  private takenElsewhere(record: SessionRecord): Set<string> {
    const from = record.startedAt;
    const to = record.endedAt;
    const overlaps = (other: SessionRecord) =>
      other.chargerId !== record.chargerId &&
      (to === null || other.startedAt < to) &&
      (other.endedAt === null || other.endedAt > from);
    const others = new Map<string, SessionRecord>();
    for (const r of this.store.listAttributedOverlapping(record.chargerId, from, to)) {
      others.set(r.id, r);
    }
    for (const r of this.liveRecords()) if (overlaps(r)) others.set(r.id, r);
    const taken = new Set<string>();
    for (const other of others.values()) {
      const vehicleId = this.givenBy(other);
      if (vehicleId !== null) taken.add(vehicleId);
    }
    return taken;
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
   * last changed (the drop), never before the session started.
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

  private chargerNumber(chargerId: string, alias: string): number | null {
    const binding = this.equipmentManager
      .getDataBindingsWithValues(chargerId)
      .find((b) => b.alias === alias);
    return typeof binding?.value === "number" && Number.isFinite(binding.value)
      ? binding.value
      : null;
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
