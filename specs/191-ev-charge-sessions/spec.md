# Spec 191 — EV charge sessions and charging cost per vehicle

- **Status**: Implemented — principles and UI agreed with the maintainer on 2026-11-01 (vehicle page variant B, charger list and reassignment sheet as proposed); production check pending
- **Date**: 2026-11-01
- **Related**: spec 182 (EV charger), spec 183 (electric vehicle — and its non-goal "no car↔charger link in the core", kept here), spec 123 (energy cost valuation, read-time blended rate), spec 126/138 (TariffClassifier), SelfConsumptionWriter (the same live grid deltas)

## Context

Two people, two cars (a Renault Rafale and a Renault Megane), one home charger. They want to know what charging each car at home costs.

Sowel already measures the charger's energy and splits it HP/HC at write time, and Energy → By usage prices it. But:

- **The price is wrong for a car.** By usage applies one blended €/kWh for the whole period (spec 123). A car charges at night (off-peak) or on solar surplus, so a blended rate overstates it: ~22 % on a pure off-peak charge, and a surplus charge is priced at grid rate instead of ~0.
- **Nothing says which car charged.** The charger does not know the car. The car knows, through its maker's cloud, whether it is plugged and charging and its battery level — but those values were not historised, and the charging recipe often logs "unidentified car" at plug-in because the maker's cloud reports minutes late (observed on production, October 2026).

This spec adds a **charge session**: one plug-in on one charger, with its energy, its real cost and the vehicle it belongs to. Nothing in it is specific to a charger or car maker: it reads only the spec 182 and 183 contract categories.

## Principles (agreed with the maintainer)

| #   | Principle                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | A session runs from plug-in to unplug on one charger. Surplus pauses and restarts inside it are the same session (one line). A session under 0.1 kWh is not kept. |
| P2  | The energy is what the charger measures (charging losses included: that is what is paid).                                                                         |
| P3  | Each 5-minute window is priced at its own tariff (HP or HC), never at a blended rate.                                                                             |
| P4  | Solar kWh are free. The cost is grid energy only; the solar share is shown next to it ("of which X kWh solar").                                                   |
| P5  | The car is served last by the sun: in each 5-minute window it is charged `min(its draw, grid import)` — what charging adds to the bill.                           |
| P6  | The cost is frozen at the prices in force when each window was charged. Changing prices later does not touch past sessions.                                       |
| P7  | Sowel attributes a session automatically only when it is sure; otherwise the session stays "to attribute". Totals per vehicle only hold attributed sessions.      |
| P8  | Any user (admin or standard) can reassign a session to a vehicle or to "Other vehicle". A manual choice is final: Sowel never changes it again.                   |
| P9  | Every vehicle known to Sowel is a candidate on every charger (no zone or list restriction).                                                                       |
| P10 | Start from zero: sessions exist from the release on, no rebuild of past months. Home charging only.                                                               |
| P11 | A car also charges elsewhere, so € per 100 km is the home price per kWh × the car's measured consumption, never the home cost ÷ all the km driven.                |
| P12 | € per 100 km is hidden for a plug-in hybrid (part of its km run on fuel).                                                                                         |

## Goals

1. A persisted charge session per plug-in on every `ev_charger` that reports its vehicle state.
2. Its energy split into grid HP, grid HC and solar, and its cost, computed live by 5-minute windows (P3–P6).
3. Automatic attribution to an `electric_vehicle` from the cars' own reports, with an explicit "to attribute" state and a manual override.
4. On each vehicle: a monthly summary (cost, kWh with solar share, € per 100 km, number of sessions) and its session list.
5. On each charger: the session list with the vehicle, and the reassignment control.

## Non-Goals

- **Energy → By usage split per vehicle**, and correcting the charger's blended cost there: later, decided with the maintainer. Until then the charger's € on By usage (blended) and the sum of its sessions (exact) differ, by design.
- **A side-by-side comparison of vehicles** (page or card): not wanted.
- **A charger that identifies the car itself** (RFID, OCPP idTag, ISO 15118): no plugin reports it today. The attribution is written so that such a source can be added as a stronger rule later, without changing sessions.
- **Battery-capacity fingerprint** (energy delivered vs. battery-level rise × capacity): later, if the simple rules leave too many sessions to attribute.
- **The cost of charging away from home** (it only stays out of the € per 100 km, P11), a declared battery capacity or consumption (both are learned), injection revenue, Tempo/dynamic tariffs, subscription and taxes, CSV export, notifications about sessions to attribute.
- **Rebuilding past months** (P10).
- **Linking a car to a charger** in the core (spec 183 non-goal, kept: P9).

## Functional Requirements

### FR1 — Session lifecycle

