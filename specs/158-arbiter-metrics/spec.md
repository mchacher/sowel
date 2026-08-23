# Spec 158 — Arbiter baseline metrics

- **Status**: IMPLEMENTED (unreleased) — real-data verification pending
- **Date**: 2026-08-23
- **Related**: spec 140 (energy capacity arbiter), spec 147 (decision journal persistence), spec 148 (timeline + surplus persistence), spec 061 (local midnight / TZ), issue #618 (hour-aligned rollover timer)
- **Roadmap**: phase 0 of `docs/planning/2026-08-23-arbiter-predictive.md`. Everything else in that roadmap (adaptive hysteresis, richer load learning, hourly irradiance, PV forecast, predictive engage gate, daily planner) is out of scope and will be specified separately, on top of the instrumentation this spec builds.

## Problem

The capacity arbiter (spec 140) takes every decision on the instantaneous EMA
of the grid meter, with fixed hysteresis and a static priority list. Whether
those fixed constants are well chosen is unknown, because **nothing measures
the arbiter's own behaviour**.

Today we cannot answer:

- How many times a day does a given load start and get revoked minutes later?
- How much time did each load actually get granted?
- How much surplus was exported while a declared flexible load sat idle and
  could have used it?

The raw material exists: `arbiter_decision_log` records every decision and
`arbiter_surplus_log` samples the signed grid balance every 5 minutes. But both
are **purged after 7 days**, so even a retrospective study is impossible past a
week, and there is no aggregate to compare one month against another.

This blocks everything downstream. Every tuning change so far has been argued
from intuition, and the next steps on the roadmap (an adaptive hysteresis, then
a forecast biasing the engage decision) are precisely the changes that can
visibly degrade behaviour. None of them should ship before there is a
measurement able to prove they did not.

This spec builds only that measurement. It is pure instrumentation: **no line of
`capacity-arbiter.ts` changes, and no arbitration decision is affected.**

## Scope

### In scope

1. A daily rollup of the decision journal and the surplus series into two small
   SQLite tables with a 400-day retention, so the 7-day purge stops erasing the
   evidence.
2. A read API and a CLI script to print those metrics over a date range.

### Out of scope (explicit non-goals)

- **Any change to arbitration.** `capacity-arbiter.ts` is not modified. No new
  setting influences a decision. With this spec merged, the arbiter behaves bit
  for bit as it does today.
- **Adaptive hysteresis** (roadmap phase 1). It was drafted in an earlier
  revision of this spec and deliberately split out: it is a control-loop change
  and it should be measured on this instrumentation before it is written.
- **Richer load learning** (roadmap phase 2). Same reason: it changes what
  `learned.watts` means and touches the learner in the arbiter.
- **Any forecast, planner or LLM** (roadmap phases 3 to 7).
- **A metrics UI page.** The data is exposed through the API and the script.
  Drawing it is a follow-up, once we know which metrics earn a pixel.

## Requirements

### FR-1: Daily metrics rollup

Per load and per local day:

| Metric        | Definition                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `grants`      | Number of `granted` decisions                                                                                     |
| `revokes`     | Number of `revoked` decisions (`revoke-not-honored` is a follow-up on the same revocation, never a second one)    |
| `shortCycles` | Grants revoked for `surplus-deficit` in less than `minOnS + releaseHoldS` after the grant (the **regret** metric) |
| `grantedS`    | Seconds spent in the sustained `granted` state                                                                    |
| `pendingS`    | Seconds spent in the sustained `pending` state (claiming, not granted)                                            |
| `unmanagedS`  | Seconds running outside arbitration (suspension or unclaimed run)                                                 |
| `suspendedS`  | Seconds under a suspension                                                                                        |

Per local day, home level:

| Metric                  | Definition                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `exportWh`              | Energy exported, integrated from the 5-min signed surplus samples                              |
| `importWh`              | Energy imported, same source                                                                   |
| `waitingExportWh`       | Export accumulated while a load was **claiming** it and did not get it: the arbiter's own miss |
| `idleClaimableExportWh` | Export accumulated while a **deferrable** load was not running and its `needW` was available   |
| `samples`               | Number of surplus samples the day actually had, as a coverage indicator                        |

The two "missed opportunity" figures answer different questions and must not be
merged. Measured on the reference installation over 9 real days: merged, the
figure read **75 % of all export missed**, two thirds of which was a comfort
heat pump idle because the house was already comfortable. Split:

- `waitingExportWh` = **3 %**. A load was actively claiming that surplus and
  did not get it. This is the arbiter's own miss (engage-hold latency, or a
  grant that never came) and the number that should stay small.
- `idleClaimableExportWh` = **46 %**, deferrable loads only. Nobody asked, so
  it is not an arbiter failure; it is the scheduling opportunity that a planner
  would harvest, and the figure that justifies roadmap phase 6.

