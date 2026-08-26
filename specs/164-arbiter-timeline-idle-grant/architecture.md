# Architecture — spec 164

## Why the journal, and not InfluxDB

The ribbon is reconstructed entirely from the persisted decision journal
(`arbiter_decision_log` → `buildLoadTimelines`), which is what makes it
replayable, restart-proof and consistent with the journal rows the user clicks
through. Reading per-load power from InfluxDB at render time would introduce a
second source for the same ribbon (a query per load per window, a different
retention, a different failure mode) for a distinction the arbiter already
computes in memory every tick. So the observation is journaled, like every other
thing the arbiter knows.

Cost: two new rows per grant episode in a table that already carries grants,
revokes, waits and audit signals, with a 7-day retention and a 5-minute
confirmation window ahead of them. A thermostatic load cycling all afternoon
contributes a handful of rows, not one per cycle.

## Data model

### `src/shared/types.ts`

```ts
export type ArbiterDecisionKind =
  | ...
  /** Spec 164 — a granted load's own measurement has stayed below its idle
   *  threshold for DRAW_CONFIRM_MS: the surplus is allocated and nothing is
   *  consuming it. Paints `granted-idle` on the ribbon. */
  | "draw-stopped"
  /** Spec 164 — the same load is measured drawing again. */
  | "draw-started";

export type ArbiterQuarterState =
  | "granted"
  | "granted-idle" // spec 164
  | "pending"
  | "revoked"
  | "unmanaged"
  | "idle";
```

`ui/src/types.ts` mirrors both unions. No SQLite migration: `kind` is a free
TEXT column and both new kinds carry only the fields already persisted
(`equipment_id`, `watts` — the measured draw at the transition, useful in the
journal row).

## Arbiter — the observation

`src/energy/capacity-arbiter.ts`

`notDrawing()` (spec 732) already answers "is this load idle", but with a state
fallback that must NOT be used here (FR-2). It is split so both callers get
what they need, with no behaviour change for the watchdog:

```ts
/** Measured idleness: true/false from the load's OWN power reading, null when
 *  there is no fresh reading. */
private measuredIdle(equipmentId: string): boolean | null

/** Watchdog predicate (#732), unchanged: measurement first, then the reported
 *  state on a load declaring no shutdown inertia. */
private notDrawing(equipmentId: string): boolean   // = measuredIdle() ?? <state tier>
```

New per-equipment runtime state, dropped in `forgetEquipment`:

```ts
/** Spec 164 — journaled draw state of a granted load, and when the current
 *  contradicting observation began. `undefined` = not observed (no grant, or
 *  no measurement yet). */
private drawState = new Map<string, boolean>();      // true = drawing
private drawChangeSince = new Map<string, number>();
```

`checkGrantDraw(now)` runs from `runEvaluate`, next to `checkWatchdogs`:

```
for each granted claim:
  idle = measuredIdle(eq)
  if idle === null: drawChangeSince.delete(eq); continue     // FR-5, hold state
  if !drawState.has(eq): drawState.set(eq, true); continue    // FR-3, ribbon shows green
  if drawState.get(eq) === !idle: drawChangeSince.delete(eq); continue
  since = drawChangeSince.get(eq) ?? now; drawChangeSince.set(eq, since)
  if now - since < DRAW_CONFIRM_MS: continue                 // FR-1
  drawState.set(eq, !idle); drawChangeSince.delete(eq)
  journal({ kind: idle ? "draw-stopped" : "draw-started", equipmentId: eq,
            watts: Math.round(freshLiveDraw(eq) ?? 0) })
```

`drawState` holds **what the ribbon currently shows**, not what the meter last
said — that is the invariant that makes the seed correct. The `granted` entry
paints the drawing green, so the seed is `true` whatever the first reading says.
A load idle from the very start therefore flips once, 5 minutes in (FR-3),
instead of being silently treated as already-journaled-idle while the ribbon
shows green.

`clearDrawState(equipmentId)` is called from `revoke()`, `release()` (granted
branch) and `suspend()` — every path out of a grant (FR-6).

Constants:

```ts
const DRAW_CONFIRM_MS = 300_000; // 5 min sustained before a transition (FR-1)
```

## Timeline reconstruction

`src/energy/arbiter-timeline.ts`

```ts
case "draw-stopped":
  return "granted-idle";
case "draw-started":
  return "granted";
```

Both are ordinary sustained transitions, so the existing machinery (entering
state, per-quarter sustained state, revoke-wins-the-quarter) needs nothing else.
`isRevoke` is untouched, so FR-6 holds by construction.

## Metrics (spec 158)

`src/energy/arbiter-metrics.ts` — `accumulateSpans` switches on the quarter
state, so `granted-idle` would silently fall into `default` and stop counting.
It is added next to `granted`:

```ts
case "granted":
case "granted-idle": // spec 164 — still granted time, baseline preserved
  row.grantedS += s;
```

`row.grants` / `row.revokes` key off `kind === "granted"` / `isRevoke`, so the
new kinds are naturally neither.

## UI

| File                                            | Change                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `ui/src/types.ts`                               | Mirror both unions                                                         |
| `ui/src/components/energy/arbiterColors.ts`     | `GRANTED_IDLE_FILL` + `cellColor` case + `journalDotColor` for both kinds  |
| `ui/src/components/energy/ArbiterTimeline.tsx`  | One more legend entry                                                      |
| `ui/src/components/energy/arbiterReason.ts`     | Nothing — the journal label comes from `arbiter.kind.<kind>`               |
| `ui/src/i18n/locales/{fr,en}.json`              | `arbiter.timeline.state.granted-idle`, `arbiter.legend.grantedIdle`, `arbiter.kind.draw-stopped`, `arbiter.kind.draw-started` |
| `ui/src/i18n/locale-completeness.test.ts`       | Extend both exhaustive maps                                                |

Colour, following the `PENDING_FILL` precedent (#617):

```ts
export const GRANTED_IDLE_FILL = "color-mix(in srgb, var(--color-solar-auto) 35%, transparent)";
```

35 %, not the 15 % of the waiting tint: this cell must still read as green
rather than as an empty cell, while sitting clearly below the solid grant.

Copy:

| Key                                     | FR                                | EN                            |
| --------------------------------------- | --------------------------------- | ----------------------------- |
| `arbiter.timeline.state.granted-idle`   | Accordé (ne consomme pas)         | Granted (not consuming)       |
| `arbiter.legend.grantedIdle`            | Accordé, sans consommation        | Granted, not consuming        |
| `arbiter.kind.draw-stopped`             | ne consomme plus le surplus       | stopped consuming the surplus |
| `arbiter.kind.draw-started`             | consomme le surplus               | started consuming the surplus |

## API

No new endpoint, no contract change: `GET /api/v1/energy/arbiter/timeline`
already returns `loads[].quarters` (a wider union now) and `journal` (two more
kinds). Older UI builds would render an unknown state with the default (idle)
fill and an untranslated journal label — acceptable, and the UI ships with the
core anyway.
