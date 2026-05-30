# Spec 118 — Analyse chart improvements

## Problem

The Analyse page has shipped its calendar navigator (spec 117 / v1.15.6) and users now scrub through months and years of historized data. With the larger time windows, three rendering gaps surface:

1. **Daily aggregation loses the amplitude story.** Today the chart draws one point per day (the `mean`). A May day at `mean=20°C` reads identical to a January day at `mean=20°C`, even if the first ranged from 14 to 28 and the second from 19 to 21. The downsampled bucket already stores `min` / `max` next to `mean`; the UI just ignores them.
2. **Category-inappropriate chart type.** Temperatures and humidities want a line. Rain and energy want bars (cumulative buckets), and a flat zero rain line on a dry week looks like "no data". `HistoryPanel` on the equipment detail page already switches to a bar chart for rain/energy via `isCumulativeBarChart` — `AnalyseView` does not.
3. **Rain has no real "mm per day" series.** `sum_rain_24` from Netatmo is a _rolling_ 24h cumul, refreshed at each poll. When Sowel's generic downsample task aggregates it daily, it computes `mean(rolling 24h cumul)` which is a fuzzy number, not "X mm fell on this day". Spec 118 also captures the data-loss incident on sowelox 2026-05-30: the Netatmo backfill script deleted live-historized `sum_rain_24` and never restored it because the Netatmo `getmeasure` endpoint refuses that alias at scale=30min. Two follow-ups: the script must compute a proper daily total locally, and the chart must read it.

## Goals

- Make the Année / Mois views informative for temperature & humidity by showing min/max around the mean.
- Make the Pluie chart actually look like rain — bars, with a sensible daily total.
- Make the backfill script idempotent without ever destroying live-historized data it cannot itself replace.

## Non-goals

- Reshape the Jour / Sem views — they already render raw 30-min points where min/max == mean.
- Touch the energy charts (Energy page and submeter breakdown have their own pipeline; out of scope).
- Add user-configurable per-series options (toggle min/max per series, choose mean vs. min vs. max). One global toggle is enough; the rest is over-engineering for the gain.
- Wind direction (`wind_angle`) and gust details (`gust_strength`, `gust_angle`): excluded from historization entirely (see F6). They remain visible in the live `WeatherPanel` (compass arrow, gust hero) but disappear from the AnalyseView series picker. A dedicated rose-of-winds visual is a separate spec.
- `wind_strength` (mean wind speed) stays under the `wind` category: line chart, no envelope. No special handling.

## Chart-type decision matrix

Every chartable category in `SENSOR_DATA_CATEGORIES` (see `ui/src/components/equipments/sensorUtils.tsx`) belongs to exactly one **family**. A chart contains series from a single family — mixed-family selections are not allowed (see F7).

| Family                        | Categories                                                                                                                                                              | Chart type                     | Envelope (`1h` / `1d`)                                                                                                                                                 | Y axis                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Measurements** (continuous) | `temperature`, `temperature_outdoor`, `humidity`, `humidity_outdoor`, `pressure`, `co2`, `voc`, `noise`, `luminosity`, `power`, `voltage`, `current`, `wind`, `battery` | line                           | yes for the slow-moving subset (`temperature*`, `humidity*`, `pressure`, `co2`, `voc`, `noise`, `luminosity`, `power`); no for `wind`, `battery`, `voltage`, `current` | numeric, auto                                                                        |
| **Cumulative**                | `rain`, `energy` (alias `sum_rain_24` falls under `rain`)                                                                                                               | bars                           | no                                                                                                                                                                     | numeric, auto                                                                        |
| **States** (boolean / event)  | `motion`, `contact_door`, `contact_window`, `water_leak`, `smoke`                                                                                                       | step line (`type="stepAfter"`) | no                                                                                                                                                                     | `0` / `1` ticks with semantic labels (e.g. "fermé" / "ouvert", "absent" / "présent") |

The matrix is the source of truth. New categories added later must declare which family they belong to before becoming chartable in AnalyseView.

## Functional requirements

### F1 — Min/max envelope on line charts

For each line series, when the active resolution is `1h` or `1d`, render a semi-transparent area between `min` and `max` of the same colour as the line. The mean stays as the solid line.

- Default state: envelope visible.
- Global toggle in the chart header: "Enveloppe min/max" (on/off). State is per-chart in memory; not persisted in `SavedChartConfig` (start simple).
- Tooltip rows when hovering: `mean (min / max)` per series — e.g. `21.5°C (18 / 26)`.
- On `raw` resolution the envelope is hidden (each point is a single 30-min sample, min/max == mean).

### F2 — Cumulative bar charts in AnalyseView

When the chart family is `Cumulative`, render a `BarChart` instead of a `LineChart`. Mirrors the rule `isCumulativeBarChart` already used by `HistoryPanel`.

- Mixed selection is impossible by construction (see F7), so the BarChart branch is unconditional once the family is `Cumulative`.
- The bar value is the `mean` field for now (which will hold the daily total after F3 lands for rain).
- X-axis stays a continuous time scale (already fixed in v1.15.7) so bars space themselves correctly.

