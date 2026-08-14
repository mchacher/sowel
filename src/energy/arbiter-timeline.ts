import type { ArbiterDecision } from "../shared/types.js";

// Spec 148 (Phase B) — reconstruct the per-load state timeline of the arbiter
// from its (persisted) decision journal, bucketed into fixed steps (15 min).
//
// Displayed ribbon state per quarter:
//   "granted"   — accordé (running on surplus)
//   "revoked"   — surplus retiré (a revoke happened in this quarter)
//   "unmanaged" — On (hors pilotage): manual override or unclaimed run
//   "idle"      — off / not managed
//
// Loads don't oscillate, so a quarter shows the *sustained* state at its end,
// except a quarter that contains a revoke is flagged "revoked" (red) even if the
// load ends idle — that's the notable event; the exact intra-quarter detail
// stays in the journal (the UI links a cell click to the journal).

export type QuarterState = "granted" | "revoked" | "unmanaged" | "idle";

export interface TimelineLoad {
  equipmentId: string;
  name: string;
  quarters: QuarterState[];
}

/** The sustained state a decision transitions a load into. */
function sustainedAfter(kind: ArbiterDecision["kind"]): QuarterState | null {
  switch (kind) {
    case "granted":
    case "resumed":
      return "granted";
    case "revoked":
    case "revoke-not-honored":
    case "released":
    case "denied":
    case "unclaimed-run-ended":
      return "idle";
    case "suspended":
    case "unclaimed-run":
      return "unmanaged";
    // Audit-only events emitted *while another state already holds* — NOT
    // transitions. `watts-divergence` fires on a still-granted claim; a load's
    // measured draw drifting must not repaint it from "accordé" to "hors
    // pilotage". `comfort-off-after-revoke` fires when a comfort load is
    // switched OFF after losing its grant — the load is off, so leaving the
    // preceding revoke→idle in place is correct, not "unmanaged". Both leave
    // the sustained state unchanged.
    default:
      return null; // non-state event (leaves the sustained state unchanged)
  }
}

function isRevoke(kind: ArbiterDecision["kind"]): boolean {
  return kind === "revoked" || kind === "revoke-not-honored";
}

/**
 * Build per-load quarter states over [windowStart, windowEnd) at `stepMin`.
 *
 * `decisions` should include some lookback BEFORE windowStart so the state
 * entering the window is known; entries with no `equipmentId` are ignored.
 */
export function buildLoadTimelines(
  decisions: ArbiterDecision[],
  loads: { equipmentId: string; name: string }[],
  windowStart: number,
  windowEnd: number,
  stepMin = 15,
): TimelineLoad[] {
  const stepMs = stepMin * 60_000;
  const nQuarters = Math.max(0, Math.round((windowEnd - windowStart) / stepMs));

  // Decisions per equipment, chronological.
  const byEq = new Map<string, { at: number; kind: ArbiterDecision["kind"] }[]>();
  for (const d of decisions) {
    if (!d.equipmentId) continue;
    const at = Date.parse(d.atIso);
    if (Number.isNaN(at)) continue;
    let list = byEq.get(d.equipmentId);
    if (!list) byEq.set(d.equipmentId, (list = []));
    list.push({ at, kind: d.kind });
  }
  for (const list of byEq.values()) list.sort((a, b) => a.at - b.at);

  return loads.map((load) => {
    const events = byEq.get(load.equipmentId) ?? [];
    const quarters: QuarterState[] = [];
    let idx = 0;
    let sustained: QuarterState = "idle";

    // Establish the state entering the window (events strictly before it).
    while (idx < events.length && events[idx].at < windowStart) {
      const s = sustainedAfter(events[idx].kind);
      if (s) sustained = s;
      idx += 1;
    }

    for (let q = 0; q < nQuarters; q += 1) {
      const qEnd = windowStart + (q + 1) * stepMs;
      let revokeHere = false;
      while (idx < events.length && events[idx].at < qEnd) {
        if (isRevoke(events[idx].kind)) revokeHere = true;
        const s = sustainedAfter(events[idx].kind);
        if (s) sustained = s;
        idx += 1;
      }
      quarters.push(revokeHere ? "revoked" : sustained);
    }

    return { equipmentId: load.equipmentId, name: load.name, quarters };
  });
}