- A session **opens** when an `ev_charger`'s `vehicle` (category `ev_vehicle_state`) moves from `disconnected` (or unknown) to `connected` or `charging`. It **closes** when `vehicle` returns to `disconnected`.
- An offline charger is not an unplugged one: the session stays open.
- A charger without a `vehicle` binding has no sessions.
- A session is persisted as soon as it opens, and its running totals at the close of every 5-minute window, so a restart loses at most the current window.
- At startup, an open session whose charger now reads `disconnected` is closed at the time of that reading; one whose charger still reads plugged continues.
- At close, a session under 100 Wh is deleted (P1).
- A session belongs to the month of its start (local time).

### FR2 — Energy and cost accounting (5-minute windows, live)

The window is 5 minutes, not 1: the grid meter reports about once a minute with some jitter, so a 1-minute window would regularly hold no grid reading and be counted all grid by the rule below. For each window `m` of an open session:

- `car(m)`: the charger's draw over the window, from its last `power` held until the next one (a charger may report only on change; held at most 15 minutes after its last report of any kind); for a charger that reported no power in the session, from its `energy` deltas.
- `import(m)`: the sum of `max(0, signed grid delta)` over the `main_energy_meter`'s live ticks in the window. Without a main meter, or for a window where the main meter reported nothing, `import(m) = car(m)` (all grid: never invent solar). Ticks carrying a source timestamp (aligned historical windows) are not live and are ignored.
- `grid(m) = min(car(m), import(m))`, `solar(m) = car(m) − grid(m)` (P5).
- `grid(m)` is split HP/HC by the `TariffClassifier` over that window, and priced at the prices in force when the window closes (P3, P6).

The session's **energy** is the sum of the charger's `energy` deltas (the meter is the truth). The window estimates give the **shares**: grid HP, grid HC and solar kWh, and the cost, are scaled by `energy / Σ car(m)`. Without any `energy` delta, `Σ car(m)` is the energy.

No tariff configured: the session has kWh and solar share, and no cost (shown as "—").

### FR3 — Automatic attribution

Candidates: every enabled `electric_vehicle` (P9).

