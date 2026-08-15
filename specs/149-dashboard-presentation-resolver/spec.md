# Spec 149 — Dashboard presentation resolver (phase 1)

**Issue**: [#325](https://github.com/mchacher/sowel/issues/325)
**Status**: draft
**Scope**: UI only (no backend change)

## Problem

Each equipment type derives its dashboard **icon + state text + controls** independently in four places:

| Path                | File                                                                  | Shape produced                                    |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| Desktop widget      | `ui/src/components/dashboard/EquipmentWidget.tsx` (~1860 l.)          | per-type sub-widget rendering a full `WidgetCard` |
| Mobile card         | `ui/src/components/dashboard/MobileWidgetCard.tsx` → `useMobileState` | `{ icon, stateLines[] }`                          |
| Mobile detail sheet | `ui/src/components/dashboard/WidgetDetailSheet.tsx` (~1500 l.)        | per-type layout + controls                        |
| Mobile tap action   | `ui/src/components/dashboard/WidgetGrid.tsx` → `getMobileClickAction` | re-resolves the toggle order binding a 4th time   |

Adding or changing a type means touching all of them, in sync, by hand. This drift is the shared root cause of #315, #318, #323, #324, and the still-open divergences below.

## Confirmed divergences (verified against current code)

1. **Pool pump daily runtime**: desktop shows `runtime_daily` (`PoolPumpEquipmentWidget`); the mobile card shows only ON/OFF.
2. **Gate multi-action on desktop**: the mobile detail sheet renders one button per enum action (`GateDetailContent`), but the desktop `GateEquipmentWidget` only supports the single-action tap — with >1 enum values the desktop card exposes **no way to trigger any action**.
3. **String-valued boolean sensors**: the mobile card formats `typeof value === "boolean"` via `formatBooleanSensor`, but a sensor emitting the string `"ON"`/`"OPEN"` falls through to `formatSensorValue` and renders raw (residual of #315).
4. **Sensor value count**: the mobile card caps at 2 values (`slice(0, 2)`); desktop shows all in a scrollable column. **Resolution: keep the mobile cap** — it is a real surface constraint (120 px card), not drift. The descriptor carries the full list; each surface decides how many to show. Documented here so it stops being re-reported.
5. **Toggle-binding resolution drift**: the "find the ON/OFF order binding" logic exists in at least 7 copies with subtle differences — `SwitchEquipmentWidget` (plain `find`, NOT category-first), `LightEquipmentWidget`, `WaterHeaterEquipmentWidget`, `WaterValveEquipmentWidget` (plain), `PoolPumpEquipmentWidget` (category-first), `LightDetailContent` (category-first), `getMobileClickAction` (category-first). A switch bound with a non-conventional alias behaves differently on desktop vs mobile tap.

## Goal

Introduce a single **presentation resolver**: one pure function per equipment type returning a layout-agnostic descriptor consumed by every surface. A widget type is described once; the surfaces only own pixels.

This spec is **phase 1 of an incremental, type-by-type migration** (per the migration plan in #325): land the resolver scaffold, migrate three switch-like types end-to-end, point-fix the two remaining confirmed divergences on unmigrated types, then evaluate ergonomics before committing to the full ~15-type sweep.

## In scope (phase 1)

- `resolveWidgetPresentation(widget, equipment, t): WidgetPresentation | null` — pure function, no hooks. Returns `null` for types not yet migrated (callers fall back to the legacy path). This is the coexistence mechanism.
- Descriptor types (`WidgetPresentation`, `WidgetControl`) — controls are **declarative** (`toggle`, `buttons`; `slider` reserved for later phases), not JSX.
- Migrate **`switch`**, **`media_player`**, **`pool_pump`** across all their surfaces:
  - desktop `EquipmentWidget` renders the descriptor through a shared `PresentationWidget` shell;
  - mobile `useMobileState` returns icon/stateLines from the descriptor;
  - `getMobileClickAction` derives the direct-tap toggle from the descriptor's `toggle` control (single source for alias/on-off values);
  - none of the three types has a mobile detail sheet. `switch` and `pool_pump` keep their direct-tap toggle unchanged. **`media_player` gains it** (deliberate): its mobile tap used to be inert — there was no way at all to control a TV from the mobile dashboard — and the descriptor toggle aligns it with the desktop power button and the other simple on/off types.
  - Migrating `pool_pump` folds in divergence 1 (runtime line appears on mobile via `state.secondary`).
- Point fixes on unmigrated types (full migration comes in later phases):
  - divergence 2: desktop gate widget renders the per-enum action buttons when `enumValues.length > 1` (same actions as `GateDetailContent`);
  - divergence 3: the mobile sensor card normalizes string booleans (`"ON"`, `"OFF"`, `"OPEN"`, `"CLOSED"`, …) through the same category-aware formatter as real booleans.

## Out of scope (later phases)

- Migrating the other ~12 types (light, shutter/awning, thermostat, heater, gate, sensor, weather, energy meter, appliance, water valve, water heater, pool cover, camera, solar).
- Any change to the mobile detail sheet layout or `BottomSheet`.
- The `slider` control kind (needed by light/shutter/thermostat migration — designed now, wired later).
- Zone widgets (`ZoneWidget`, `MobileZoneCard`, `ZoneDetailSheet`).
- Visual redesign of any card: phase 1 is behavior-preserving for migrated types (except the two point fixes, which add missing behavior).

## Acceptance criteria

- [x] `resolveWidgetPresentation` exists, is a pure function (no hooks), and returns `null` for unmigrated types.
- [x] `switch`, `media_player`, `pool_pump` render identical desktop visuals as before (same state pill, same toggle button, same layout shell).
- [x] Mobile card for the three types shows the same icon and state as before, plus the pool pump daily runtime (new, divergence 1).
- [x] Mobile tap on the three types still fires the direct toggle with the same alias/value semantics, now derived from the descriptor.
- [x] Toggle-binding resolution for the three migrated types is category-first everywhere (fixes divergence 5 for these types).
- [x] Desktop gate widget with >1 enum actions renders one button per action; single-action gates keep the tap-the-card behavior (divergence 2).
- [x] A sensor emitting string `"ON"`/`"OPEN"` renders the same localized text as a boolean `true` on the mobile card (divergence 3).
- [x] All existing component tests pass unchanged (they pin the retro-compat contract).
- [x] New unit tests cover the resolver and the two point fixes (see plan.md).

## Edge cases

- Equipment with **no toggle order binding** → descriptor has `controls: []`; desktop shows no button, mobile tap does nothing (matches current behavior).
- Equipment **disabled** (`enabled: false`) → controls are surfaced in the descriptor but every surface suppresses interactive rendering (current `equipment.enabled` gate preserved — the surface owns this, the resolver stays state-pure).
- **Boolean-typed** toggle order vs **enum-typed** (`ON`/`OFF`, arbitrary case) → descriptor precomputes `onValue`/`offValue` (`enumValues` matched case-insensitively, fallback `"ON"`/`"OFF"`; boolean orders use `true`/`false`).
- `media_player` with no `input_source` binding → primary state falls back to `"ON"`/`"OFF"`.
- `pool_pump` with no `runtime_daily` computed → no secondary line (not `0s`).
- Gate with **zero** command binding → no buttons, no tap action (current behavior).
- Custom widget icon (`widget.icon` → `CUSTOM_ICON_REGISTRY`) keeps overriding the type icon on every surface (#318 contract).
