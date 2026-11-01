# Spec 194 — Architecture

## Contract — `src/shared/electric-vehicle-contract.ts`

`ELECTRIC_VEHICLE_ALIASES.chargePower = "charge_power"`, `EV_CHARGE_POWER_CATEGORY = "ev_charge_power"`, in the category map and the core list (data). `DataCategory` gains `ev_charge_power` (backend and UI types), its type is `number` (`constants.ts`), it is bindable on `electric_vehicle` (`bindingUtils.ts`), with an i18n category label.

## Evidence — `attribution.ts`

- `VehicleEvidence.powerSamples?`, `powerAgreeing?` (counts).
- `foldPower(evidence, carW, chargerW)` (pure): one sample; agreement within 30 % or 700 W.
- `powerAgrees(e)` / `powerDisagrees(e)`; `matches()` rejects a disagreeing car.
- `attribute(evidence, vehicleIds, context)`: context gains `energyWh` and `whPerPoint: ReadonlyMap<vehicleId, Wh>`. After a single match: power tie-break (`power-match`), then energy (`energy-match`), then usual vehicle.

## Tracker — `ev-session-tracker.ts`

- `OpenSession.powerLog`: the charger's power readings (time, W), last 3 h.
- A car's `charge_power` report (timed like its other reports) is folded into each open, drawing session with the charger's power at that time.
- `resolve()` and `givenBy()` pass the session's energy and each candidate car's learned energy per point (`whPerBatteryPoint` over `listForLearning`).

## Types

`EvSessionAttributionReason` gains `power-match` and `energy-match` (backend and UI).