While a session is open and for a **grace period of 2 hours after it closes** (the maker's cloud reports late), Sowel records per candidate the reports the car made **during** the session: their time is the car's `reported_at` when the value came in the same report as it, else the time Sowel received the value (a value from another poll, such as a location giving `at_home`, does not borrow the battery report's time):

- plugged seen (`plugged = true`, informative),
- charging seen (`charging_state = charging`),
- battery rise (`battery_level` at least 2 points above the first value seen in the session),
- away seen (`at_home = false`).

A candidate **matches** when it was seen charging or its battery rose, and was never seen away. A car's own unplug report is no evidence against it: the car stamps its unplug when it happens, often before the charger reports it, so the report falls inside the session of the very car that charged. Being seen plugged is not required: a car whose plug state did not change during the session reports nothing about it.

At the end of the grace period:

- exactly one candidate matches → the session is attributed to it (`auto`);
- only one vehicle exists in Sowel and it was never seen away → attributed to it (`auto`);
- otherwise → `unattributed` ("to attribute"), with the reason (no match / several matches).

During the session and the grace period, the state is `pending` ("identifying").

### FR4 — Manual attribution

- Any authenticated user can set a session to a vehicle, to **Other vehicle** (a guest: counted for no vehicle, leaves the to-attribute list), or back to "to attribute".
- A manual choice is `manual` and is never changed by FR3, even if the grace period is still running.

### FR5 — Vehicle monthly summary

For a vehicle and a month: cost (€), energy (kWh) with its split grid off-peak / grid peak / solar (kWh and € each), number of sessions, and **€ per 100 km**.

**€ per 100 km = home price × consumption** (P11). The car may also charge elsewhere (work, motorway), so the home cost is never divided by all the km driven:

- **Home price** (€/kWh): the month's home cost ÷ the month's home energy (solar included, so solar lowers it).
- **Consumption** (kWh per 100 km, at the wall): measured by Sowel, never declared.
  - _Energy per battery percent_ is learned from home sessions: Σ energy ÷ Σ battery rise, over the vehicle's last 10 attributed sessions that raised the battery by at least 10 points. It is at-the-wall energy, so charging losses are included, as they are in the cost.
  - _Battery used per km_ is measured while driving: between two consecutive mileage readings with km > 0, the battery drop over those km. A leg during which the battery rose or the car was seen charging (it charged on the way) is left out of the measure.
  - Consumption = energy per percent × Σ battery drop ÷ Σ measured km × 100.
- Shown when the month has home sessions, the vehicle has a learned energy per percent and at least 50 measured km in the month; otherwise "not enough data yet".
- **Hidden for a plug-in hybrid** (P12): a vehicle marked "plug-in hybrid" (a setting on the vehicle, off by default) never shows € per 100 km, since part of its km run on fuel.

### FR6 — API and live updates

- List sessions by charger or vehicle and period; get a vehicle's monthly summary; set a session's attribution (FR4).
- Session changes (opened, updated totals, closed, attributed) are pushed over WebSocket so both pages update live.

### FR7 — UI (requirements; layouts to be agreed on the UI proposals)

- **Vehicle detail page** (variant B chosen): a "Home charging" section — month navigator, cost and kWh, a bar split grid off-peak / grid peak / solar with kWh and € per part, € per 100 km with the consumption and home price behind it, then the month's sessions each with its own mini bar, and a "see all".
- **Vehicle settings**: a "plug-in hybrid" switch (P12).
- **Charger detail page**: a "Sessions" section — month navigator, sessions with their vehicle (or "to attribute" / "identifying" / "other vehicle") and the reassignment control (vehicles + Other vehicle + To attribute), available to every role.
- The session in progress is visible live (energy so far, solar share so far).

## Acceptance Criteria

- [x] A plug-in on a charger reporting `vehicle` opens a session; the unplug closes it; pauses inside do not split it.
- [x] A session under 0.1 kWh disappears at close.
- [x] A window where the car draws 1.4 kW while the house imports 0.4 kW is counted 2/7 grid and 5/7 solar (P5).
- [x] A window in HC is priced at the HC price, in HP at the HP price; changing prices afterwards leaves closed sessions unchanged.
- [x] Without a main meter, a session is all grid; without a tariff, it has no cost and the UI shows "—".
- [x] A restart during a session loses at most one window of accounting; a restart after an unplug closes the session.
- [x] With the Rafale reporting plugged + charging during a session and the Megane unplugged, the session is attributed to the Rafale at the end of the grace period.
- [x] With both cars matching, or none, the session is "to attribute" with the reason.
- [x] A manual reassignment (standard user included) sticks, including to "Other vehicle", and moves the totals.
- [x] The vehicle summary shows cost, kWh split off-peak / peak / solar with € each, sessions and € per 100 km for the month.
- [x] € per 100 km = home €/kWh × measured consumption; a month where half the km were driven on energy charged elsewhere gives the same € per 100 km as a month charged only at home, at the same home price and consumption.
- [x] A driving leg during which the battery rose is left out of the consumption.
- [x] € per 100 km reads "not enough data yet" before the first qualifying home session or under 50 measured km, and never shows on a vehicle marked plug-in hybrid.
- [x] Both pages update live over WebSocket.
- [ ] Verified on production for two weeks with both cars (historised car data enabled on 2026-11-01 serves as the reference).

## Edge Cases

| Case                                                         | Expected                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Charger offline during a session                             | Session stays open; its last power is held 15 minutes at most, then nothing is added     |
| Main meter offline for some minutes                          | Windows without any grid tick count all grid (never invent solar)                        |
| Charger has `energy` but no `power`                          | Window estimates from energy deltas (coarser solar split, exact kWh)                     |
| Charger has `power` but no `energy`                          | Energy = integrated power                                                                |
| Session spans midnight, a tariff change or a month boundary  | Windows priced individually; the session counts in the month of its start                |
| Session lasts several days                                   | Nothing special: accounting is live and persisted                                        |
| Vehicle reports plugged but a contradictory `charging_state` | Battery rise still matches it (seen on the Megane: maker code 0.4 mapped to `unplugged`) |
| Two chargers, one car seen plugged during both sessions      | That car matches both: each session is attributed only if it is the only match           |
| Vehicle deleted                                              | Its sessions keep the vehicle's name, marked as deleted, and leave no total              |
| Charger deleted                                              | Its sessions are kept with the charger's name; vehicle totals unchanged                  |
| Prices changed in the middle of a session                    | Windows before and after are priced at their own prices                                  |
| No `electric_vehicle` in Sowel                               | Sessions still recorded on the charger, all "to attribute"                               |
| Car charged at work, then driven home                        | That leg (battery rose) is out of the consumption; home € per 100 km unaffected          |
| Month without home session but with driving                  | € per 100 km "not enough data yet" (no home price that month)                            |
| Vehicle without `mileage` or `battery_level`                 | No consumption, € per 100 km never shown; sessions and cost unaffected                   |
| Battery level in 1 % steps                                   | Learned over ≥ 10-point rises and summed over the month, so the rounding averages out    |

## Docs Delta

| Page (EN and FR)                                                              | Change                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `docs/user/equipments.md` + `.fr.md` (EV charger, electric vehicle sections)  | Sessions on the charger, home charging summary on the vehicle, reassignment |
| `docs/user/energy.md` + `.fr.md`                                              | Why the charger's € on By usage differs from the sum of its sessions        |
| `docs/technical/api-reference.md` + `.fr.md`                                  | Session endpoints and WebSocket events                                      |
| `docs/technical/data-model.md` and `data-model/equipments.md` (EN only today) | Session and daily-mileage tables, session types and events                  |
| `docs/technical/architecture.md` + `.fr.md`                                   | Session tracker (5-minute grid/solar attribution)                           |

Screenshots to retake: vehicle detail, charger detail (once the UI is agreed).
