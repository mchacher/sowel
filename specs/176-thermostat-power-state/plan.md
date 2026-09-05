# Spec 176 — Implementation plan

Branch: `fix/thermostat-power-state` (PR #904). Companion: `sowel-plugin-panasonic-cc` PR #2
(v2.3.2).

## Steps

1. **Shared** (`src/shared/binding-candidates.ts`): `POWER_STATE_ALIAS` constant;
   `inferDataBindingCategory(thermostat, powerState)` returns `appliance_state` (the spec 152
   override hook), which is what keeps the arbiter, the submeter integrator and every other
   category-first consumer correct with two power-ish bindings on one equipment.
2. **Aliasing** (`ui/src/components/equipments/bindingUtils.ts`):
   `resolveAlias` gains `valueType`; typed rule thermostat + category `power` + boolean →
   `POWER_STATE_ALIAS`; `TYPE_CATEGORY_ALIASES.thermostat = { toggle_power: "power",
temperature_outdoor: "outsideTemperature" }`; `RELEVANT_DATA.thermostat` gains
   `temperature_outdoor` / `setpoint` / `power`. Pass `data.type` at the two `computeBindingPlan`
   call paths and in `AddBindingModal`.
3. **Reader** (`ui/src/lib/thermostat-state.ts`): `thermostatPowerStateBinding`, preference
   powerState → legacy `power` when declared (or read) boolean → undefined.
4. **Surfaces**: swap the six `alias === "power"` on/off reads (ThermostatCard, useEquipmentState,
   EquipmentWidget, WidgetDetailSheet x2, WidgetGrid, ZoneWidget) onto the helper; ZoneWidget's
   relay fallback becomes value-aware; EnergyManagementPanel's `measuredW` lookup gains the
   numeric guard.
5. **Optimistic** (`ThermostatCard.tsx`): per-alias clearing keyed on the mirror binding's
   re-report (value or `lastUpdated`); the `power` order mirrors the run-state binding, or the
   not-yet-bound `powerState` alias when there is none; 90 s TTL as the backstop.
6. **Plugin** (`sowel-plugin-panasonic-cc`): `ON_DEMAND_DELAYS_MS = [10s, 45s]`, bump 2.3.2.
7. **Docs**: powerState paragraph in `docs/user/equipments.md` + `.fr.md` (Climate section).
8. **Index**: rows in `docs/specs-index.md` AND `docs/specs-index.fr.md`.

## Tests

- `src/shared/binding-candidates.test.ts`: the `appliance_state` override, scoped to thermostats.
- `bindingUtils.test.ts`: the four alias rules (boolean → powerState, wattage stays power,
  toggle_power order stays power, foreign outdoor key → outsideTemperature); full plan for a
  Panasonic-like device (spec 077 categories); `computeMissingBindings` offers `powerState`, not
  `power_2`, on the PAC scenario.
- `thermostat-state.test.ts`: preference, legacy fallback, declared-type recognition of a
  value-less binding, wattage rejection.
- `ThermostatCard.test.tsx`: ON from `powerState` with a numeric `power`; OFF actually sent when
  running; optimistic held through clamp pushes and reverted on run-state re-report; confirmed on
  agreement; held on an unmigrated submetered thermostat; TTL expiry; legacy boolean fallback.

## Rollout

1. Merge plugin PR, release v2.3.2, bump `plugins/registry.json` (chore PR, never a core release
   for the registry alone).
2. Merge core PR #904, release, deploy on authorization.
3. On the PAC: add the `powerState` binding via the equipment's missing-bindings panel (offered
   automatically).
