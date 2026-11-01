/**
 * Spec 191 FR3 — which vehicle charged during a session.
 *
 * Pure. The tracker folds every vehicle report into one `VehicleEvidence` per
 * candidate, then calls `attribute()` once the grace period is over. Sowel
 * attributes only when it is sure (P7): one candidate matches, or only one
 * vehicle exists. Anything else is left "to attribute".
 *
 * A report counts only when the car says it was made during the session: its
 * `reported_at` (the time the car itself reported, which may reach Sowel much
 * later) when it has one, else the time Sowel received it. The grace period
 * after the unplug exists for those late reports.
 */

import type { EvSessionAttributionReason } from "../../shared/types.js";

/** A battery rise smaller than this is jitter, not a charge. */
export const BATTERY_RISE_POINTS = 2;

/**
 * Issue #1105 — how long before the session's start a car's « plugged » or
 * « charging » may still count. The car dates its report from the real start;
 * Sowel opens the session on the charger's own reading (a metered charger's
 * first 500 W), which can come later. The tracker shortens it to the end of
 * any other session that time falls in: a report made during another session
 * belongs to that one.
 */
export const START_SLACK_MS = 15 * 60_000;

/**
 * Audit A4 — a car's final battery level is often reported a few minutes after
 * its charge stopped: a battery report up to this long after the session's end
 * still raises its highest level (never its first, never a match on its own
 * without a level during or just before the session).
 */
export const END_SLACK_MS = 15 * 60_000;

export interface VehicleEvidence {
  vehicleId: string;
  pluggedSeen: boolean;
  chargingSeen: boolean;
  awaySeen: boolean;
  firstBattery: number | null;
  maxBattery: number | null;
  /**
   * Audit A4 — the latest level the car reported just before the session
   * (within the start slack): its level at the real start. Absent on sessions
   * saved before it existed.
   */
  baseBattery?: number | null;
  baseBatteryAtMs?: number | null;
  /**
   * Audit A5 — the car's last known location said away when the session
   * opened. It does not match until a report during the session says it is
   * home: a car charging elsewhere must not take a session at home.
   */
  awayAtStart?: boolean;
  homeSeen?: boolean;
  /**
   * From when this car's reports made before the session count, fixed when
   * the session opened (issue #1105, audit A6): what went on just before the
   * opening decides it, not what other sessions learn later.
   */
  slackFromMs?: number;
  /** When the car was first seen charging in this session (epoch ms). */
  firstChargingAtMs?: number | null;
}

export function emptyEvidence(vehicleId: string): VehicleEvidence {
  return {
    vehicleId,
    pluggedSeen: false,
    chargingSeen: false,
    awaySeen: false,
    firstBattery: null,
    maxBattery: null,
  };
}

export type ReportAlias = "plugged" | "charging_state" | "battery_level" | "at_home";

export interface VehicleReport {
  alias: ReportAlias;
  value: unknown;
  /** The car's own report time (`reported_at`), epoch ms; null when it has none. */
  reportedAtMs: number | null;
  /** When Sowel received it, epoch ms. */
  receivedAtMs: number;
}

/**
 * Fold one report into the evidence. A report counts when the car made it
 * during the session, with these exceptions:
 * - a « plugged », a « charging » or a battery level made from
 *   `positiveFromMs` (at most START_SLACK_MS before the start, never inside
 *   another session holding this car; set by the tracker) counts too: the car
 *   dates it from the real start, the session may open later (issue #1105). A
 *   level made before the start is the session's starting level (audit A4);
 * - a battery level up to END_SLACK_MS after the end raises the highest level
 *   (audit A4).
 * Being away keeps the strict window: a car that comes home and plugs in within
 * the slack is not seen away. Returns the same object when the report adds
 * nothing.
 */
