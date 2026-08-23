/**
 * Spec 158 — daily rollup of the arbiter's own behaviour.
 *
 * Pure: no database, no clock, no I/O. Everything the computation needs is
 * passed in, which is what makes every scenario in the spec directly testable.
 *
 * The state a load is in at any instant is derived with `sustainedAfter()`,
 * the SAME function the timeline paints with (spec 148). One definition of
 * "granted" / "pending" / "unmanaged" in the codebase, not two: a metric that
 * disagreed with the ribbon the user is looking at would be worse than no
 * metric at all.
 */

import type { ArbiterDecision } from "../shared/types.js";
import type { SurplusSample } from "./arbiter-surplus-store.js";
import { sustainedAfter, type QuarterState } from "./arbiter-timeline.js";

/** Cadence of the persisted surplus series (spec 148 writes one per 5 min). */
export const SURPLUS_SAMPLE_S = 300;

export interface RollupLoad {
  equipmentId: string;
  /** Anti-short-cycle floor from the energy profile. */
  minOnS: number;
  /** `nominalPowerW + engageMarginW - toleratedImportW` — the surplus the load
   *  is actually engaged against. */
  needW: number;
}

export interface RollupInput {
  /** Local midnight of the day being rolled up. */
  dayStartMs: number;
  /**
   * End of the accounted window. The caller clamps it to `now` for the current
   * day, so a load granted right now is not counted as granted until midnight.
   * Today's row is therefore partial by construction, and the first tick after
   * midnight completes it.
   */
  dayEndMs: number;
  /**
   * Decisions covering the day PLUS a lookback (entering state) and a small
   * lookahead (a grant late in the day revoked just after midnight is still
   * that day's short cycle). Ascending, ids required for load attribution.
   */
  decisions: ArbiterDecision[];
  surplus: SurplusSample[];
  loads: RollupLoad[];
  /** Arbiter config: how long a deficit must hold before it revokes. */
  releaseHoldS: number;
  /**
   * Arbiter config: the TTL of a manual-override suspension. Used to bound a
   * suspension whose closing event never made it to the journal (see
   * `boundOpenSuspensions`).
   */
  overrideTtlS: number;
}

export interface LoadMetricRow {
  equipmentId: string;
  grants: number;
  revokes: number;
  shortCycles: number;
  grantedS: number;
  pendingS: number;
  unmanagedS: number;
  suspendedS: number;
}

export interface HomeMetricRow {
  exportWh: number;
  importWh: number;
  idleClaimableExportWh: number;
  samples: number;
}

export interface RollupResult {
  loads: LoadMetricRow[];
  home: HomeMetricRow;
}

interface LoadEvent {
  at: number;
  kind: ArbiterDecision["kind"];
  running?: boolean;
  /** Carried for short-cycle attribution (a `CapacityRevokeReason` on revokes). */
  reason?: string;
}

function emptyRow(equipmentId: string): LoadMetricRow {
  return {
    equipmentId,
    grants: 0,
    revokes: 0,
    shortCycles: 0,
    grantedS: 0,
    pendingS: 0,
    unmanagedS: 0,
    suspendedS: 0,
  };
}

/**
 * A revocation event, for COUNTING purposes. Deliberately narrower than the
 * timeline's notion of a revoke:
 *
 * - `released` is the recipe giving the surplus back on its own, not the
 *   arbiter taking it away.
 * - `revoke-not-honored` is NOT a second revocation. The arbiter journals it
 *   on top of the `revoked` it already wrote, when the load did not actually
 *   stop (capacity-arbiter `revoke()` pushes the watchdog, the watchdog
 *   journals the follow-up). Counting both reports two revocations for one.
 *   The timeline can lump them together because painting a quarter red twice
 *   is idempotent; a counter is not.
 */
function isRevoke(kind: ArbiterDecision["kind"]): boolean {
  return kind === "revoked";
}

/** Group decisions by equipment, chronological, ignoring home-level entries. */
function eventsByEquipment(decisions: ArbiterDecision[]): Map<string, LoadEvent[]> {
  const byEq = new Map<string, LoadEvent[]>();
  for (const d of decisions) {
    if (!d.equipmentId) continue;
    const at = Date.parse(d.atIso);
    if (Number.isNaN(at)) continue;
    let list = byEq.get(d.equipmentId);
    if (!list) byEq.set(d.equipmentId, (list = []));
    list.push({ at, kind: d.kind, running: d.running, reason: d.reason });
  }
  for (const list of byEq.values()) list.sort((a, b) => a.at - b.at);
  return byEq;
}

