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

export interface VehicleEvidence {
  vehicleId: string;
  pluggedSeen: boolean;
  unpluggedSeen: boolean;
  chargingSeen: boolean;
  awaySeen: boolean;
  firstBattery: number | null;
  maxBattery: number | null;
}

export function emptyEvidence(vehicleId: string): VehicleEvidence {
  return {
    vehicleId,
    pluggedSeen: false,
    unpluggedSeen: false,
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

/** Fold one report into the evidence; reports made outside the session are ignored. */
export function foldReport(
  evidence: VehicleEvidence,
  report: VehicleReport,
  session: { startMs: number; endMs: number | null },
): VehicleEvidence {
  const at = report.reportedAtMs ?? report.receivedAtMs;
  if (at < session.startMs) return evidence;
  if (session.endMs !== null && at > session.endMs) return evidence;

  const next = { ...evidence };
  switch (report.alias) {
    case "plugged":
      if (report.value === true) next.pluggedSeen = true;
      if (report.value === false) next.unpluggedSeen = true;
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
  return next;
}

export function batteryRise(evidence: VehicleEvidence): number {
  if (evidence.firstBattery === null || evidence.maxBattery === null) return 0;
  return evidence.maxBattery - evidence.firstBattery;
}

/** Charged during the session, at home, and never said it was unplugged. */
export function matches(evidence: VehicleEvidence): boolean {
  if (evidence.awaySeen || evidence.unpluggedSeen) return false;
  return evidence.chargingSeen || batteryRise(evidence) >= BATTERY_RISE_POINTS;
}

export type AttributionResult =
  | { state: "vehicle"; vehicleId: string; reason: EvSessionAttributionReason }
  | { state: "unattributed"; reason: EvSessionAttributionReason };

/**
 * Decide at the end of the grace period. `vehicleIds` are every vehicle Sowel
 * knows (P9: all of them are candidates on every charger).
 */
export function attribute(evidence: VehicleEvidence[], vehicleIds: string[]): AttributionResult {
  const known = new Set(vehicleIds);
  const relevant = evidence.filter((e) => known.has(e.vehicleId));
  const matching = relevant.filter(matches);
  if (matching.length === 1) {
    return { state: "vehicle", vehicleId: matching[0].vehicleId, reason: "single-match" };
  }
  if (matching.length > 1) return { state: "unattributed", reason: "several-matches" };

  if (vehicleIds.length === 1) {
    const only =
      relevant.find((e) => e.vehicleId === vehicleIds[0]) ?? emptyEvidence(vehicleIds[0]);
    if (!only.awaySeen && !only.unpluggedSeen) {
      return { state: "vehicle", vehicleId: only.vehicleId, reason: "only-vehicle" };
    }
  }
  return { state: "unattributed", reason: "no-match" };
}
