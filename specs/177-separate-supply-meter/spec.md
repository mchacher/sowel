# Spec 177 — A meter fed by a separate supply

**Status**: implemented
**Scope**: db + core (equipments, energy) + UI
**Follows**: [spec 091](../091-energy-submeters-by-usage/spec.md), [spec 117](../117-live-submeter-breakdown/spec.md), [spec 173](../173-nested-submeters/spec.md), issue #523

## Problem

Every consumption partition Sowel renders — the by-usage breakdown and the live
submeter donut — reconciles the enrolled submeters against the main meter:
`other = main − Σ submeters`, clamped at 0. That arithmetic assumes every
submeter measures energy that **flowed through the main meter**. Not every clamp
does.

The case that raised it: an EV charging socket fed from a **second utility
supply** — a different meter, a different subscription, physically outside the
circuit the main meter sees. Clamping it and binding the measurement enrols it
as a submeter (#523: enrolment is a blocklist, an `energy_meter` enrols on its
type alone), and three numbers go wrong at once:

- the partition shows a 3 kW slice the main meter never carried, and the
  residual `other` is eaten down to its clamp at 0 — during a charge the
  breakdown claims the household's unmetered loads consumed nothing;
- the slice is **costed** at the main meter's blended €/kWh (spec 123), pricing
  kilowatt-hours under a tariff that never billed them;
- the live donut (spec 117) does the same reconciliation in real time.

Spec 173 solved the neighbouring problem — a meter **inside** another one — by
declaring containment. This is the opposite topology: a meter **outside** the
main meter entirely. `meteringParentId` cannot express it: there is no parent;
the truthful declaration is "no meter here contains me, not even the main one".

There is no way to configure around it. The only levers are deleting the
equipment or not binding the measurement — trading a wrong partition for a lost
history, exactly the trade spec 173 refused.

## Design principle — declare the supply, don't hide the meter

The instinct is again a "hide this from the breakdown" tick box, and it is again
the wrong shape — the measurement is real and the household wants to see it.
What is true of the installation is that **this meter hangs off a different
supply**. Declare that, and each surface can do the right thing with it: keep
the measurement, keep its history, show it **beside** the house partition rather
than inside it.

## Goal

Let an equipment declare that it is fed by a separate supply, exclude it from
every reconciliation against the main meter, and render it apart — visible,
never summed.

## In scope

- `Equipment.separateSupply` — "my consumption does not flow through the main
  meter".
- By-usage: the equipment leaves the partition (Σ, `other`, cost) and comes back
  in a dedicated `separateSupply` list in the payload, kWh only.
- Live breakdown: same split — out of the donut and the residual, rendered in
  its own group.
- Validation: refused on the main meter and production types; a separate-supply
  meter is not an eligible `meteringParentId` target.
- An admin control on the equipment page next to the spec 173 containment
  control, and a hint on both breakdown surfaces saying the group is on its own
  supply.

## Out of scope

- **Zone aggregation (spec 170)**: unchanged, raw. A zone sums what its meters
  measure; the garage genuinely draws that power, whichever meter bills it.
- **A supply registry.** One boolean, not named supplies with their own main
  meters and tariffs. A household with two fully metered networks is a
  different feature; this describes the common case of a stray circuit.
- **Costing the separate supply.** Its tariff is unknown to Sowel; the group
  shows kWh and no €.
- **The equipment card and its cumuls** — unchanged, as in spec 173: a meter
  reads what it reads.
- **History API, Influx series, recipes**: unchanged. The measurement is
  historised exactly as before.

## Functional rules

1. **FR-1 — Declaration.** Any submeter-eligible equipment may carry
   `separateSupply: boolean`. Default `false`, which is what every existing
   installation gets on upgrade.

2. **FR-2 — Out of the reconciliation.** A separate-supply equipment
   contributes to neither surface's Σ, `other`, nor cost attribution — by-usage
   and the live donut behave as if it were not enrolled.

3. **FR-3 — Shown apart.** Both surfaces render the equipment in a dedicated
   group labelled as being on its own supply: by-usage as raw series (never net
   of children, no cost), the live breakdown as rows outside the donut.

4. **FR-4 — Refused declarations.** `400` when set on `main_energy_meter`,
   `energy_production_meter` or `solar_panel` — the reference and the
   production surfaces are what the reconciliation is _for_. `400` when an
   equipment names a separate-supply meter as its `meteringParentId` (extends
   spec 173 FR-5's eligible-parent rule).

5. **FR-5 — Containment yields.** Setting `separateSupply` on a meter that has
   containment children (or a parent) does not touch those declarations: the
   meter simply leaves the partition, so its children render whole again and
   its own `meteringParentId`, if any, stops being used. Clearing the flag
   restores the spec 173 arithmetic untouched.

## Acceptance criteria

- [x] An equipment can be given, and cleared of, `separateSupply` through
      `PUT /api/v1/equipments/:id`.
- [x] By-usage: with the flag set, the equipment leaves `submeters`, Σ and
      `other` return to what they were before the meter existed, and the
      equipment appears in `separateSupply` with its raw series and no cost.
- [x] Live breakdown: the donut and residual ignore the equipment; it renders
      in the separate group with its live power.
- [x] Setting the flag on the main meter or a production type is refused.
- [x] Declaring a separate-supply meter as `meteringParentId` is refused.
- [x] A separate-supply meter with containment children: children render whole,
      nothing is subtracted, nothing errors.
- [x] Existing installations are unchanged: flag absent, both surfaces
      byte-identical.

## Edge cases

| Case                                                                  | Behaviour                                                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Flag set on an equipment that is not a submeter (no metering channel) | Stored, and simply never used — nothing was being reconciled.                                        |
| Separate-supply meter goes stale/offline                              | Same freshness rules as any submeter row (#832), inside its own group.                               |
| Every enrolled meter is separate-supply                               | Partition renders `other = main` alone; the group carries all the meters.                            |
| Flag set while the equipment already had a `meteringParentId`         | Stored but unused (FR-5); clearing the flag re-applies it.                                           |
| No main meter configured                                              | As today: by-usage totals fall back to Σ submeters — the separate group is still kept out of that Σ. |