/**
 * A suspension can be left open in the journal, and then runs forever.
 *
 * `overridesUntil` is in-memory only: a restart drops every suspension without
 * journaling anything, and the arbiter's startup reconciliation
 * (`closeStaleClaimTails`) only closes tails whose sustained state is
 * `granted` or `pending` — never a suspension, which reads as `unmanaged` or
 * `idle`. The TTL expiry is journaled only while the arbiter is enabled.
 *
 * Left alone, a manual override at 18:00 followed by a container restart at
 * 18:30 bills the rest of the day AND, through the 48 h lookback, the whole of
 * the next one. So a suspension with no state-changing event within its own
 * TTL is closed at the TTL, which is exactly what the arbiter would have done
 * had it stayed up.
 */
function boundOpenSuspensions(events: LoadEvent[], overrideTtlS: number): LoadEvent[] {
  if (overrideTtlS <= 0) return events;
  const ttlMs = overrideTtlS * 1000;
  const out: LoadEvent[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    out.push(e);
    if (e.kind !== "suspended") continue;
    const expiry = e.at + ttlMs;
    // Any later state transition inside the TTL closes the suspension on its
    // own — injecting an expiry then would wrongly cut short a real grant.
    let covered = false;
    for (let j = i + 1; j < events.length && events[j].at <= expiry; j += 1) {
      if (sustainedAfter(events[j].kind, events[j].running)) {
        covered = true;
        break;
      }
    }
    if (!covered) out.push({ at: expiry, kind: "resumed", running: false });
  }
  return out;
}

/**
 * Walk one load's events and accumulate the time spent in each sustained
 * state over [dayStartMs, dayEndMs). Events outside the window still matter:
 * those before it establish the entering state, those after it are only used
 * for short-cycle detection by the caller.
 */
function accumulateSpans(
  events: LoadEvent[],
  dayStartMs: number,
  dayEndMs: number,
  row: LoadMetricRow,
): void {
  const add = (state: QuarterState, ms: number): void => {
    if (ms <= 0) return;
    const s = Math.round(ms / 1000);
    switch (state) {
      case "granted":
        row.grantedS += s;
        break;
      case "pending":
        row.pendingS += s;
        break;
      case "unmanaged":
        row.unmanagedS += s;
        break;
      // "revoked" is a marker the timeline paints on a quarter that contains a
      // revoke; as a sustained state it is idle, and idle time is not counted.
      default:
        break;
    }
  };

  let sustained: QuarterState = "idle";
  let idx = 0;
  // Entering state: replay everything strictly before the window.
  while (idx < events.length && events[idx].at < dayStartMs) {
    const next = sustainedAfter(events[idx].kind, events[idx].running);
    if (next) sustained = next;
    idx += 1;
  }

  let cursor = dayStartMs;
  for (; idx < events.length && events[idx].at < dayEndMs; idx += 1) {
    const next = sustainedAfter(events[idx].kind, events[idx].running);
    if (!next) continue; // audit-only event, the sustained state is unchanged
    add(sustained, events[idx].at - cursor);
    cursor = events[idx].at;
    sustained = next;
  }
  add(sustained, dayEndMs - cursor);
}

/**
 * Suspended seconds are tracked separately from the sustained state: a
 * suspension that leaves the load running paints "unmanaged", one that leaves
 * it off paints "idle", but both are time the arbiter was not in control and
 * that is worth its own figure.
 */
function accumulateSuspended(
  events: LoadEvent[],
  dayStartMs: number,
  dayEndMs: number,
  row: LoadMetricRow,
): void {
  // A suspension ends on `resumed` / `reset`, but ALSO on any other state
  // transition: the arbiter cannot grant, deny or revoke a suspended load
  // (`claim()` denies with `override-active`), so seeing one of those proves
  // the suspension is over. After a restart drops `overridesUntil` silently,
  // the next grant is the only evidence there is.
  const closes = (e: LoadEvent): boolean =>
    e.kind !== "suspended" && sustainedAfter(e.kind, e.running) !== null;

  let suspended = false;
  let since = dayStartMs;
  let idx = 0;
  while (idx < events.length && events[idx].at < dayStartMs) {
    if (events[idx].kind === "suspended") suspended = true;
    else if (closes(events[idx])) suspended = false;
    idx += 1;
  }
  for (; idx < events.length && events[idx].at < dayEndMs; idx += 1) {
    const e = events[idx];
    if (e.kind === "suspended") {
      if (!suspended) {
        suspended = true;
        since = e.at;
      }
    } else if (closes(e) && suspended) {
      row.suspendedS += Math.round((e.at - since) / 1000);
      suspended = false;
    }
  }
  if (suspended) row.suspendedS += Math.round((dayEndMs - since) / 1000);
}