### F3 — Proper daily rain total in the backfill

The Netatmo backfill script computes, for each calendar day on a Rain Gauge module, the **sum** of the 48 raw 30-min `Rain` values fetched from Netatmo. That value is written as a daily point in the `sowel-daily` bucket under the existing `sum_rain_24` alias (`mean = min = max = dailyTotal`).

- The live history-writer remains unchanged: it keeps writing the rolling 24h `sum_rain_24` to the raw bucket on each poll. Live charts on Jour view show the rolling cumul; aggregated charts on Mois/Année read the daily-bucket total.
- Acceptable semantic drift (rolling vs. daily total) because the user-facing question "how much did it rain on the 12th?" is answered correctly by the daily bucket entry; the raw point reflects the running counter at poll time, which is also what the live UI needs.

### F4 — Backfill script safety (data-loss prevention)

The backfill's pre-run cleanup must only delete aliases the run will actually re-write or compute. Aliases the script cannot restore (Netatmo `getmeasure` doesn't expose them) stay untouched so live-historized data survives a backfill re-run.

The `--only=<rain|outdoor|indoor|wind|all>` CLI flag restricts the run to a single module class, enabling targeted recomputation (e.g. after F3 lands, `--only=rain` recomputes the rain daily totals without re-fetching everything).

### F7 — Family-locked series picker

The AnalyseView series picker enforces single-family selection:

- While the chart is empty, every chartable binding is selectable.
- As soon as one series is added, the picker locks to that series' family. Bindings of any other family are rendered disabled (greyed) with a tooltip explaining why ("Famille incompatible — supprimez les séries actuelles pour mélanger").
- A "Vider le graphe" button next to the family lock indicator (e.g. "Famille : Mesures") clears the selection and unlocks the picker.
- Removing the last series of a chart also unlocks the picker (no series → no family).
- Saved charts that include cross-family series (legacy `SavedChartConfig` from before this spec — none should exist in practice today) are loaded into a degraded "read-only mixed" mode that renders the dominant family and shows a warning banner ("Ce graphe enregistré mélange plusieurs familles, l'affichage est dégradé"). User can edit by removing the off-family series.

The family is derived from the binding's `category` via a single `familyOf(category)` helper. A future iteration can promote this to a server-side `HistoryBindingState.family` field if other UIs need it.

### F9 — Empty Analyse workspace is reachable and self-explanatory

Two existing UX defects on the Analyse landing page:

1. **Sidebar nav trap**: clicking "Analyse" while on a saved-chart route (`/analyse/<chartId>`) only toggles the section expansion (via `preventDefault`) and never navigates back to `/analyse`. Result: once a saved chart has been opened, the workspace that lets the user create a new chart becomes unreachable from the sidebar.
2. **Empty-state placeholder is inscrutable**: an empty `/analyse` route shows a big "no series" placeholder above a hidden add-series form. New users have to discover the "Ajouter" button to do anything.

Fix:

- `Sidebar.tsx`: suppress the click default only when the user is already on the **exact** `/analyse` route — sub-routes must navigate back to `/analyse`.
- `AnalyseView.tsx`:
  - `showAddForm` defaults to `true` when no `chartId` is in the URL (empty workspace) so the picker is visible immediately.
  - "Vider le graphe" (F7) also reopens the picker — same intent: bring the user back to an actionable state.
  - The first zone is preselected as soon as the picker opens, so the equipment dropdown is populated without a manual step.
  - The empty-chart placeholder shrinks to a quiet "dashed border" panel with a single hint sentence ("Sélectionnez une zone, un équipement et une métrique ci-dessus pour démarrer votre graphique") — the picker above is the call to action.

### F8 — Cumulative categories read the `mean` field from downsampled buckets

The current `history-query.ts` builds the same Flux query for raw and downsampled buckets when the category is cumulative (`rain`, `energy`): it filters `_field == "value_number"` then applies `aggregateWindow(fn: sum)`. The `value_number` field only exists in the raw bucket — the downsampled buckets (`sowel-hourly`, `sowel-daily`, `sowel-energy-*`) store `mean` / `min` / `max`. Result: the initial query against the downsampled bucket returns zero rows, and the existing fallback retries against the raw bucket, which only holds the live writer's data (typically a few days of rolling counter values, not historized totals).

Concrete user-visible bug: the "Pluie" chart (alias `sum_rain_24`) on `Mois` / `Année` is empty even after the backfill writes 365 daily totals into `sowel-daily`, because the query reads the wrong field. Caught on sowelox 2026-05-30 right after the `--only=rain` recovery run.

Fix:

- When the cumulative-category branch queries a downsampled bucket, it must read the pre-aggregated `mean` field directly (no `aggregateWindow` — the bucket already has one point per resolution period).
- The fallback to the raw bucket keeps its current behaviour (`value_number` field, `aggregateWindow(fn: sum)`).
- No change for non-cumulative categories — they already use `buildAggregatedFluxQuery` which has the correct downsampled vs raw branch.

