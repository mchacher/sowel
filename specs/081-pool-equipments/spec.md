# Spec 081 — Pool Equipments + Smart Device Binding

## Summary

Introduce two new dedicated equipment types — `pool_pump` and `pool_cover` — for pool-specific use cases. Functionally identical to `switch` / `shutter`, but with dedicated UI, dedicated order categories (so recipes and zone orders can isolate pool from other equipment), and derived data (daily pump runtime, cover state).

Alongside, overhaul the device-to-equipment binding UX to support the "1 device → N equipments" scenario (e.g. a Tasmota 4CH Pro split into a pump + a spot + a shutter). Today the UI greys-out a device as soon as ANY binding exists on it, preventing multi-equipment splits that the backend already supports.

Also fix the `water_valve` dashboard widget: missing custom icon and no ON/OFF action.

## Problem

### Pool equipment

Sowel's equipment abstraction is strict: "a Device is what's on the network, an Equipment is what's in the room". For a pool installation, the user needs:

- Visual distinction on the dashboard (pool pump / pool cover vs generic switch / shutter).
- Dedicated order categories so pool equipment can be targeted by recipes and zone orders without side effects on window shutters or other switches.
- Runtime analytics for the pump (daily filtration time).
- At-a-glance cover state (open, closed, moving).

Reusing existing `switch` and `shutter` types would mix concerns and leak pool behavior onto unrelated equipment.

### Multi-equipment per device

A Tasmota 4CH Pro with 4 relays (plus a shutter configuration on 2 of them) naturally maps to 3 distinct Sowel equipments (e.g. pump on POWER1, spot on POWER2, pool cover on the shutter from POWER3+4). The backend supports this (no uniqueness on `device_id` in binding tables), but:

- The equipment creation UI offers no way to pick which data/orders to bind — it auto-binds everything on a device.
- Once any binding exists on a device, the `DeviceSelector` hides that device, blocking further splits.

### water_valve widget

The existing `WaterValveIcon` doesn't render on the dashboard (wrong registry plumbing), and the widget card has no ON/OFF toggle — the user cannot control a water valve from the dashboard.

## Requirements

### Pool equipment

**R1 — Equipment types**

- `pool_pump` — ON/OFF (same behavior as `switch`).
- `pool_cover` — position 0-100 + OPEN/CLOSE/STOP (same behavior as `shutter`).

**R2 — Widget family**

- New `WidgetFamily` value: `pool`.
- `WIDGET_FAMILY_TYPES.pool = ["pool_pump", "pool_cover"]`.
- No zone orders for `pool` in this spec (deferred).

**R3 — Order categories (dedicated)**

- `pool_pump_toggle` — enum ON/OFF.
- `pool_cover_move` — enum OPEN/CLOSE/STOP.
- `pool_cover_position` — number 0-100.

**R4 — Derived / computed data**

- `pool_pump.runtime_daily` — total seconds ON since local midnight, persisted across restarts.
- `pool_cover.cover_state` — derived from position + direction: `OPEN` / `CLOSED` / `PARTIAL` / `MOVING` / null.

**R5 — Dashboard widgets**

- Custom icons `PoolPumpIcon({ on })` (Design F) and `PoolCoverIcon({ position })` (Design G) — already designed.
- Widget card displays icon + textual info:
  - pool_pump: `"Pompe · 3h 45m"` (state + runtime_daily)
  - pool_cover: `"Ouvert 75%"` (derived state + position)
- Primary action button:
  - pool_pump: ON/OFF toggle
  - pool_cover: open / close / stop

**R6 — Detail page**
Reuse the standard `EquipmentDetailPage` — the new icons render automatically via the registry, and the computed data surfaces in the standard "Capteurs" section.

**R7 — Zone integration**
Pool equipments render like any other equipment in the zone view. No family summary banner, no zone orders targeting `pool`.

### Binding UX overhaul

**R8 — Smart binding candidates**

When the user picks a device + equipment type during equipment creation (or adds a binding post-creation), Sowel computes a list of **binding candidates**: groups of device data/orders that match the equipment type.

- 1 candidate → auto-bind (current behavior preserved).
- N candidates → picker UI, user selects which candidate to bind.

Candidate grouping by equipment type:
| Equipment type | Candidate = |
|----------------|-------------|
| `pool_pump`, `switch`, `light_onoff` | each ON/OFF enum data/order (e.g. `power1`, `power2`) |
| `light_dimmable` | pair (ON/OFF + brightness) that share a root key |
| `pool_cover`, `shutter` | shutter group (position + state/move under same index) |
| `thermostat` | group (power + setpoint + current_temperature) |
| `sensor` | all data (sensors are inherently multi-valued) |
| … | existing behavior for the rest |

**R9 — Device filtering**

In `DeviceSelector` (equipment creation) and the `AddBindingModal`:

- A device is shown only if it still has ≥ 1 free candidate for the current equipment type.
- A candidate is "free" if no `order_binding` or `data_binding` consumes its primary order/data yet.
- Optional UX hint: badge showing number of free slots.