export function foldReport(
  evidence: VehicleEvidence,
  report: VehicleReport,
  session: { startMs: number; endMs: number | null; positiveFromMs?: number },
): VehicleEvidence {
  const at = report.reportedAtMs ?? report.receivedAtMs;
  const from = Math.min(session.startMs, session.positiveFromMs ?? session.startMs);
  const beforeStart = at < session.startMs;
  const afterEnd = session.endMs !== null && at > session.endMs;
  if (at < from) return evidence;

  const next = { ...evidence };
  switch (report.alias) {
    case "plugged":
      if (report.value === true && !afterEnd) next.pluggedSeen = true;
      break;
    case "charging_state":
      if (report.value === "charging" && !afterEnd) {
        next.chargingSeen = true;
        if (next.firstChargingAtMs == null || at < next.firstChargingAtMs) {
          next.firstChargingAtMs = at;
        }
      }
      break;
    case "battery_level": {
      const level = typeof report.value === "number" ? report.value : Number.NaN;
      if (!Number.isFinite(level)) break;
      if (beforeStart) {
        if (next.baseBatteryAtMs == null || at >= next.baseBatteryAtMs) {
          next.baseBattery = level;
          next.baseBatteryAtMs = at;
        }
      } else if (afterEnd) {
        const known = next.firstBattery !== null || next.baseBattery != null;
        if (known && at <= session.endMs! + END_SLACK_MS) {
          next.maxBattery = next.maxBattery === null ? level : Math.max(next.maxBattery, level);
        }
      } else {
        if (next.firstBattery === null) next.firstBattery = level;
        next.maxBattery = next.maxBattery === null ? level : Math.max(next.maxBattery, level);
      }
      break;
    }
    case "at_home":
      if (beforeStart) break;
      // Home just after the end still says it was home (a location poll lags);
      // away just after the end says nothing (it may have left).
      if (afterEnd) {
        if (report.value === true && at <= session.endMs! + END_SLACK_MS) next.homeSeen = true;
        break;
      }
      if (report.value === false) next.awaySeen = true;
      if (report.value === true) next.homeSeen = true;
      break;
  }
  // The same object when nothing changed: the tracker saves and emits only on a change.
  const changed = (Object.keys(next) as (keyof VehicleEvidence)[]).some(
    (k) => next[k] !== evidence[k],
  );
  return changed ? next : evidence;
}

/** The level when the charge started: just before the session, else its first (audit A4). */
export function startBattery(evidence: VehicleEvidence): number | null {
  return evidence.baseBattery ?? evidence.firstBattery;
}

export function batteryRise(evidence: VehicleEvidence): number {
  const start = startBattery(evidence);
  if (start === null || evidence.maxBattery === null) return 0;
  return evidence.maxBattery - start;
}

/** Charged during the session, whatever the location (audit A6: a car this session holds). */
export function charged(evidence: VehicleEvidence): boolean {
  return evidence.chargingSeen || batteryRise(evidence) >= BATTERY_RISE_POINTS;
}

/**
 * Charged during the session and not seen away. An unplug report is no
 * evidence against a car: the car stamps its own unplug, often before the
 * charger reports it, so it falls inside the session of the very car that
 * charged. Being seen plugged is not required either: a car whose plug state
 * did not change during the session reports nothing about it. A car whose
 * last known location was away when the session opened must be seen home
 * during it (audit A5).
 */
export function matches(evidence: VehicleEvidence): boolean {
  if (evidence.awaySeen) return false;
  if (evidence.awayAtStart && !evidence.homeSeen) return false;
  return charged(evidence);
}

export type AttributionResult =
  | { state: "vehicle"; vehicleId: string; reason: EvSessionAttributionReason }
  | { state: "unattributed"; reason: EvSessionAttributionReason };

/** What a charger adds to the decision (spec 193). */
export interface AttributionContext {
  /** The charger's usual vehicle: only breaks a tie between matching cars. */
  usualVehicleId?: string | null;
  /** Cars an overlapping session on another charger gives: not candidates here. */
  excluded?: ReadonlySet<string>;
}

/**
 * Decide at the end of the grace period. `vehicleIds` are every vehicle Sowel
 * knows (P9: all of them are candidates on every charger), minus the cars
 * charging elsewhere at the same time (spec 193 P4). The charger's usual
 * vehicle only breaks a tie between several matching cars.
 */
export function attribute(
  evidence: VehicleEvidence[],
  vehicleIds: string[],
  context: AttributionContext = {},
): AttributionResult {
  const excluded = context.excluded ?? new Set<string>();
  const usual = context.usualVehicleId ?? null;
  const known = new Set(vehicleIds.filter((id) => !excluded.has(id)));
  const relevant = evidence.filter((e) => known.has(e.vehicleId));
  const matching = relevant.filter(matches);
  if (matching.length === 1) {
    return { state: "vehicle", vehicleId: matching[0].vehicleId, reason: "single-match" };
  }
  if (matching.length > 1) {
    if (usual !== null && matching.some((e) => e.vehicleId === usual)) {
      return { state: "vehicle", vehicleId: usual, reason: "usual-vehicle" };
    }
    return { state: "unattributed", reason: "several-matches" };
  }

  // "The only vehicle" means the only one Sowel knows, not the only one left
  // once the others are charging elsewhere.
  if (vehicleIds.length === 1 && known.has(vehicleIds[0])) {
    const only =
      relevant.find((e) => e.vehicleId === vehicleIds[0]) ?? emptyEvidence(vehicleIds[0]);
    if (!only.awaySeen) {
      return { state: "vehicle", vehicleId: only.vehicleId, reason: "only-vehicle" };
    }
  }
  return { state: "unattributed", reason: "no-match" };
}
