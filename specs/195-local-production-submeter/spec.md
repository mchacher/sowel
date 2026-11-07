# Spec 195 — A submeter that sees local production

**Status**: implemented
**Scope**: db + core (equipments, energy, zones) + UI
**Follows**: [spec 091](../091-energy-submeters-by-usage/spec.md), [spec 117](../117-live-submeter-breakdown/spec.md), [spec 179](../179-separate-supply/spec.md), issue #1116

## Problem

A power-only submeter (a Legrand GEM clamp bound to an `energy_meter`) can sit
upstream of a generator: a small solar panel on the pool house roof is wired
behind the pool meter. When the pool draws less than the panel produces, the
clamp reads **negative watts** — a physical reading, not a fault.

`PowerSubmeterIntegrator` integrates `|P|` (spec 091, built for clamps wired
backwards). Measured on production, 2026-10-26 → 11-07: the pool drew 32.2 kWh,
the panel produced 1.6 kWh, the "Piscine" slice showed 33.8 kWh.

- **By-usage**: the slice carries the production as consumption; `other`
  (house − Σ submeters) loses the same amount; cost moves with it. The house
  total is right — it comes from the grid meter.
- **Production, self-consumption, household**: the panel's output reaches the
  grid meter (it lowers imports or adds to exports) but never the
  `energy_production_meter`. `autoconso = solar − injection` and
  `household = max(0, grid) + autoconso` are under-estimated by it, on the
  history and on the Live page (`house = grid + solar`).

## Design principle — declare the generator, don't guess from the sign

The sign alone cannot tell a backwards clamp from a producing circuit; guessing
would turn every miswired clamp into a phantom generator. What is true of the
installation is "a generator is wired behind this meter". Declare that, opt-in,
and read the sign accordingly on that meter only.

## In scope

- `Equipment.localProduction` (migration `041`), editable in the metering panel,
  refused on the house total / production types and with `separateSupply`
  (that panel's output never reaches the main meter), checked on the resulting
  state like spec 179; refused on a meter with its own energy counter
  (`LocalProductionNotPowerOnly`), since only power-derived energy can be split
  by sign. Every surface reads it through `countsLocalProduction` (declared, on
  the house supply, power-only), mirrored in the UI.
- Integrator, flagged meters only: each trapezoid is split at its zero crossing.
  The positive area stays `energy` (the slice, the computed cumuls); the
  negative area is written as a separate `production` delta on the submeter and
  emitted on the event bus, stamped with the minute of its point. A meter that
  alternates between drawing and producing is split interval by interval.
- `SelfConsumptionWriter`: a flagged meter's `production` delta is added to the
  minute's solar. `autoconso`, `injection` and `household` follow from the
  existing arithmetic; `autoconso + injection ≤ solar` still holds. A minute
  holding local production but no grid tick carries it into the next written
  minute (the integrator flushes on its own clock); the production meter's own
  solar-only minutes are still dropped, as before.
- `/energy/history`: `prod` adds the `production` series of every submeter
  without a binding of that name, whatever its current flag — unticking must
  not strip past production that the autoconso written at the time still holds.
- Live: a flagged row shows `max(0, P)`; the Live diagram adds the negative part
  of flagged, current readings to solar.
- Zone power sum counts `max(0, P)` for a flagged meter. **This amends #1116**,
  which found the signed sum correct: the sum is the zone's loads, a net export
  displayed as a negative load reads as a wiring fault, and the panel's output
  now shows on the Live solar flow.

## Out of scope

- **History backfill.** Applies from the moment the flag is set.
- **No production meter configured.** The self-consumption writer is inert
  without one (it is where `autoconso` lives); local production is then
  historised on the submeter but not reconciled.
- **Meters with their own energy counter.** A cumulative `energy` binding cannot
  go negative; the flag only changes power-derived integration.
- **Production cumuls on the dashboard tile** (`energy_day` of the production
  meter): per-equipment, unchanged.
- **PV forecast / health**: they model the declared array, which this panel is
  not part of.
- **The energy display feed** (`GET /equipments?role=submeter`) still serves the
  raw signed power; the display firmware keeps its own reading. Follow-up.
- **Nested meters.** A parent clamp (spec 173) also sees the panel and is not
  split; the flag belongs on the innermost meter carrying the panel. Documented,
  not enforced.
- **A clamp measures net.** While the panel covers part of the circuit's draw,
  that part is in neither the slice nor production. Only a clamp on the panel
  itself could see it.
- **A main meter posting aligned 30-minute windows** (Netatmo / Legrand): the
  per-minute pairing is approximate there; the carry-over keeps the energy, not
  its exact minute.

## Acceptance criteria

- Flagged: slice = positive energy only; negative energy written as `production`.
- Local production raises `autoconso`, `household` and `/energy/history` `prod`.
- Live row, Live diagram and zone power take it into account.
- Unflagged meters unchanged (`|P|`), covered by regression tests.