Comfort loads are excluded from the idle figure on purpose: an idle heat pump
means the house is comfortable, not that energy was wasted. They are included
in the waiting figure, because a comfort load that claims did ask.

Both are **estimates**: 5-minute sampling, and `needW` evaluated with the
load's profile as it stands at rollup time. Both are labelled as estimates in
the API payload and in the script output, never presented as exact kWh.

Acceptance criteria:

- [x] Spans are derived with the same `sustainedAfter()` notion of state the
      timeline uses (`arbiter-timeline.ts`), not a second definition.
- [x] A span crossing local midnight has its seconds clipped and attributed to
      each day it covers.
- [x] The rollup is idempotent: recomputing a day overwrites its rows, never
      accumulates.
- [x] The rollup runs on an hour-aligned timer and recomputes today and
      yesterday on every run, so a restart or a missed hour never loses a day
      (the #618 reasoning on the energy aggregator rollover).
- [x] Retention is 400 days, purged at boot, mirroring `ArbiterJournalStore`.
- [x] A DB or computation failure never propagates: it is logged, the timer
      survives, and nothing else in the process is affected.
- [x] Each rollup tick reads at most `ROLLUP_ROW_CAP` decision rows per day,
      **keeping the newest**, and logs a warning naming the day when the cap is
      hit. No silent truncation, and a capped day is never emptied.
- [x] A suspension left open in the journal (a restart drops `overridesUntil`
      without journaling) is bounded by the override TTL, and closed outright
      by any later state transition.
- [x] All the upserts of one tick are issued in a single transaction: one
      commit, one fsync per tick (flash wear, architecture 3.4).

### FR-2: Read surface

- [x] `GET /api/v1/energy/arbiter/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD`
      returns the per-day home rows and the per-day per-load rows over the
      range, equipment names resolved. Range capped at 400 days, defaulting to
      the last 30.
- [x] The route returns an empty, well-formed payload when there is no data,
      never a 500.
- [x] `scripts/energy/arbiter-metrics.ts` prints the same data as a readable
      table (totals, per-load breakdown, short-cycle rate), following the
      existing conventions of that folder. It reads SQLite directly, so it works
      against a restored backup with no running instance.

## Edge cases

| Case                                            | Expected behaviour                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Arbiter disabled or never enabled               | No decisions to roll up, no rows written, endpoint returns an empty payload                              |
| Fresh install, no history                       | Same. The script prints "no data for this range"                                                         |
| DST change / clock shift                        | Days are local days, computed like the energy aggregator (spec 061). A 23 h or 25 h day is not an error  |
| Span crossing midnight                          | Seconds clipped per local day                                                                            |
| Restart mid-day                                 | The next hourly run recomputes today and yesterday from the raw logs, still inside their 7-day retention |
| Instance off for more than 7 days               | Those days are simply absent (their journal rows are gone), never wrong                                  |
| A day with more decisions than `ROLLUP_ROW_CAP` | Read truncated, warning logged naming the day, the rollup still writes what it has                       |
| Load deleted or profile disabled                | Historical rows are kept (they describe the past); the name falls back to the equipment id               |
| Surplus samples missing for part of a day       | `samples` reflects the real coverage so the reader can discount the day                                  |
| Shadow mode                                     | The arbiter is disabled there, so no decisions and no rows. The rollup runs and writes nothing           |
| Two instances on the same DB file               | Not a supported configuration; the upsert is idempotent so the worst case is duplicated work             |

## Success criteria

This spec succeeds when, after a week of running, we can state on the reference
installation:

- the number of short cycles per load per day, and
- the granted, pending and unmanaged seconds per load per day, and
- an order of magnitude for the surplus exported while a declared load was
  idle,

and when those figures can still be read a year later. That is the baseline
every later phase of the roadmap will be compared against.

## Known caveat

Load profiles are read **as they stand at rollup time**, not as they were on the
day. This affects `needW` (both export figures) and `minOnS` (short-cycle
detection). Since only today and yesterday are recomputed on a tick, historical
rows keep the basis they were written with; retuning a profile does not rewrite
the past. Observed on the reference installation: the pool pump shows revokes at
30 to 41 minutes against a current `minOnS` of 45 minutes, which is the trace of
a profile retuned since those days.

## Validation on real data (plan step 14)

Run against a copy of the production database (9 days, 297 decisions, 2300
surplus samples, 4 declared loads). Granted hours were cross-checked against an
independent walk of the raw journal written without sharing any code with the
module: three loads matched to within 0.1 h. The fourth differed by 2.3 h, fully
explained and in the module's favour — the heat pump goes `granted` to `waiting`
with no revocation in between, so the timeline paints "pending" from that
instant and the granted span must stop there. The independent script, being
cruder, kept counting. That is exactly the benefit of deriving spans from
`sustainedAfter()` rather than a second definition.