This brings the cumulative query path in line with the non-cumulative one and unlocks the `sum_rain_24` daily totals on the rain chart.

### F6 — Drop wind direction and gust details from historization

Add `wind_angle`, `gust_strength`, `gust_angle` to `ALIAS_DEFAULTS_OFF` in `src/history/history-writer.ts`. Effect:

- These aliases stop being written to InfluxDB on every install at the next deploy.
- `getHistoryBindings` returns them with `effectiveOn = false`, so the AnalyseView series picker (which already filters on `effectiveOn`) drops them.
- The live `WeatherPanel` (compass arrow for direction, gust hero) keeps working because it reads bindings directly, not via the historize-filtered list.
- Legacy data already in `sowel-hourly` / `sowel-daily` under these aliases is harmless and decays with the retention windows. No migration required.

### F5 — Step chart for State series

When the chart family is `States`, render every series as a step line (`<Line type="stepAfter" />`) on a single Y axis bounded to `[0, 1]`.

- Numerical encoding: `0` = inactive (no motion, contact closed, dry, no smoke), `1` = active. The history writer already stores these as `0` / `1` in the raw bucket.
- Tick labels are semantic, derived from the category (e.g. `contact_door` → `fermé` / `ouvert`, `motion` → `absent` / `présent`).
- When several State series of different categories share a chart, the axis stays `[0, 1]` but the tooltip surfaces the semantic label per series (each line carries its own `0` / `1` semantics).
- Min/max envelope: not applicable. Aggregated resolutions (`1h` / `1d`) render the `mean` as-is (a value in `[0, 1]` indicating the share of time the state was active during the bucket), still on the same `[0, 1]` axis.
- Mixed with non-State series is impossible by construction (see F7).

## Acceptance criteria

| #    | Scenario                                                                               | Expected                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | Analyse chart in Année view, one temperature series, agg=1d                            | A line at mean ± a shaded band [min,max] of the same colour; tooltip shows three values per point                                                    |
| AC2  | Toggle "Enveloppe min/max" off                                                         | Band disappears, only the mean line remains; tooltip drops min/max                                                                                   |
| AC3  | Analyse chart in Jour view, one temperature series, raw resolution                     | No band rendered (min=max=mean would be visually redundant)                                                                                          |
| AC4  | Analyse chart with rain-only series                                                    | BarChart rendered; bars sized by daily total mm                                                                                                      |
| AC5  | Picker after adding a temperature series                                               | Rain, energy, motion, contact bindings appear disabled with the "Famille incompatible" tooltip; only Measurement-family bindings stay enabled        |
| AC6  | Backfill `--only=rain` for last 30 days                                                | `sum_rain_24` daily bucket gets 30 points where value = daily total; chart "Pluie" in Mois view shows bars                                           |
| AC7  | Backfill re-run with `--only=rain`                                                     | Previous bucket points overwritten; no duplicate; no other aliases touched                                                                           |
| AC8  | Backfill `--only=outdoor` on an install where rain was previously live-historized      | The live `sum_rain_24` history in the raw bucket is preserved (no delete spillover)                                                                  |
| AC9  | Analyse chart with one `contact_door` series, Jour view                                | Step line on a `[0, 1]` Y axis with ticks `fermé` / `ouvert`; transitions are visible as vertical steps, not interpolated diagonals                  |
| AC10 | Picker after adding a `motion` series                                                  | Temperature, humidity, rain, energy bindings appear disabled; only State-family bindings (`motion`, `contact_*`, `water_leak`, `smoke`) stay enabled |
| AC11 | Click "Vider le graphe" while a chart is family-locked                                 | Selection cleared, picker reopens with every binding selectable; the family-lock indicator disappears                                                |
| AC12 | Wind direction or gust binding listed in the picker                                    | Absent from the list (excluded via F6 `effectiveOn=false`) on any new install or after a fresh deploy of v1.16+                                      |
| AC13 | "Pluie" chart on `Mois mai 2026` after backfill (sum_rain_24, `sowel-daily` populated) | Bars (or line until F2 lands) show the daily totals, e.g. ~5.26 mm on 2026-05-04, ~2.7 mm on 2026-05-11. No empty chart.                             |
| AC14 | Click "Analyse" in the sidebar while on `/analyse/<chartId>`                           | Navigation lands on `/analyse` (the empty workspace), the saved-chart sub-list stays expanded.                                                       |
| AC15 | Open `/analyse` fresh (no chartId in URL)                                              | The add-series form is open by default with the first zone preselected; the empty-chart placeholder is a quiet dashed panel.                         |

## Out of scope (future iterations)

- Per-series toggle (instead of global) for the min/max envelope.
- Persisting the envelope-on/off preference in `SavedChartConfig`.
- A hybrid line + bar chart for mixed-category selection.
- An equivalent of the daily total computation for `sum_rain_1` (lower-priority, can stay as the live rolling value).
- Server-side: extend the Sowel core to compute daily-total for rain in the live downsample task (would also remove the dependency on the backfill script for this feature). Track separately.
