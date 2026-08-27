# Spec 166 — Architecture

## Where the state is decided today

`drawState: Map<equipmentId, boolean>` is the single source for the granted split. `resolveLoadState()` reads it ([capacity-arbiter.ts:942](../../src/energy/capacity-arbiter.ts#L942)):

```ts
return this.drawState.get(equipmentId) === false ? "granted-idle" : "granted";
```

and `checkGrantDraw()` is the only writer. So the roster, the ribbon's current cell and the journal all follow from one map, and this spec changes exactly one thing: what `checkGrantDraw()` does when there is no fresh measurement.

Today it gives up:

```ts
const idle = this.measuredIdle(eq);
if (idle === null) { this.drawChangeSince.delete(eq); continue; }
```

## The change

A new `declaredNeed: Map<equipmentId, boolean>`, written by the claim handle, read only in that branch.

```
measuredIdle(eq) !== null            ->  measurement decides       (spec 164, untouched)
measuredIdle(eq) === null, never
  described by a measurement         ->  declaredNeed decides      (new)
measuredIdle(eq) === null, already
  described by a measurement         ->  hold, as spec 164 does
neither                              ->  hold, as today
```

A second map, `declarationDriven`, records whose current state came from a declaration. It buys two things. It stops a declaration overwriting an observation the moment the device goes quiet, which would make a slow-reporting load flap once per reporting gap. And it lets the first contradicting measurement overturn a declaration **immediately** rather than serving `DRAW_CONFIRM_MS`: on a load reporting slower than the freshness window, the stale ticks in between reset the confirmation window on every pass, so it could never mature at all.

**A declaration is applied at once, without the five-minute confirmation.** `DRAW_CONFIRM_MS` exists to absorb a noisy sample; a claimant's statement is not a sample and does not need de-bouncing. The pending confirmation window is cleared when the declaration takes over, so a half-matured measurement window cannot fire later on stale grounds.

The same `draw-started` / `draw-stopped` journal entries are written, so the ribbon's history stays consistent with its live cell and spec 158 keeps reading one vocabulary.

## Types

`src/shared/types.ts`:

```ts
export interface CapacityClaimHandle {
  readonly id: string;
  status(): "pending" | "granted" | "denied" | "released";
  readonly deniedReason?: CapacityDenyReason;
  release(): void;
  /** Spec 166 — whether the load needs current right now. Consulted ONLY
   *  when the load has no fresh own measurement; a measurement always wins.
   *  Ignored unless the claim is granted. */
  reportNeed(need: boolean): void;
}
```

Recipes declare their own structural copy of this interface locally, so adding a method breaks none of them: a recipe that does not know about `reportNeed` simply never calls it.

## Lifecycle

`declaredNeed` is cleared wherever `drawState` already is, via `clearDrawState()` ([capacity-arbiter.ts:1674](../../src/energy/capacity-arbiter.ts#L1674)), which every path out of a grant already calls. That gives FR-6 for free: a declaration cannot survive into a later grant.

`reportNeed` on a claim that is not granted is a no-op. It never throws: a recipe calling it at the wrong moment must not take the tick down.

## Files touched

| File | Change |
| --- | --- |
| `src/shared/types.ts` | `reportNeed` on `CapacityClaimHandle` |
| `src/energy/capacity-arbiter.ts` | `declaredNeed` map, handle wiring, the `idle === null` branch, `clearDrawState` |
| `src/energy/capacity-arbiter.test.ts` | the scenarios below |

No migration, no route change, no UI change: the roster and the ribbon already render `ArbiterLoadState`, and no new value is added to it.

## Out of scope

No fault state. "Declared needing, measured idle" stays `granted-idle`: a heat pump between compressor cycles and a water heater whose thermostat has cut off are both in that state and both healthy. Telling a genuine failure apart needs a duration argument measured against real data, not a state.
