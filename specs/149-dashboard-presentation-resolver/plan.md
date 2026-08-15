# Spec 149 — Implementation plan

## Tasks

1. [x] `presentation/types.ts` — `WidgetPresentation`, `WidgetControl`, `IconCtx`.
2. [x] `presentation/resolve-helpers.ts` — `findToggleBinding` (category-first + fallback), `toggleValues` (onValue/offValue from enum/boolean), `isOnFromStateBinding`, `formatRuntime` (moved from `EquipmentWidget.tsx`).
3. [x] `presentation/resolveWidgetPresentation.ts` — dispatcher + `switch`, `media_player`, `pool_pump` resolvers (custom-icon override included).
4. [x] `presentation/resolveWidgetPresentation.test.ts` — unit tests (see test plan).
5. [x] `presentation/PresentationWidget.tsx` — desktop descriptor renderer (WidgetCard shell, state pill + secondary lines, toggle button row).
6. [x] `EquipmentWidget.tsx` — resolver short-circuit at top of dispatcher; delete `SwitchEquipmentWidget`, `MediaPlayerEquipmentWidget`, `PoolPumpEquipmentWidget`; gate multi-action point fix in `GateEquipmentWidget`.
7. [x] `MobileWidgetCard.tsx` — resolver short-circuit at top of `useMobileState`; delete the three legacy branches; string-boolean sensor normalization via `coerceBooleanString`.
8. [x] ~~`sensorUtils.ts` — add `coerceBooleanString`~~ — not needed: converged on the existing `isBooleanSensorCategory` + `formatBooleanSensor` (the desktop authority).
9. [x] `getMobileClickAction` (extracted to `mobile-click-action.ts`) consumes the descriptor toggle for migrated types (thread `widget` + `t`).
10. [x] Component tests updated/added (existing tests untouched — retro-compat pin).
11. [x] Full validation: `npx tsc --noEmit`, `cd ui && npx tsc -b --noEmit`, `npx vitest run`, eslint backend + UI.
12. [x] Playwright visual QA — done against the Vite dev build proxied onto the local shadow (prod data): desktop 1440px (switch ON pill + toggle, TV OFF + power, pool pump OFF + runtime) and mobile 390px (pool pump "OFF · 0s", switch "ON", TV "OFF") all match the legacy rendering. No multi-action gate in the dataset (both prod gates are single-action) — covered by the component test instead.

## Test plan

### Modules to test

- `presentation/resolveWidgetPresentation.ts` (new — pure logic, prime unit-test target)
- `presentation/resolve-helpers.ts` (via the resolver tests)
- `EquipmentWidget.tsx` (component tier, #458 pattern)
- `MobileWidgetCard.tsx` (component tier)
- `WidgetGrid.tsx` `getMobileClickAction` (via component test or extracted unit)
- `sensorUtils.coerceBooleanString` (unit)

### Scenarios

| Module               | Scenario                                                                                        | Expected                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| resolver             | switch OFF, enum order `["ON","OFF"]`                                                           | `isActive=false`, `state.primary="OFF"`, toggle `{alias:"state", onValue:"ON", offValue:"OFF"}` |
| resolver             | switch ON with lowercase enum `["on","off"]`                                                    | toggle values `"on"`/`"off"` (case-insensitive match preserved)                                 |
| resolver             | switch with boolean order binding                                                               | toggle `{onValue:true, offValue:false}`                                                         |
| resolver             | switch with **no** order binding                                                                | `controls: []`                                                                                  |
| resolver             | media_player ON with `input_source="HDMI 1"`                                                    | `state.primary="HDMI 1"`, `isActive=true`                                                       |
| resolver             | media_player OFF / no source                                                                    | `state.primary="OFF"` / `"ON"` fallback                                                         |
| resolver             | pool_pump with `runtime_daily=5400`                                                             | `state.secondary=["1h 30m"]`                                                                    |
| resolver             | pool_pump without `runtime_daily`                                                               | no secondary line                                                                               |
| resolver             | pool_pump toggle prefers `pool_pump_toggle` category over unrelated boolean order (`auto_mode`) | toggle alias = the category-bound order                                                         |
| resolver             | unmigrated type (e.g. `light_onoff`)                                                            | returns `null`                                                                                  |
| resolver             | custom `widget.icon` set                                                                        | `icon(ctx)` renders the registry component, not the type default                                |
| EquipmentWidget      | **existing 6 tests** (switch ON/OFF + toggle fire, disabled, other category)                    | pass unchanged                                                                                  |
| EquipmentWidget      | media_player renders Tv + source pill, toggle fires `power` with `!on`                          | new test                                                                                        |
| EquipmentWidget      | pool_pump renders runtime line                                                                  | new test                                                                                        |
| EquipmentWidget      | gate with `enumValues=["OPEN","CLOSE","PEDESTRIAN"]`                                            | renders 3 action buttons, each firing its enum value; no card-level tap                         |
| EquipmentWidget      | gate with single/no enum value                                                                  | keeps tap-the-card single-action behavior                                                       |
| MobileWidgetCard     | **existing tests** (energy meter, label)                                                        | pass unchanged                                                                                  |
| MobileWidgetCard     | switch shows ON/OFF from descriptor                                                             | new test                                                                                        |
| MobileWidgetCard     | pool_pump shows ON + runtime line (divergence 1 regression test)                                | new test                                                                                        |
| MobileWidgetCard     | sensor with string `"OPEN"` contact value                                                       | localized open/closed text, not raw `"OPEN"`                                                    |
| getMobileClickAction | switch tap fires descriptor toggle (alias + value)                                              | same order as before migration                                                                  |
| getMobileClickAction | migrated type without toggle                                                                    | no tap action                                                                                   |

### Retro-compat

- The pre-existing component tests are the contract: **do not modify them**; if one fails, the migration broke behavior — fix the code, not the test.
- Desktop visual parity checked by Playwright pass (task 12) against the shadow instance.

## Verification

- `npm run validate` equivalent: backend tsc + eslint (untouched, must stay green), UI tsc + eslint, full vitest.
- Playwright QA notes: shadow instance disables recipes but dashboard widgets render fine; remember the PWA service-worker stale-bundle gotcha (unregister SW + hard reload before screenshots).

## Later phases (tracked in #325, not this spec)

- Migrate light family (needs `slider` control), water_heater, water_valve (near-clones of switch).
- Migrate shutter/awning/pool_cover (buttons row + slider + stop-capability flag).
- Migrate thermostat/pool_heat_pump, heater, gate (confirm-guard), sensor (needs store ctx for battery), weather, energy meter, appliance, camera, solar.
- Delete `useMobileState` legacy branches, `needsDetailSheet`, and the remaining per-type sub-widgets; detail sheet reads descriptors.
