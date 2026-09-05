# Spec 176 — Architecture

## The alias is a shared constant, the category is overridden

`POWER_STATE_ALIAS = "powerState"` lives in `src/shared/binding-candidates.ts` next to
`SOLAR_STATE_ALIAS` (the spec 152 precedent for a reserved binding-role alias), imported by both
sides.

The binding does NOT keep the device's `power` category. `inferDataBindingCategory` (the spec 152
override hook applied by `EquipmentManager.addDataBinding` and returned through
`COALESCE(category_override, dd.category)`) tags a thermostat's `powerState` binding
**`appliance_state`**. This one line is what keeps the backend correct by construction: without it a
submetered thermostat carries TWO `category === "power"` bindings (one boolean, one wattage) and
every category-first consumer picks whichever row comes first in insertion order:

- `capacity-arbiter.isStateAlias` recognizes `appliance_state` as the run state (first clause of its
  chain), so on/off observation, `endUnclaimedRun` and divergence detection keep working on a
  rebound PAC.
- `capacity-arbiter.isPowerAlias` / `resolveMeter`, `power-submeter-integrator`
  (`catchUpFromBindings`, `isPowerOnlySubmeter`) and the UI `EnergyManagementPanel` never see the
  boolean in their `category === "power"` lookups, so the clamp keeps feeding live draw, the load
  learner and the derived energy counter. (`EnergyManagementPanel` additionally gained the numeric
  guard `pickLivePowerBinding` already had.)

## Where the alias is decided

Alias resolution is a UI concern: bindings are created by the UI (auto-binding plan, missing-bindings
panel, AddBindingModal) through the generic `POST /equipments/:id/bindings` API, and the backend
stores whatever alias it is given. So the whole change lives in
`ui/src/components/equipments/bindingUtils.ts`:

- `resolveAlias(key, equipmentType, categoryMap?, category?, valueType?)` gains the `valueType`
  parameter. One typed rule, checked first: on a `thermostat`, a data point with category `power`
  AND type `boolean` resolves to `powerState`. A numeric `power` (a clamp) is untouched. The rule
  needs the value type because BOTH readings carry category `power`; category alone cannot
  discriminate, which is why this is not a `TYPE_CATEGORY_ALIASES` entry.
- `TYPE_CATEGORY_ALIASES.thermostat = { toggle_power: "power" }` keeps the power ORDER on the alias
  ThermostatCard drives (the global map would alias it `state`).
- `RELEVANT_DATA.thermostat` gains the spec 077 categories: `temperature_outdoor`, `setpoint`,
  `power`.

All three call paths feed through the same `resolveAlias`, so the candidate-based path, the legacy
whitelist path, `computeMissingBindings` and the AddBindingModal suggestion agree by construction.
On the PAC, `computeMissingBindings` now offers the unbound Panasonic boolean as `powerState`
instead of a dead `power_2`.

## One reader

`ui/src/lib/thermostat-state.ts`:

```ts
thermostatPowerStateBinding(bindings): DataBindingWithValue | undefined
```

Preference order: the `powerState` alias; else a `power` binding whose value is a boolean (legacy
thermostats bound before this spec); else undefined. A wattage can never be returned. Used by every
surface that derived a thermostat's on/off state from `power === true`:

| Surface                                       | Call                                |
| --------------------------------------------- | ----------------------------------- |
| `ThermostatCard.tsx` (full + compact card)    | `isOn`                              |
| `useEquipmentState.ts`                        | thermostat branch of `isOn`         |
| `EquipmentWidget.tsx` (climate widget)        | `isOn`                              |
| `WidgetDetailSheet.tsx` (aggregate + control) | `on` / `isOn`                       |
| `WidgetGrid.tsx` (heating family icon)        | `anyOn`                             |
| `ZoneWidget.tsx` (climate aggregate)          | `on`, with its state-alias fallback |

## Per-alias optimistic clearing

`ThermostatCard` kept optimistic overrides (`setOptimistic`) and cleared ALL of them as soon as any
binding value changed. On a submetered thermostat the clamp changes value every few seconds, so the
optimistic power state died long before a cloud thermostat's next poll could confirm it.

The effect now clears one optimistic key when ITS mirror binding is re-reported, where re-reported
means value OR `lastUpdated` moved (the store stamps `lastUpdated` on every `equipment.data.changed`,
which the engine re-emits even for unchanged values). The truth then either confirms the optimistic
value (same value) or reverts it (the device did not obey). The mirror of the `power` order is the
binding `thermostatPowerStateBinding` returns; when none exists (the unmigrated submetered PAC), the
mirror is the not-yet-bound `powerState` alias, never the numeric `power` binding, so the clamp
cannot wipe the toggle on an equipment that has no state to confirm it with.

Two boundedness rules keep an optimistic value from outliving reality:

- a mirror that reports clears it (next poll: 10 to 45 s with the plugin's on-demand polls, 300 s
  worst case);
- a **90 s TTL** armed in `exec` clears it when nothing ever reports (no state binding yet, device
  offline, order rejected upstream). This also covers optimistic keys with no data binding at all,
  such as a setpoint order on a thermostat whose `targetTemperature` was never bound: before this
  spec those were wiped by the next unrelated push, and with per-alias clearing alone they would
  have stuck forever.

## Aggregate fallbacks

`ZoneWidget`'s heating aggregate had a fallback that marked the zone warm when a `state`/
`light_state` binding merely EXISTED. It was unreachable while every thermostat had some `power`
binding; the helper made it reachable for a submetered thermostat without `powerState`, so it now
reads the state's VALUE (`true` / `"ON"`).

## What is intentionally untouched

- **Backend schema**: no migration, no new event, no new category value (`appliance_state` already
  exists in `DataCategory`).
- **Metering**: `pickLivePowerW`/`pickLivePowerBinding` filter on `typeof value === "number"` and
  never see the boolean; the category override keeps it out of their category lookups anyway.
- **Order-confirmation tracker (#901)**: its preference chain (binding on the ordered device, then
  cross-device binding, then the device's own data under the order key) lands on the device mirror
  for the PAC with or without a `powerState` binding. Teaching rule 1 the `powerState` alias would
  only shortcut a path that already confirms.
- **`createWithAutoBindings`** (the backend `POST /equipments` with `deviceIds` path) still binds
  alias = raw key and applies none of the UI alias conventions (`setpoint`, `temperature`,
  `powerState`). Pre-existing inconsistency, out of scope: unifying `resolveAlias` into
  `src/shared/` the way spec 150 unified the candidates is the follow-up that would close it.
- **Existing installs**: nothing is renamed. The PAC gains its state the day the owner adds the
  offered `powerState` binding; legacy thermostats with a boolean `power` keep working through the
  helper's fallback (declared type, so a value-less binding at boot still counts).
