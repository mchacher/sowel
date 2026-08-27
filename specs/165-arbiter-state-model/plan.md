# Plan — spec 165

## Implementation steps

1. **Types** — `src/shared/types.ts`: `ArbiterLoadState`, `ArbiterQuarterState`
   = that union plus `"revoked"`, `ArbiterLoadInfo`; `ArbiterPublicState` gains
   `loads` and `dormant`, and the four legacy arrays get `@deprecated`. Mirror
   all of it in `ui/src/types.ts`.
2. **Arbiter** — `src/energy/capacity-arbiter.ts`:
   - optional `sunlight?: SunlightManager` constructor dependency, wired at
     `src/index.ts:363` from the instance created at `:295`;
   - `private isDormant(): boolean`, the engine-side `isArbiterDormant`;
   - `private resolveLoadState(id, dormant): ArbiterLoadState`, the branch order
     of the architecture note;
   - `getPublicState()` builds `loads` over `config.priority` (profiled ids
     only, the `idle` filter of #561) and keeps the four legacy arrays as they
     are.
3. **Timeline** — `src/energy/arbiter-timeline.ts`: `buildLoadTimelines` takes an
   optional `dormant` flag and rewrites the LAST cell only, and only when it is
   `pending`. `getTimeline()` passes `this.isDormant()`. `sustainedAfter` is
   untouched: a suspension keeps painting idle/unmanaged (spec non-goal).
4. **UI state** — `ArbitrationSurface.tsx`: delete `RosterRow`, `STATE_COLOR`,
   the four-array flattening and the `useZoneAggregation` import; render
   `state.loads`. Delete `isArbiterDormant` from `arbiterColors.ts` and its
   tests.
5. **UI colour** — `loadStateColor()` replacing `STATE_COLOR` + `cellColor`;
   `SUSPENDED_FILL` next to `PENDING_FILL` / `GRANTED_IDLE_FILL`; one more
   legend entry in `ArbiterTimeline.tsx`.
6. **Copy** — `arbiter.loadState.*` in both locales; remove `rosterState.*`,
   `timeline.state.*` and the per-state `legend.*` keys; one exhaustive map in
   `locale-completeness.test.ts` instead of two.
7. **Delete** — `ui/src/lib/arbitration-lanes.ts` and
   `ui/src/lib/arbitration-lanes.test.ts` (FR-8).
8. **Docs** — `docs/specs-index.md` row; the ribbon legend paragraph of
   the roster sentence of `docs/deep-dives/surplus-arbiter.{md,fr.md}` gains
   `granted-idle`;
   `docs/user/energy.{md,fr.md}` if it lists the ribbon colours.

No migration, no new endpoint, no persisted-shape change.

## Test Plan

| Module                | Scenario                                       | Expected                                                |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `capacity-arbiter`    | granted load, `drawState` false                | `loads[].state === "granted-idle"`                      |
| `capacity-arbiter`    | granted load, no measurement ever seen         | `"granted"`, never `"granted-idle"`                     |
| `capacity-arbiter`    | pending claim, `unclaimedRunning` set, dormant | `"unmanaged"` (running beats night)                     |
| `capacity-arbiter`    | pending claim, not running, dormant            | `"idle"`                                                |
| `capacity-arbiter`    | pending claim, not running, daylight           | `"pending"` with `needW` set                            |
| `capacity-arbiter`    | suspended load that also holds a pending claim | one entry, `"suspended"`                                |
| `capacity-arbiter`    | profiled load with no claim                    | `"idle"` with its rating, not 0 W                       |
| `capacity-arbiter`    | `loads` order                                  | matches `config.priority`                               |
| `capacity-arbiter`    | no `SunlightManager` injected                  | `dormant === false`, states unchanged                   |
| `capacity-arbiter`    | `isDaylight === null` (no coordinates)         | `dormant === false`                                     |
| `capacity-arbiter`    | legacy arrays                                  | identical to pre-165 output, field by field             |
| `arbiter-timeline`    | dormant, last quarter `pending`                | last cell `"idle"`, earlier `pending` cells untouched   |
| `arbiter-timeline`    | dormant, last quarter `granted`                | unchanged                                               |
| `arbiter-timeline`    | revoke inside the last quarter, dormant        | `"revoked"` still wins                                  |
| `arbiterColors`       | every `ArbiterLoadState` + `"revoked"`         | `loadStateColor` returns a non-empty token (exhaustive) |
| `locale-completeness` | every state                                    | one key per state present in `fr` and `en`              |
| `ArbitrationSurface`  | a `granted-idle` load                          | roster pill reads "Accordé (ne consomme pas)"           |
| `ArbitrationSurface`  | a suspended load                               | pill reads "Suspendu", no duplicate row                 |
| `ArbitrationSurface`  | roster and ribbon on one fixture               | same state word for the same load, same instant         |

The last row is the point of the spec and is written as an explicit
cross-component test: one `ArbiterPublicState` + `ArbiterTimeline` fixture, both
components rendered, the roster pill text and the last ribbon cell's state
asserted equal.

## Risks

- **Relabelling a state the user knows.** "Hors surplus" disappears; a pending
  claim whose load runs anyway now reads "Marche (hors arbitrage)", the same as
  an unclaimed run. Deliberate (architecture note), and the row's figures still
  distinguish the two, but it is the one change a user will notice.
- **Deprecated arrays living on.** FR-7 keeps duplicated resolution in the read
  model for one minor version. The removal is a follow-up spec, not a TODO.
