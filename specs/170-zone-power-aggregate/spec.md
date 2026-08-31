# Spec 170 — A zone sums the power its submeters measure

**Status**: implemented
**Scope**: core (zone aggregation) + UI (zone pills)

## Problem

A zone already answers "how warm is it here", "is anyone here", "are the shutters open". It cannot answer **"how much is this part of the house drawing right now"**, even when every watt of the answer is already in the engine.

The trigger is a guest house metered by two clamps: one on the flat's own feed, one on the cooking hob, which is fed from the main house board and therefore sits outside the first measurement. Both are `energy_meter` equipments, both are in the guest-house zone, both report `power` every 45 s. The total exists in the data and nowhere on the screen.

There is no way to produce it today, and the workarounds all fail for a structural reason:

- **One equipment cannot carry both.** A `dataBinding` alias is UNIQUE per equipment (SQL constraint; `addDataBinding` answers 409 `Alias "power" already exists on this equipment`). Two `power` channels on one meter is not expressible.
- **The zone aggregate has no power field.** `ZoneAggregatedData` carries temperature, humidity, luminosity, motion, openings, lights, shutters, water valves, displays — and `waterFlowTotal`, a sum with exactly the shape this needs.
- **Charts cannot do it.** `SavedChartConfig` is a list of `{equipmentId, alias, color}`; there is no stacking and no arithmetic between series.
- **Recipes cannot do it.** `RecipeContext` exposes `equipmentManager`, `zoneAggregator` and `dispatchOrder` — it can read and it can act, it cannot write a measurement.

So the only place the sum can live is where every other zone-level answer already lives.

## Design principle — the zone sums what it already refuses to double-count

The engine already owns the "is this a consumption submeter" question, in one place: `isSubmeterEquipment` (issue #523), a blocklist that enrols any equipment carrying a numeric power/energy channel except the grid total and the two production surfaces. Reusing it means the zone sum and the by-usage breakdown always agree on **what counts as a load** — the same decision, taken once.

The same applies to freshness. `classifyPowerReading` (issue #832) exists precisely because a `power` binding can carry a value of unbounded age on an equipment that is nominally online, and a stale `0 W` reads as "this appliance is off". That rule was restated per surface once already, and the two surfaces then described the same appliance two contradictory ways (#744). This spec adds a third surface and restates nothing.

## Goal

Give every zone a live sum, in watts, of the loads its submeters measure — its own and its descendants'.

## In scope

- `ZoneAggregatedData.powerTotal: number | null` — watts, `null` when the zone has nothing current to sum.
- Accumulation in `ZoneAggregator`, inheriting the existing descendant merge and the existing offline early-out.
- A power pill on the zone header, next to the other counters.
- Tests covering inclusion, exclusion, staleness and the descendant roll-up.

## Out of scope

- **Energy (Wh/kWh) per zone.** Cumulative energy is computed per equipment from InfluxDB by `EnergyAggregator`; a zone-level cumul is a different, heavier feature (bucket queries, downsampling, tariff split) and belongs in its own spec.
- **The double-counting question.** When a zone holds both a feed meter and a submeter of a load fed by it, the sum counts that load twice — the same way the by-usage residual does today. Sowel has no meter hierarchy and no "detail, do not count" flag; introducing one is a larger design (see "Open question") and would change the existing by-usage breakdown, which this spec leaves untouched.
- **Recording the zone total.** Nothing is written to InfluxDB; `powerTotal` is derived on every aggregation pass like every other field of `ZoneAggregatedData`.
- **A power figure anywhere else** — Dashboard widgets, the Energy page, the mobile zone sheet.

## Functional rules

1. **FR-1 — What counts.** An equipment contributes when all three hold: `isSubmeterEquipment(type, dataBindings)` is true, it has a binding whose alias is `power` with a `number` value, and `classifyPowerReading` returns `current` for it. The grid meter, production meters and solar panels never contribute (`NON_SUBMETER_TYPES`), so the root zone sums the loads of the house and not the house total plus its own parts.

2. **FR-2 — Descendants included.** A zone's `powerTotal` covers itself and every descendant zone, through the existing accumulator merge. The guest house totals its flat feed and the hob in its `RDC > Salle à manger` child without either being restated.

3. **FR-3 — Null, not zero.** A zone with no contributing equipment reports `null`, not `0`. `0` is a measurement — every submeter reporting zero watts — and a zone with no meters at all has not measured anything. Same contract as `waterFlowTotal`.

4. **FR-4 — Stale readings are dropped, not zeroed.** A submeter whose last `power` is older than its freshness budget is excluded from the sum. It is not counted as `0 W`: the load may well be running. A zone whose only submeter has gone stale therefore reports `null`.

5. **FR-5 — Offline equipments are already excluded.** The aggregator's existing early-out skips an equipment whose status is `offline` and records its bindings in `unavailableByCategory`. Power inherits that behaviour unchanged, so the existing "(N unavailable)" hint covers a missing meter with no new plumbing.

6. **FR-6 — Negative readings are summed as they are.** A clamp mounted backwards reports negative watts. The sum does not take an absolute value and does not clamp at zero: a negative total is a wiring fault the user needs to see, and hiding it is how a fault stays invisible. (`PowerSubmeterIntegrator` integrates `|P|` for energy, spec 091 — that is a different question: it protects a cumulative counter from running backwards.)

7. **FR-7 — Rounding.** The sum is rounded to one decimal, like `waterFlowTotal` is rounded to two, so a float artefact does not make the pill flicker between `39.400000000000006` and `39.4`.

## Acceptance criteria

- [x] A zone holding one `energy_meter` reporting 39.4 W has `powerTotal === 39.4`.
- [x] A zone holding a meter at 39.4 W and a child zone holding one at 8.2 W has `powerTotal === 47.6`.
- [x] A zone holding no metered equipment has `powerTotal === null`.
- [x] A zone holding only the `main_energy_meter` has `powerTotal === null`.
- [x] A zone holding only an `energy_production_meter` has `powerTotal === null`.
- [x] A metering `switch` (a plug reporting `power` alongside `state`) contributes.
- [x] A submeter whose `power` binding is older than its freshness budget does not contribute.
- [x] A submeter whose equipment is `offline` does not contribute and is counted in `unavailableByCategory`.
- [x] The zone header shows a power pill when `powerTotal !== null`, and no pill when it is `null`.

## Edge cases

| Case                                           | Behaviour                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `power` binding present but value is `null`    | Not a number → excluded (FR-1)                                         |
| `power` binding present but value is a boolean | Excluded — a thermostat's on/off "power" is a state, not a measurement |
| Equipment has `energy` but no `power`          | Excluded from `powerTotal`; it still counts as a submeter elsewhere    |
| Every contributing submeter reads exactly 0 W  | `powerTotal === 0` — measured, and distinct from `null`                |
| Zone tree deeper than two levels               | Rolled up at every level by the existing merge                         |
| A submeter appears in two zones                | Impossible — an equipment has exactly one `zoneId`                     |

## Open question (not resolved here)

When a feed meter and a submeter of one of its loads share a zone, the load is counted twice — in the zone sum, and in the by-usage residual `total − Σ submeters`. The fix is a meter hierarchy (a submeter declaring its parent) or a "detail" flag excluding an equipment from enrolment. Both change the existing energy breakdown and deserve their own spec; this one deliberately reproduces today's behaviour rather than inventing a second, divergent rule.