/**
 * Monotonic cursor over one load's events, used to answer "what state was this
 * load in at instant X" for a series of ascending X without rescanning.
 *
 * Deliberately not a rescan per sample: a day that flapped can hold thousands
 * of decisions, and a naive lookup would be samples x loads x decisions, i.e.
 * tens of millions of iterations on exactly the pathological day this rollup
 * exists to measure.
 */
class StateCursor {
  private idx = 0;
  private sustained: QuarterState = "idle";

  constructor(private readonly events: LoadEvent[]) {}

  /** State at `at`. Callers MUST pass ascending instants. */
  advanceTo(at: number): QuarterState {
    while (this.idx < this.events.length && this.events[this.idx].at <= at) {
      const next = sustainedAfter(this.events[this.idx].kind, this.events[this.idx].running);
      if (next) this.sustained = next;
      this.idx += 1;
    }
    return this.sustained;
  }
}

export function rollupDay(input: RollupInput): RollupResult {
  const { dayStartMs, dayEndMs, decisions, surplus, loads, releaseHoldS, overrideTtlS } = input;
  const byEq = eventsByEquipment(decisions);

  const rows: LoadMetricRow[] = loads.map((load) => {
    const events = boundOpenSuspensions(byEq.get(load.equipmentId) ?? [], overrideTtlS);
    const row = emptyRow(load.equipmentId);

    for (const e of events) {
      if (e.at < dayStartMs || e.at >= dayEndMs) continue;
      if (e.kind === "granted") row.grants += 1;
      else if (isRevoke(e.kind)) row.revokes += 1;
    }

    // Short cycle: a grant whose next revoke lands inside the load's own
    // anti-short-cycle floor plus the deficit hold. The revoke is looked up
    // across the whole event list, so a grant at 23:58 revoked at 00:03 is
    // still counted against the day it started on.
    //
    // Only a `surplus-deficit` revoke counts. The metric means "the load
    // started on a surplus that did not hold", and the other reasons are not
    // that: `manual-override` is the user touching the equipment,
    // `meter-stale` and `disabled` are the arbiter standing down, and
    // `priority-preempted` is a deliberate arbitration decision, not a
    // misjudged engage. Without this gate a user flipping a wall switch five
    // minutes after a grant would be recorded as arbiter regret.
    const shortCycleMs = (load.minOnS + releaseHoldS) * 1000;
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      if (e.kind !== "granted") continue;
      if (e.at < dayStartMs || e.at >= dayEndMs) continue;
      for (let j = i + 1; j < events.length; j += 1) {
        const next = events[j];
        if (next.kind === "granted") break; // re-granted without a revoke in between
        if (!isRevoke(next.kind)) continue;
        if (next.at - e.at < shortCycleMs && next.reason === "surplus-deficit") {
          row.shortCycles += 1;
        }
        break;
      }
    }

    accumulateSpans(events, dayStartMs, dayEndMs, row);
    accumulateSuspended(events, dayStartMs, dayEndMs, row);
    return row;
  });

  // ── Home level ──────────────────────────────────────────────
  const home: HomeMetricRow = {
    exportWh: 0,
    importWh: 0,
    idleClaimableExportWh: 0,
    samples: 0,
  };
  const hours = SURPLUS_SAMPLE_S / 3600;
  // One cursor per load, advanced monotonically with the (ascending) samples.
  const ordered = [...surplus].sort((a, b) => a.at - b.at);
  const cursors = loads.map((load) => ({
    needW: load.needW,
    cursor: new StateCursor(boundOpenSuspensions(byEq.get(load.equipmentId) ?? [], overrideTtlS)),
  }));

  for (const sample of ordered) {
    if (sample.at < dayStartMs || sample.at >= dayEndMs) continue;
    home.samples += 1;
    if (sample.availableW > 0) {
      home.exportWh += sample.availableW * hours;
      // Missed opportunity: some declared load was NOT drawing (idle, or still
      // waiting for its engage hold) while the surplus already covered what it
      // needs. "unmanaged" is excluded — the load IS running, just not under
      // arbitration, so the surplus was not wasted on it.
      let missed = false;
      for (const { needW, cursor } of cursors) {
        // advanceTo catches up from wherever the cursor stands, so skipping
        // importing samples costs nothing but a longer catch-up.
        const state = cursor.advanceTo(sample.at);
        if (needW <= sample.availableW && state !== "granted" && state !== "unmanaged") {
          missed = true;
        }
      }
      if (missed) home.idleClaimableExportWh += sample.availableW * hours;
    } else {
      home.importWh += -sample.availableW * hours;
    }
  }
  home.exportWh = Math.round(home.exportWh * 10) / 10;
  home.importWh = Math.round(home.importWh * 10) / 10;
  home.idleClaimableExportWh = Math.round(home.idleClaimableExportWh * 10) / 10;

  return { loads: rows, home };
}
