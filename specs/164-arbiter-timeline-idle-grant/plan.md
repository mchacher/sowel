# Plan — spec 164

## Implementation steps

1. **Types** — `src/shared/types.ts`: add `draw-stopped` / `draw-started` to
   `ArbiterDecisionKind`, `granted-idle` to `ArbiterQuarterState`. Mirror both
   in `ui/src/types.ts`.
2. **Arbiter** — `src/energy/capacity-arbiter.ts`:
   - split `notDrawing()` into `measuredIdle()` (measurement only, `null` when
     no fresh reading) + the existing state tier, no behaviour change for the
     watchdog;
   - `DRAW_CONFIRM_MS`, `drawState`, `drawChangeSince`, dropped in
     `forgetEquipment`;
   - `checkGrantDraw(now)` called from `runEvaluate` next to `checkWatchdogs`;
   - `clearDrawState()` from `revoke()`, `release()` (granted branch),
     `suspend()`.
3. **Timeline** — `src/energy/arbiter-timeline.ts`: two cases in
   `sustainedAfter`, and the local `QuarterState` union.
4. **Metrics** — `src/energy/arbiter-metrics.ts`: `granted-idle` falls through
   to `grantedS`.
5. **Tests** — the plan below, backend + the UI colour map.
6. **UI** — `arbiterColors.ts` (`GRANTED_IDLE_FILL`, `cellColor`,
   `journalDotColor`), one legend entry in `ArbiterTimeline.tsx`, four keys in
   each locale, both exhaustive maps in `locale-completeness.test.ts`.
7. **Docs** — `docs/specs-index.md` row; `docs/user/energy.{md,fr.md}` legend
   description if it lists the ribbon colours.

No migration, no API contract change, no new endpoint.

## Test Plan

### Modules to test

- `src/energy/capacity-arbiter.ts` — the observation and its confirmation window
- `src/energy/arbiter-timeline.ts` — state mapping and ribbon reconstruction
- `src/energy/arbiter-metrics.ts` — baseline neutrality
- `ui/src/components/energy/arbiterColors.ts` — the new fill

### Scenarios

| Module            | Scenario                                                              | Expected                                                             |
| ----------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| capacity-arbiter  | Granted metered load below the idle threshold for 5 min               | One `draw-stopped` journaled, with the measured watts (AC1)          |
| capacity-arbiter  | The same load draws again for 5 min                                   | One `draw-started`, and only one (AC2)                               |
| capacity-arbiter  | Draw dips below the threshold for 2 min then returns                  | Nothing journaled (AC3)                                              |
| capacity-arbiter  | Granted load with no power binding, whole grant                       | Neither kind ever journaled (AC4)                                    |
| capacity-arbiter  | Measurement stops arriving (stale) while idle, before the 5 min       | Nothing journaled, state held (AC5)                                  |
| capacity-arbiter  | Load idle from the grant, never starts                                | Exactly one `draw-stopped`, 5 min after the grant (FR-3)             |
| capacity-arbiter  | Revoke while idle, then a new grant, load drawing                     | No stray `draw-started`; observation restarts clean (FR-6)           |
| capacity-arbiter  | Load drawing 2 200 W, granted, stays drawing                          | Nothing journaled — the ribbon already shows the drawing green       |
| arbiter-timeline  | `sustainedAfter("draw-stopped")` / `("draw-started")`                 | `"granted-idle"` / `"granted"`                                       |
| arbiter-timeline  | Grant, then `draw-stopped` mid-window                                 | Quarters before stay `granted`, quarters after are `granted-idle`    |
| arbiter-timeline  | A revoke lands in a quarter that entered `granted-idle`               | That quarter is `revoked` (AC6)                                      |
| arbiter-timeline  | Journal with no new kinds (legacy rows)                               | Ribbon identical to today                                            |
| arbiter-metrics   | A day split between `granted` and `granted-idle`                      | `grantedS` equals the day with no draw events at all (AC7)           |
| arbiter-metrics   | `draw-stopped` / `draw-started` in the journal                        | `grants` and `revokes` unchanged                                     |
| arbiterColors     | `cellColor("granted-idle")`                                           | `GRANTED_IDLE_FILL`, distinct from `cellColor("granted")`            |
| arbiterColors     | `journalDotColor("draw-stopped" \| "draw-started")`                   | The solar-auto token (same family as the grant)                      |
| locale-complete.  | Both new kinds and the new state                                      | Present in `fr.json` and `en.json` (AC8)                             |

### Manual verification

- Energy → Live on a running instance with the arbiter enabled: a granted load
  whose breaker is open shows the muted green after 5 minutes, the legend shows
  the new entry, and clicking the cell scrolls the journal to the
  `draw-stopped` row.

## Tasks

- [ ] Types (shared + ui)
- [ ] `measuredIdle()` split, no watchdog behaviour change
- [ ] `checkGrantDraw` + state maps + clear paths
- [ ] `sustainedAfter` cases
- [ ] Metrics fall-through
- [ ] Backend tests (13 scenarios)
- [ ] UI colours + legend + locales + exhaustive maps
- [ ] UI tests (colour map)
- [ ] `docs/specs-index.md` + user docs if the ribbon legend is listed
- [ ] Full `npm run validate`
- [ ] Agent review (Phase 5)