This replaces the current "hide device if any binding exists" rule.

**R10 — Binding category override**

Add a nullable `category_override` column to `order_bindings`. When a binding is created on a pool equipment, Sowel automatically sets the override to the appropriate `pool_*` category based on the bound order's shape:

- pool_pump + enum [ON, OFF] → `pool_pump_toggle`
- pool_cover + enum with OPEN/CLOSE/STOP → `pool_cover_move`
- pool_cover + number 0–100 → `pool_cover_position`

For non-pool equipments, no override (existing behavior).

**R11 — Retagging on equipment type change**

When `EquipmentManager.update(id, { type })` changes the equipment type, Sowel re-runs the override inference on every existing order_binding of the equipment and updates the `category_override` column accordingly.

### water_valve widget fix

**R12**

- `WaterValveIcon({ open: boolean })` refactored into `WidgetIcons.tsx` with state-based visuals.
- Dashboard widget card for `water_valve` shows ON/OFF toggle (same pattern as `switch`).
- Registry `previewProps` updated to `{ open: false }`.

## Acceptance Criteria

### Pool equipment

- [ ] AC1: `pool_pump` + `pool_cover` in `EquipmentType` (backend + UI types).
- [ ] AC2: `pool` added to `WidgetFamily` with types `["pool_pump", "pool_cover"]`.
- [ ] AC3: 3 new `OrderCategory` values: `pool_pump_toggle`, `pool_cover_move`, `pool_cover_position`.
- [ ] AC4: `PoolPumpIcon({ on })` and `PoolCoverIcon({ position })` implemented, registered.
- [ ] AC5: `runtime_daily` tracked per pump, persisted, reset at local midnight.
- [ ] AC6: `cover_state` derived automatically at read time.
- [ ] AC7: Dashboard widget displays info + action for both types.
- [ ] AC8: Equipment detail page renders correctly (no structural changes).

### Binding UX

- [ ] AC9: `computeBindingCandidates(equipmentType, device)` backend function returns correct candidates for each type.
- [ ] AC10: `EquipmentForm` auto-binds if 1 candidate, shows picker if N.
- [ ] AC11: `DeviceSelector` only lists devices with ≥ 1 free candidate for the current type.
- [ ] AC12: `AddBindingModal` follows the same filtering rule.
- [ ] AC13: `category_override` column added to `order_bindings` via migration.
- [ ] AC14: Binding to a pool equipment auto-sets the override.
- [ ] AC15: Changing equipment type re-infers all bindings' overrides.
- [ ] AC16: `getOrderBindingsWithDetails` returns `COALESCE(category_override, device_orders.category)` as effective category.
- [ ] AC17: Tasmota 4CH Pro test case: 3 equipments (pump + spot + cover) can be created from the same device.

### water_valve fix

- [ ] AC18: `WaterValveIcon({ open })` in WidgetIcons.tsx with proper light/dark rendering.
- [ ] AC19: Dashboard widget for water_valve has functional ON/OFF toggle.

## Scope

### In scope

- 2 new equipment types + 3 new order categories + new `pool` widget family.
- 2 new custom SVG icons (already designed: F and G) + refactored `WaterValveIcon`.
- Daily runtime tracker for pool_pump + cover_state deriver for pool_cover.
- `computeBindingCandidates` logic + EquipmentForm & AddBindingModal UX update.
- `category_override` on `order_bindings` + auto-routing + re-tag on type change.
- water_valve widget fix (dashboard action + icon).
- Tests: tracker, deriver, candidates, override inference.

### Out of scope

- Zone orders for `pool` family (`allPoolPumpsOn` etc.) — deferred.
- Business recipes for pool (filtration schedule, cover automation) — separate specs.
- Migration of existing switch/shutter equipments to pool types (user-driven if desired).
- Multi-shutter devices on pool (1 cover per equipment; multi-shutter per physical Tasmota = create N equipments manually).

## Edge Cases

- **Pump device offline while ON** — tracker pauses accumulation; on OFF event after coming back, it adds `(offline_time_end − stateSince)` clipped to "last known activity" ≈ the time it went offline. Safer to treat the offline window as OFF to avoid over-counting.
- **Cover position unknown at startup** — `cover_state = null` until first value arrives.
- **DST transition** — local-time `getHours() === 0` detection handles 23h/25h nights naturally.
- **Position = 50 with direction = 1** (actively opening) → `MOVING` takes priority over `PARTIAL`.
- **Equipment type change (`switch` → `pool_pump`)** — all order_bindings have their override recomputed. `category_override` is cleared to `null` if the new type doesn't require overriding.
- **Daily runtime reset while backend was down** — on startup, if `last_reset_date` in DB differs from today's local date, reset `cumulative_seconds_today` to 0 before re-subscribing to events.
- **Device fully bound** — DeviceSelector hides it for the current type. If the user needs to un-bind something first, they delete the binding from the existing equipment, making the candidate free again.
- **Device exposes only 1 candidate for the type** — auto-bind preserves today's UX; user doesn't see a picker.
