# Spec 123 — Energy cost valuation (HP/HC)

## Context

Sowel already classifies every 30-min energy window into HP / HC at write time (`TariffClassifier` + `HistoryWriter`) and stores per-tariff prices `{ hp: €/kWh, hc: €/kWh }` in the existing `TariffConfig` settings blob. The prices are validated on `PUT /settings/energy/tariff` and surfaced read-only on `GET`, but **no endpoint multiplies energy by price**: the UI shows kWh only.

This spec wires the price into the existing read endpoints so users see how much their consumption actually costs, both on the global Energy history view and on the per-equipment by-usage breakdown.

## Goals

- Expose computed € costs on the existing `/api/v1/energy/history` and `/api/v1/energy/by-usage` responses.
- Toggle Wh / € on the Energy page (Total + By usage tabs), persisted in user preferences.
- No InfluxDB schema change: costs are computed at read time from the current `TariffPrices`.

## Non-goals (explicit)

- **No injection revenue**. Surplus production stays a kWh figure; no `injection` price field is added.
- **No variable / Tempo tariff**. Strict 2-band HP/HC stays the only model.
- **No subscription, taxes, TURPE, CSPE**. Out of scope.
- **No retroactive price history**. The current `TariffPrices` is applied to the whole queried window; changing prices later updates the displayed cost of past periods.
- **No new equipment type** (`energy_cost_*`). The cost is a derived view of the existing energy series.

## Requirements

### R1 — Backend cost on `/energy/history`

`GET /api/v1/energy/history` MUST add, alongside the existing `hp` / `hc` per-point values and the existing totals:

- `cost_hp: number` (€, per point and per total)
- `cost_hc: number` (€, per point and per total)
- `cost_total: number` = `cost_hp + cost_hc`

Computation: `cost_hp = hp_Wh / 1000 × prices.hp`, same for HC. Rounded to 4 decimals server-side.

When no tariff is configured (`prices.hp` and `prices.hc` both 0, or `energy.tariff` setting missing): every cost field MUST be `0`. The endpoint MUST NOT 5xx.

### R2 — Backend cost on `/energy/by-usage`

`GET /api/v1/energy/by-usage` MUST add per submeter series and on the "other" residual:

- `cost: number` per series total (€)
- A new `totals.costByEquipment: Record<string, number>` mirroring `totals.byEquipment`
- `totals.otherCost: number` and `totals.totalCost: number`

The per-submeter cost uses the **blended period rate** derived from the matching `/energy/history` totals for the same window:

```
blendedRate = (totals.cost_hp + totals.cost_hc) / ((totals.total_hp + totals.total_hc) / 1000)
            = (cost_total €) / (consumption kWh)
```

When the window has no consumption (denominator 0) the blended rate is `0` and every submeter cost is `0`. The endpoint MUST NOT 5xx.

> **Why blended, not per-bucket HP/HC**: submeters are stored as `energy` only (not `energy_hp` / `energy_hc`), so a per-bucket HP/HC split for each submeter would require N extra Influx queries per submeter. The blended period rate is a single ratio computed from data we already query. The trade-off — a submeter that runs only during HC will show a slightly inflated cost vs. reality — is acceptable for the V1: the goal is "what does this oven cost me roughly per month", not invoice-grade attribution.

### R3 — Frontend Wh / € toggle on the Energy page

The Energy page (`EnergyPage.tsx`, both `Total` and `By usage` view modes) MUST expose a **Wh / €** switch in the page header (next to the period / date controls).

- Default: Wh (existing behaviour).
- Persisted in user preferences (`preferences.energy.unit: "wh" | "eur"`) so the choice survives navigation and reload.
- When `€` is active:
  - Total view: top totals card replaces `kWh` formatting with `€` (cost_total, with HP / HC breakdown still shown in € when both present). Bar chart Y axis & tooltip in €.
  - By usage view: donut + stacked bar in €. Legend amounts in €.
- When the tariff is not configured (`tariffConfigured: false` from `/energy/status`), the toggle is **disabled** with a tooltip `Configurez les prix HP/HC dans Réglages > Tarif`. Active mode falls back to Wh.

### R4 — LiveEnergyPage out of scope (post-MVP)

The LiveEnergyPage shows instantaneous power in W / kW, not cumulative energy. Valuing instantaneous W in € would require a different metric (cost-per-hour at current rate) that does not match the Wh / € toggle semantic. The live page therefore stays Wh-only in this spec; a separate `€/h` indicator can be added later if useful.

### R5 — TariffSettings UX nudge

`TariffSettings.tsx` MUST add a one-line hint under the price inputs: `Ces prix valorisent toute votre consommation passée et future. Modifiez-les pour refléter votre facture actuelle.`

This is the only place the user discovers the retroactive read-time behaviour declared in non-goals.

### R6 — No new settings, no migration

- `TariffPrices` shape unchanged (`{ hp, hc }`).
- No new SQLite migration.
- No new Influx fields.
- The only persisted addition is `preferences.energy.unit` on the existing `user_preferences` blob.

## Acceptance criteria

- [x] `GET /api/v1/energy/history?period=day&date=YYYY-MM-DD` returns `cost_hp`, `cost_hc`, `cost_total` per point + totals (€, 4 decimals), with the existing Wh fields untouched.
- [x] When the tariff is unset, every cost field on the response is exactly `0` and the request succeeds.
- [x] `GET /api/v1/energy/by-usage?...` returns per-submeter `cost`, `totals.costByEquipment`, `totals.otherCost`, `totals.totalCost` consistent with the blended period rate.
- [x] Energy page has a working Wh / € toggle in the header, persisted across reloads.
- [x] Toggle is disabled when the tariff is not configured, with a localized tooltip pointing to settings.
- [x] LiveEnergyPage donut respects the same toggle.
- [x] TariffSettings shows the read-time-pricing hint under the prices.
- [x] All existing energy tests still pass; new tests cover the cost computation paths (see `plan.md` test plan).
- [x] FR + EN i18n entries added for every new label (`energy.unit.wh`, `energy.unit.eur`, `energy.unit.tariffMissing`, tariff hint).
- [x] Release notes entry added under v1.X.Y in both `docs/release-notes.md` and `docs/release-notes.fr.md`.

## Edge cases

| Case                                             | Expected                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| Tariff config missing (`energy.tariff` unset)    | All cost fields = 0, toggle disabled in UI                              |
| Prices both 0 but schedules set                  | Same as above (toggle disabled)                                         |
| Only `hp` price set, `hc` = 0                    | HC cost = 0 ; HP cost computed normally ; toggle enabled                |
| `/energy/history` returns empty `points`         | Totals all 0, cost fields all 0                                         |
| `/energy/by-usage` has no main meter             | `total` falls back to Σ submeters, blended rate uses Σ submeters' kWh   |
| `/energy/by-usage` window has 0 consumption      | All submeter costs = 0, no division by zero                             |
| User changes prices in settings                  | Next page load reflects new prices on past data (intentional, see hint) |
| Resolution `1mo` (year period, spec 119)         | Same blended-rate logic applies, no special case                        |
| Submeter total > main meter total (clamping bug) | Each submeter cost still computed independently from its own Wh × rate  |

## Stakeholders

- User: home owner watching their bill — wants a € figure on each chart.
- AI agent maintaining the energy stack — needs to know costs are read-time, not stored.
