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

export interface VehicleEvidence {
  vehicleId: string;
  pluggedSeen: boolean;
  chargingSeen: boolean;
  awaySeen: boolean;
  firstBattery: number | null;
  maxBattery: number | null;
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

/** Evidence FOR a car: it may come slightly before the session (issue #1105). */
function isPositive(report: VehicleReport): boolean {
  return (
    (report.alias === "plugged" && report.value === true) ||
    (report.alias === "charging_state" && report.value === "charging")
  );
}

/**
 * Fold one report into the evidence; reports made outside the session are
 * ignored, except a « plugged » or « charging » made from `positiveFromMs`
 * (at most START_SLACK_MS before the start, set by the tracker; the start
 * when absent). Being away and the battery keep the strict window: a car
 * that comes home and plugs in within the slack is not seen away. Returns the
 * same object when the report adds nothing.
 */
export function foldReport(
  evidence: VehicleEvidence,
  report: VehicleReport,
  session: { startMs: number; endMs: number | null; positiveFromMs?: number },
): VehicleEvidence {
  const at = report.reportedAtMs ?? report.receivedAtMs;
  const from = isPositive(report)
    ? Math.min(session.startMs, session.positiveFromMs ?? session.startMs)
    : session.startMs;
  if (at < from) return evidence;
  if (session.endMs !== null && at > session.endMs) return evidence;

  const next = { ...evidence };
  switch (report.alias) {
    case "plugged":
      if (report.value === true) next.pluggedSeen = true;
      break;
    case "charging_state":
      if (report.value === "charging") next.chargingSeen = true;
      break;
    case "battery_level": {
      const level = typeof report.value === "number" ? report.value : Number.NaN;
      if (!Number.isFinite(level)) break;
      if (next.firstBattery === null) next.firstBattery = level;
      next.maxBattery = next.maxBattery === null ? level : Math.max(next.maxBattery, level);
      break;
    }
    case "at_home":
      if (report.value === false) next.awaySeen = true;
      break;
  }
  // The same object when nothing changed: the tracker saves and emits only on a change.
  const changed = (Object.keys(next) as (keyof VehicleEvidence)[]).some(
    (k) => next[k] !== evidence[k],
  );
  return changed ? next : evidence;
}

export function batteryRise(evidence: VehicleEvidence): number {
  if (evidence.firstBattery === null || evidence.maxBattery === null) return 0;
  return evidence.maxBattery - evidence.firstBattery;
}

/**
 * Charged during the session and never seen away. An unplug report is no
 * evidence against a car: the car stamps its own unplug, often before the
 * charger reports it, so it falls inside the session of the very car that
 * charged. Being seen plugged is not required either: a car whose plug state
 * did not change during the session reports nothing about it.
 */
export function matches(evidence: VehicleEvidence): boolean {
  if (evidence.awaySeen) return false;
  return evidence.chargingSeen || batteryRise(evidence) >= BATTERY_RISE_POINTS;
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
