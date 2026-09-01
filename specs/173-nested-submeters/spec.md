# Spec 173 — A meter that sits inside another one

**Status**: implemented
**Scope**: db + core (equipments, energy) + UI
**Follows**: [spec 091](../091-energy-submeters-by-usage/spec.md), issue #523

## Problem

The by-usage breakdown treats every metered equipment as one slice of the household total: `other = total − Σ submeters`. That arithmetic assumes the submeters are **disjoint**. Real switchboards are not.

The case that raised it: a gîte is measured by one clamp, and its water heater — fed from that same gîte board — by a second one. Both are `energy_meter` equipments, so both are submeters, and the heater's kilowatt-hours are counted **twice**: once in the gîte's slice, once in its own. On a night cycle that is 2.09 kWh double-counted out of a 12.3 kWh day, and `other` is silently deflated by the same amount, since it is the residual.

There is **no way to configure around it**. `isSubmeterEquipment` is a blocklist (#523): an `energy_meter` enrols on its type alone, and any equipment carrying a numeric power/energy channel enrols too. The only levers are deleting the measurement or switching off its historisation — trading a wrong number for a lost history.

## Design principle — declare containment, not exclusion

The instinct is a "hide this from the breakdown" tick box. It answers the wrong question: the gîte meter is not noise, it measures something real, and hiding it would drop that consumption into `other` where it explains nothing.

What is true of the installation is that **one meter is inside another**. Declare that, and the breakdown can do the arithmetic it was always meant to do: each slice shows what is its own, and the slices add up to the whole again.

## Goal

Let an equipment declare that its consumption is already counted by another meter, and make the by-usage breakdown subtract accordingly.

## In scope

- `Equipment.meteringParentId` — "my consumption is included in that meter's".
- By-usage: a parent's series becomes `parent − Σ(direct children)`, clamped at 0; the residual `other` follows.
- Validation: unknown parent, self-reference, cycles, and parents that are not submeters.
- An admin control on the equipment page, and a legend hint saying a slice is shown net.

## Out of scope

- The equipment **card** and its hour/day/month cumuls, which keep showing what the clamp measures. A meter reads what it reads; only the _partition_ needs the subtraction, and a card contradicting its own sensor would be worse than the problem.
- Zone aggregation (spec 170) and the history API: unchanged, raw.
- Any automatic detection of containment. A switchboard is not discoverable from measurements; only the person who wired it knows.
- Production and the main meter: they are not submeters and cannot be a parent (nothing is "inside" the house total in a way the breakdown could use).

## Functional rules

1. **FR-1 — Declaration.** Any equipment may carry `meteringParentId`, naming another equipment whose meter already includes its consumption. `null` (the default) means "counted nowhere else", which is what every existing installation gets on upgrade.

2. **FR-2 — The breakdown subtracts.** For each submeter, the series rendered is its own measurement minus the measurement of its **direct** children, bucket by bucket, clamped at 0. A chain (A ⊃ B ⊃ C) therefore resolves correctly with direct children alone: A−B, B−C, C, which sum to A.

3. **FR-3 — The residual follows.** `other = main − Σ(rendered series)`. With containment declared, the sum no longer double-counts, so `other` regains the kilowatt-hours the double count was eating.

4. **FR-4 — A slice says when it is net.** A series computed net of children is flagged in the payload, and the UI says so, so a user comparing the slice to the meter's own card is not left puzzled.

5. **FR-5 — Refused declarations.** `400` for an equipment naming itself, for a cycle, and for a parent that is not an eligible submeter (`main_energy_meter`, `energy_production_meter`, `solar_panel`); `404` for an unknown parent. The check runs on the resulting graph, not on the pair alone.

6. **FR-6 — A deleted parent frees its children.** `ON DELETE SET NULL`: removing a meter leaves the others measuring, never orphaned rows or a dangling id.

## Acceptance criteria

- [x] An equipment can be given, and cleared of, a `meteringParentId` through `PUT /api/v1/equipments/:id`.
- [x] By-usage renders the parent net of its child, the child whole, and `other` grows by exactly what was double-counted.
- [x] A parent whose children exceed it renders 0, never a negative slice.
- [x] A three-meter chain sums back to the top meter.
- [x] Self-reference, cycle, unknown parent and non-submeter parent are all refused.
- [x] Deleting the parent clears the child's reference and the breakdown returns to raw slices.
- [x] Existing installations are unchanged: no declaration, no subtraction.

## Edge cases

| Case                                                                  | Behaviour                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Child measures more than its parent (clamp drift, different sampling) | Parent renders 0 for that bucket, never negative (FR-2).       |
| Parent has no data for a bucket, child does                           | 0 − child → clamped to 0. The residual absorbs it.             |
| Child is disabled or stops reporting                                  | It contributes 0; the parent shows its full measurement again. |
| Two children on the same parent                                       | Both subtracted.                                               |
| Child declared on an equipment that is not a submeter                 | Stored, and simply never used — nothing to subtract.           |
| Parent deleted                                                        | `SET NULL`, breakdown returns to raw (FR-6).                   |
