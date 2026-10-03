# Spec 184 — Electric vehicle: `refresh` order

- **Status**: Implemented
- **Date**: 2026-10-03
- **Related**: spec 183 (electric vehicle contract — amended here), spec 182 (EV charger), `sowel-recipe-ev-charge-smart` spec 001 (the first caller), `sowel-plugin-renault` spec 001 (the first plugin)

## Context

A car's data comes from its maker's cloud, polled sparingly: Renault's budget is about 40 requests an hour per account, so the Renault plugin reads the battery every 10 minutes. When a charge starts, the car itself reports within a minute — but Sowel only sees it at the next poll. Measured on the candidate instance (2026-10-03): the charger drew 2.1 kW while the car still showed "waiting for current" for minutes.

The one who knows that something just changed is the charging recipe: it has just started the charger. It needs a way to say "read the car now", brand-independent. The only lever today is `wake`, which on a Renault is a lights command: using it to read data would flash a car's lights at every charge start, and it means something else.

## Goals

1. A `refresh` order in the electric vehicle contract: "read the car's latest report now". Optional, momentary, no value.
2. The detail surface offers it next to the age of the report, so a user can do the same by hand.

## Non-goals

- **Waking the car.** `refresh` reads what the cloud holds; it never wakes a sleeping car (that is `wake`). A sleeping car's report stays old, and `reported_at` says so.
- **A generic refresh for every equipment type.** The integration-level "Refresh" button exists; this is the car's contract, because a recipe acts on equipments, not integrations.
- **Rate limiting in the core.** The plugin owns its maker's budget (the Renault plugin's limiter already counts every request).

## Functional requirements

- **FR1** New `OrderCategory` `ev_refresh` (backend and UI mirror). Core alias `refresh` in `ELECTRIC_VEHICLE_ALIASES`, mapped in `ELECTRIC_VEHICLE_CATEGORY_ALIASES` (`ev_refresh` → `refresh`). Momentary like `wake`: the UI and recipes send `null`.
- **FR2** Contract-first auto-binding binds it as `refresh` (UI plan and API `createWithAutoBindings`), like the other contract orders; `RELEVANT_ORDER_CATEGORIES.electric_vehicle` lists it.
- **FR3** `ElectricVehicleControl`: when `refresh` is bound, a small refresh icon button sits at the end of the status line, after the report age when that is shown (the button is always shown when bound, the age only when stale); it spins while the order runs and shows the outcome line like the other orders.
- **FR4** Docs: the contract table in `docs/technical/data-model/equipments.md` and the vehicle section of `docs/user/equipments.md` (EN/FR) gain the order.

## Acceptance criteria

- [x] AC1 — A device publishing an `ev_refresh` order gets it bound as `refresh` through the UI plan and through the API auto-bind.
- [x] AC2 — The detail control shows the refresh button only when `refresh` is bound; pressing it sends `null` to `refresh`.
- [x] AC3 — Existing equipments without the order are unchanged (no button, no error).
- [x] AC4 — `npm run validate` green; docs parity and specs index checks pass.

## Edge cases

| Case                                      | Expected                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Plugin rejects (rate limit, cloud down)   | Outcome line shows the plugin's reason; nothing else changes                                          |
| Car asleep                                | The order succeeds; `reported_at` stays old — the age keeps telling it                                |
| Vehicle already bound before this release | No `refresh` until the user re-runs the binding plan or recreates it (same as any new contract point) |
