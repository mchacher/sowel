# Spec 204 — Seasonal off-peak hours

## Context

The Enedis reform of off-peak hours moves the off-peak slots of most meters, and gives many of them two
schedules: one for winter (1 November to 31 March) and one for summer (1 April to 31 October), with off-peak
hours in the early afternoon in summer. The rollout runs meter by meter from 1 December 2026; the first summer
switch is 1 April 2027. Each household learns its own slots from its supplier or its bill.

Sowel has one daily schedule for the whole year (`energy.tariff`, spec 123), applied at write time: every
history window is split into `energy_hp` and `energy_hc` by `TariffClassifier`. A household on two schedules
would have its summer energy split with the winter slots.

This is the lot « Seasonal off-peak slots » of spec 202's split. The screen was validated on the spec 202
mockup (https://claude.ai/artifact/8db2iKvckRQ7TpCupgDkNt, boards « Bureau » and « Téléphone »), including the
maintainer's decision that the season dates are fixed and not shown as fields.

## Goals

1. A household can enter a winter schedule and a summer schedule, simply and precisely.
2. Every write-time split and the recipe-facing tariff snapshot use the schedule of the day's season.
3. Nothing changes for a household on one schedule.

## Non-Goals

- No season dates to type: they are the Enedis ones, stored with the schedule and not shown as fields.
- No retroactive re-split of past energy: the classification stays a write-time value (re-split: #1219).
- No schedule history, no « apply from » date (dropped by spec 202).
- No schedule per weekday in the UI (the API keeps `days`, as today).
- No retrieval of the slots from Enedis or a supplier.

## Functional Requirements

### FR1 — Model

`TariffConfig` (setting `energy.tariff`) gains an optional `summer`:

- `summer.from` and `summer.to`: the first and last day of summer, `MM-DD`, `04-01` and `10-31` by default;
- `summer.schedules`: day schedules, the same shape as `schedules`.

With `summer`, `schedules` is the winter schedule; without it, `schedules` applies all year, as today.

### FR2 — Which schedule a moment uses

A local day is in summer when its `MM-DD` is between `summer.from` and `summer.to` inclusive. The 30-minute
window (or minute) being classified takes the schedule of its start day. A summer day without a matching
schedule, or a schedule without a slot, books everything to peak, as a day without schedule does today.

The classifier, the recipe snapshot (`offPeakToday`, `isOffPeakNow`) and the contract default (HP/HC when a
schedule has an off-peak slot) read the schedule through one function.

### FR3 — API

`PUT /api/v1/settings/energy/tariff` accepts `summer` (`schedules` required, `from` and `to` optional,
`MM-DD`, `from` not after `to`). The body is the whole schedule: a body without `summer` stores a single
schedule. Missing `from`/`to` are stored as `04-01`/`10-31`. `GET` returns `summer` when one is stored.

### FR4 — Settings screen

Under « Heures pleines et heures creuses »:

- a checkbox « Mes heures creuses changent entre l'été et l'hiver », unticked for a single schedule;
- unticked: one block, as today (timeline, slots, add a slot);
- ticked: two blocks, « Hiver » (« Du 1er novembre au 31 mars ») and « Été » (« Du 1er avril au 31 octobre »),
  each with its timeline and its slots; the season in force today carries « En cours »;
- ticking it the first time fills summer with a copy of the current slots; unticking hides summer, and the
  save then stores one schedule;
- one « Enregistrer » for the whole section, as today.

The block dates are written from the stored `from`/`to`, so a stored season and its label never disagree.

## Acceptance Criteria

- [ ] With a summer schedule, a window on 15 July is split with the summer slots, one on 15 January with the
      winter slots; 31 March and 1 April, 31 October and 1 November fall on the right side.
- [ ] Without `summer`, every split is identical to the current one (existing tests pass unchanged).
- [ ] The recipe snapshot gives the off-peak slots of today's season.
- [ ] The API stores the defaults when `from`/`to` are absent and refuses an invalid `MM-DD` or `from` after
      `to`.
- [ ] The screen saves two schedules when ticked and one when unticked, and marks the season in force.

## Edge Cases

- A window that starts at 23:30 on 31 October uses the summer schedule for its whole 30 minutes.
- The checkbox ticked, summer left as the copied slots: two identical schedules, splits unchanged.
- A household that ticks the box in November: nothing changes until 1 April, the block says so by its dates.
- Timezone: the season is read on the local day, like the slots (spec 061).
- Restore of an older backup: `energy.tariff` without `summer` is a single schedule.

## Docs Delta

| Page (EN and FR)                             | Change                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `docs/user/energy.md` + `.fr.md`             | The schedule section: the seasonal checkbox, the two blocks, not retroactive     |
| `docs/technical/api-reference.md` + `.fr.md` | `summer` in the tariff body and response                                         |
| `docs/technical/architecture.md` + `.fr.md`  | `TariffClassifier`: the schedule of the day's season                             |
| `docs/technical/data-model.md` (no FR copy)  | `energy.tariff`: the `summer` object                                             |
| `docs/technical/recipe-development.md` + FR  | `offPeakToday` follows the season (only if the page describes the field)         |

Screenshots retaken: `energy-tariff-settings-en.png` and `-fr.png` if the schedule section is in the frame.
