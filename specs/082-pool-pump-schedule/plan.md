# Spec 082 — Implementation Plan

## Task Breakdown

### Phase 1 — Scaffold the recipe repo

- [x] 1.1 Create `/Users/mchacher/Documents/01_Geekerie/sowel-recipe-pool-pump-schedule/`
      as a sibling of `sowel-recipe-auto-watering`.
- [x] 1.2 Copy `package.json`, `tsconfig.json`, `.github/workflows/release.yml`
      from auto-watering, rename id/name.
- [x] 1.3 Write `manifest.json` (see architecture).

### Phase 2 — Recipe implementation (`src/index.ts`)

- [x] 2.1 Mirror the type stubs from auto-watering
      (RecipeSlotDef, RecipeContext, etc.).
- [x] 2.2 Implement `msUntilTime(hhmm)` — identical to auto-watering.
- [x] 2.3 Implement `buildSlots()` — 7 slot defs (pump + 3×{start,end}).
- [x] 2.4 Implement `validate()`: - pump required - slot1 start + end required - slot2/3 start and end must come together (both set or neither) - no slot allows `start == end`
- [x] 2.5 Implement `createInstance()` — per-slot independent start
      and end timers, state updates, reschedule on fire.
- [x] 2.6 Implement `stop()` — cancel all timers, OFF the pump if
      currently running.
- [x] 2.7 FR i18n pack.

### Phase 3 — Tests (`src/index.test.ts`)

See Test Plan below.

### Phase 4 — Validate & publish

- [x] 4.1 `npm run build` passes.
- [x] 4.2 `npm test` — all scenarios green.
- [x] 4.3 `git init`, first commit, push to `mchacher/sowel-recipe-pool-pump-schedule`.
- [x] 4.4 Create GitHub repo + push.
- [x] 4.5 Tag `v1.0.0` → GitHub Actions builds + releases the tarball.

### Phase 5 — Register in Sowel

- [x] 5.1 On Sowel `main`: append the registry entry.
- [x] 5.2 `chore(plugins): add pool-pump-schedule v1.0.0 to registry`.
- [x] 5.3 Push to `main` (no Sowel release — registry-only change).

### Phase 6 — Manual verification

- [ ] 6.1 Hit "Refresh registry" in the Sowel UI Plugins page.
- [ ] 6.2 Install the recipe.
- [ ] 6.3 Create an instance with a narrow window (say next minute → +2 min)
      and verify ON at start, OFF at end.
- [ ] 6.4 Verify midnight-crossing: set a window 23:58 → 00:02 and
      observe the OFF fires on the following day.
- [ ] 6.5 Disable a running instance → pump must turn OFF.

## Test Plan

### Modules to test

- `src/index.ts` — the recipe definition (slots, validate, createInstance).

### Scenarios

| Scenario                                     | Expected                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `msUntilTime` — time later today             | Returns ms between now and HH:MM today                                                      |
| `msUntilTime` — time already passed today    | Returns ms until HH:MM tomorrow                                                             |
| `validate` — no pump                         | Throws "pump is required"                                                                   |
| `validate` — slot 1 missing end              | Throws "Slot 1 end is required"                                                             |
| `validate` — slot 2 start without end        | Throws "Slot 2 end is required when start is set"                                           |
| `validate` — slot 2 end without start        | Throws "Slot 2 start is required when end is set"                                           |
| `validate` — slot with start == end          | Throws "Slot ... start and end must differ"                                                 |
| `validate` — all good                        | No throw                                                                                    |
| `createInstance` — fires ON at start         | `executeOrder(pumpId, "state", "ON")` called, state.status=`running`, state.currentSlot set |
| `createInstance` — fires OFF at end          | `executeOrder(pumpId, "state", "OFF")`, state.status=`idle`, currentSlot=null               |
| `createInstance` — handles midnight crossing | For `start=23:58, end=00:02` the OFF timer fires the day after                              |
| `createInstance` — reschedules for tomorrow  | After firing, a new timer is armed ~24h later                                               |
| `stop()` while idle                          | Cancels all timers, no OFF command sent                                                     |
| `stop()` while running                       | Sends OFF, cancels all timers, state reset                                                  |

Tests use vitest's fake timers (`vi.useFakeTimers()` + `setSystemTime`)
and a mocked `EquipmentManager` that records every `executeOrder`
call.

### Not tested

- React UI (there is none; the slot picker is generic)
- Recipe engine wiring (covered by Sowel core tests)
- Actual MQTT dispatch (covered by Tasmota plugin tests)
