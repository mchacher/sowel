# Spec 129 — Implementation plan

## Steps (in order)

1. **Shared predicate** — `src/equipments/metering.ts`: `isMeteringSwitch(eq)`
   and `isSubmeterEquipment(eq)` (pure, typed on `Equipment` + bindings). No
   `any`.
2. **Binding** — `src/equipments/binding-candidates.ts`: extend the `switch`
   case to attach metering data keys (`power`/`energy`/`voltage`/`current`) to
   the single on/off candidate. Leave multi-channel and bare-relay paths
   unchanged.
3. **Energy integrator** — `src/energy/power-submeter-integrator.ts`: swap the
   `type === "energy_meter"` filters for `isSubmeterEquipment`. Keep the
   "already reports energy → don't integrate" guard.
4. **Verify history** — confirm the `energy`/`power` categories are historized by
   default so a switch's energy reaches InfluxDB; adjust the binding default if
   needed (no schema change).
5. **Tests** (see test plan) — binding-candidates, metering predicate,
   power-submeter-integrator.
6. **UI predicate** — `ui/src/lib/metering.ts`: mirror `isMeteringSwitch` /
   `isSubmeterEquipment` on `EquipmentWithDetails`.
7. **UI card** — `CompactEquipmentCard.tsx`: render live power for a metering
   switch (reuse solar/energy formatting), keep the toggle.
8. **UI submeter** — `submeter-helpers.ts`: `buildSubmeterRows` uses
   `isSubmeterEquipment`.
9. **Docs** — update `docs/user/equipments.md` + `docs/technical/data-model.md`.

## Task breakdown

- [x] `metering.ts` predicate + unit test
- [x] `binding-candidates.ts` switch metering attach + tests
- [x] `power-submeter-integrator.ts` submeter predicate + tests
- [x] history default verified (`power`/`energy` in `CATEGORY_DEFAULTS_ON`)
- [x] `ui/lib/metering.ts` + test
- [x] `CompactEquipmentCard` power display
- [x] `submeter-helpers` filter + test
- [x] docs

## Test Plan

### Modules to test

- `src/equipments/metering.ts` (predicate)
- `src/equipments/binding-candidates.ts` (switch metering binding)
- `src/energy/power-submeter-integrator.ts` (submeter inclusion)
- `ui/src/components/energy/submeter-helpers.ts` (`buildSubmeterRows`)

### Scenarios

| Module | Scenario | Expected |
| --- | --- | --- |
| metering | switch with power binding | `isMeteringSwitch` = true, `isSubmeterEquipment` = true |
| metering | switch with energy but no power | `isMeteringSwitch` = true (energy counts) |
| metering | bare switch (no metering) | both predicates false |
| metering | energy_meter | `isMeteringSwitch` false, `isSubmeterEquipment` true |
| binding-candidates | switch, device state+power+energy+voltage | one candidate: order `state` + dataKeys {state,power,energy,voltage} |
| binding-candidates | switch, device state only (bare relay) | one candidate: order `state`, dataKeys {state} — unchanged |
| binding-candidates | switch, device state+power only | candidate dataKeys include power |
| binding-candidates | multi-gang (state_l1,state_l2,power) | 2 candidates, NO metering attached |
| binding-candidates | light_onoff with power (regression) | unchanged — metering not attached to non-switch |
| power-submeter-integrator | metering switch power-only | integrated into energy like an energy_meter submeter |
| power-submeter-integrator | metering switch reporting energy | not integrated (already has energy) |
| power-submeter-integrator | energy_meter (regression) | unchanged |
| power-submeter-integrator | bare switch | ignored (not a submeter) |
| submeter-helpers | energy_meter + metering switch + bare switch | rows contain energy_meter + metering switch, exclude bare switch |
| submeter-helpers | metering switch power value | `readSubmeterPower` returns its power |

### Retro-compat

- Bare switches: identical binding, no card power, absent from energy views.
- `energy_meter`, `main_energy_meter`, submeter donut, energy history: unchanged
  for existing equipments.

## Manual verification (friend's instance / demo)

- Recreate a `switch` on a S60ZBTPF → card shows live power, plug appears in the
  submeter donut, energy accrues in the dashboard, on/off still works.
- A bare Zigbee relay switch is unchanged.
