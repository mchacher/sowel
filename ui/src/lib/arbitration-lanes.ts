import type { ArbiterPublicState } from "../types";

/**
 * Spec 140 / FR-10 — rebuild today's timeline lanes from the arbiter's
 * decision journal (newest-first in the API, walked oldest-first here).
 */

export interface LaneSegment {
  startMin: number;
  endMin: number;
  kind: "granted" | "manual";
}

export interface LaneMarker {
  min: number;
  kind: "revoked" | "unclaimed-run";
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
          markers.push({ min, kind: "unclaimed-run", label: entry.reason ?? "" });
          break;
        default:
          break;
      }
    }
    if (openGrant !== null) segments.push({ startMin: openGrant, endMin: nowMin, kind: "granted" });
    if (openManual !== null) segments.push({ startMin: openManual, endMin: nowMin, kind: "manual" });
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
