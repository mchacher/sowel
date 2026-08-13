import type { ArbiterPublicState } from "../types";

/**
 * Spec 140 / FR-10 — rebuild today's timeline lanes from the arbiter's
 * decision journal (newest-first in the API, walked oldest-first here).
 */

export interface LaneSegment {
  startMin: number;
  endMin: number;
  /**
   * `unclaimed` is a run the arbiter watched but did not grant — a recipe's
   * must-run fallback (off-peak, hot-water floor). It is a span, not a point:
   * how long a load held power outside arbitration is the whole question, and
   * a start marker alone cannot answer it.
   */
  kind: "granted" | "manual" | "unclaimed";
  /** True while the span has no recorded end and is drawn up to now. */
  open?: boolean;
}

export interface LaneMarker {
  min: number;
  kind: "revoked";
  label: string;
}

export interface Lane {
  equipmentId: string;
  name: string;
  segments: LaneSegment[];
  markers: LaneMarker[];
  pendingFromMin: number | null;
}

export function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function buildLanes(
  state: ArbiterPublicState,
  profiled: Array<{ id: string; name: string }>,
  nowMin: number,
): Lane[] {
  const todays = [...state.journal].reverse().filter((j) => isToday(j.atIso));
  return profiled.map(({ id, name }) => {
    const segments: LaneSegment[] = [];
    const markers: LaneMarker[] = [];
    let openGrant: number | null = null;
    let openManual: number | null = null;
    let openUnclaimed: number | null = null;
    for (const entry of todays) {
      if (entry.equipmentId !== id) continue;
      const min = minuteOfDay(entry.atIso);
      switch (entry.kind) {
        case "granted":
          openGrant ??= min;
          break;
        case "revoked":
          if (openGrant !== null) {
            segments.push({ startMin: openGrant, endMin: min, kind: "granted" });
            openGrant = null;
          }
          markers.push({ min, kind: "revoked", label: entry.reason ?? "" });
          break;
        case "released":
          if (openGrant !== null) {
            segments.push({ startMin: openGrant, endMin: min, kind: "granted" });
            openGrant = null;
          }
          break;
        case "suspended":
          openManual ??= min;
          break;
        case "resumed":
          if (openManual !== null) {
            segments.push({ startMin: openManual, endMin: min, kind: "manual" });
            openManual = null;
          }
          break;
        case "unclaimed-run":
          openUnclaimed ??= min;
          break;
        case "unclaimed-run-ended":
          if (openUnclaimed !== null) {
            segments.push({ startMin: openUnclaimed, endMin: min, kind: "unclaimed" });
            openUnclaimed = null;
          }
          break;
        default:
          break;
      }
    }
    if (openGrant !== null)
      segments.push({ startMin: openGrant, endMin: nowMin, kind: "granted", open: true });
    if (openManual !== null)
      segments.push({ startMin: openManual, endMin: nowMin, kind: "manual", open: true });
    // Cores older than this field, and runs still going, land here: drawn up to
    // now, which is the honest reading of "started and never reported an end".
    if (openUnclaimed !== null)
      segments.push({ startMin: openUnclaimed, endMin: nowMin, kind: "unclaimed", open: true });
    const pending = state.pending.find((p) => p.equipmentId === id);
    const lastEnd = segments.length > 0 ? segments[segments.length - 1].endMin : null;
    return {
      equipmentId: id,
      name,
      segments,
      markers,
      pendingFromMin: pending ? (lastEnd ?? Math.max(0, nowMin - 30)) : null,
    };
  });
}
