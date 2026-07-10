# Spec 129 — Architecture

## Data model

**No schema change.** No new `EquipmentType`, no new `DataCategory`, no
migration.

- `power`, `energy`, `voltage`, `current` already exist as `DataCategory`.
- The `switch` equipment simply gains **optional** data bindings of those
  categories, in addition to its on/off order binding.
- "Metering switch" is not a stored flag — it is derived at runtime:
  `type === "switch"` **and** has a `power` (and/or `energy`) binding.

Shared predicate (new), used by both backend and UI so the definition stays in
one place conceptually:

```
isMeteringSwitch(eq)      = eq.type === "switch" && hasBinding(eq, category "power" | "energy")
isSubmeterEquipment(eq)   = eq.type === "energy_meter" || isMeteringSwitch(eq)
```

## Binding — `binding-candidates.ts` (`switch` case)

Current: one candidate per on/off order, `dataKeys` = matching state key only.

New: after collecting the on/off order candidates, **if there is exactly one
on/off channel**, append the device's metering data keys (categories `power`,
`energy`, `voltage`, `current`) to that single candidate's `dataKeys`.

```
switch case:
  onOffOrders = deviceOrders.filter(isOnOffOrder)
  candidates  = onOffOrders.map(o => { state data key + order key })
  if candidates.length === 1:
     meteringKeys = deviceData.filter(d => d.category ∈ {power,energy,voltage,current}).map(d => d.key)
     candidates[0].dataKeys.push(...meteringKeys)   // deduped
  return candidates
```

- Bare relay → no metering data → unchanged.
- Multi-gang (≥2 on/off orders) → no metering attached (out of scope).
- Binding alias defaults to the device data key (`power`, `energy`, …), which is
  exactly what the energy pipeline keys off (`alias === "energy"`).

## Energy history — no backend change

`energy-aggregator.ts` triggers on `equipment.data.changed` where
`alias === "energy"` and reads InfluxDB rows filtered by `category == "energy"`.
`history-writer` persists bindings by category/`historize` flag, **not** by
equipment type. So once a switch has an `energy` binding, energy points are
written and aggregated identically to an `energy_meter`. **Verify** the `energy`
category is historized by default; if not, ensure the binding is historized.

## Power-only submeters — `power-submeter-integrator.ts`

The integrator derives `energy` from `power` for submeters that report power but
no energy. It currently filters `type === "energy_meter"` (lines ~142, ~196).

Change: replace the `type === "energy_meter"` checks with `isSubmeterEquipment`
so a **metering switch that reports power but not energy** also gets integrated
energy. A metering switch that already reports `energy` is not integrated
(it already has the alias, same guard as today for energy_meters that report
energy directly).

## UI — live power on the card

`ui/src/components/home/CompactEquipmentCard.tsx`: today gated by
`isEnergyMeter`. Add: for a `switch` with a `power` binding, render the live
power headline (reuse the existing solar/energy value formatting: W below 1000,
kW above). On/off toggle stays. Basic switch (no power binding) → unchanged.

## UI — submeter breakdown

`ui/src/components/energy/submeter-helpers.ts` `buildSubmeterRows` filters
`eq.type === "energy_meter"`. Change the filter to `isSubmeterEquipment(eq)`
(energy_meter OR metering switch). `readSubmeterPower` already reads the `power`
binding, so it works unchanged for switches. `LiveSubmeterBreakdown` needs no
change.

## Event flow (metering plug)

```
z2m message (power/energy/state)
  → z2m plugin → DeviceManager.updateDeviceData
    → equipment.data.changed  (alias: power / energy / state)
      → EquipmentManager (bindings incl. metering)
      → history-writer  → InfluxDB (power, energy)
      → energy-aggregator (alias=energy) → downsampled buckets
      → power-submeter-integrator (if power-only) → derived energy
    → WebSocket → UI: card power value + submeter donut slice
```

## Files changed

| File | Change |
| --- | --- |
| `src/equipments/binding-candidates.ts` | `switch` case attaches metering data on single-channel plugs |
| `src/equipments/metering.ts` (new, small) | `isMeteringSwitch` / `isSubmeterEquipment` helpers (shared, pure) |
| `src/energy/power-submeter-integrator.ts` | use `isSubmeterEquipment` instead of `type === "energy_meter"` |
| `ui/src/components/home/CompactEquipmentCard.tsx` | live power for a metering switch |
| `ui/src/components/energy/submeter-helpers.ts` | include metering switches in `buildSubmeterRows` |
| `ui/src/lib/metering.ts` (new, small) | UI mirror of the metering predicate |
| `docs/user/equipments.md`, `docs/technical/data-model.md` | document metering-aware switch |

No API route or WebSocket contract change (existing `equipment.data.changed`
and equipment payloads already carry the bindings).
