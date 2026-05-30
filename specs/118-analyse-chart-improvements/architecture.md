# Architecture — Spec 118

## Data model

No SQLite schema change. No new event-bus event. No new InfluxDB bucket.

The existing buckets and fields are sufficient:

- `sowel-hourly` and `sowel-daily` already store `mean`, `min`, `max` per point. The history API at aggregated resolution (`1h` / `1d`) already returns all three on each `HistoryPoint` (see `HistoryQueryResult` in `src/shared/types.ts`).
- F3 (rain daily total) writes to `sowel-daily` under the existing `sum_rain_24` alias, with `mean = min = max = dailyTotal`. No new tag, no new field.

The single backwards-incompat boundary is the in-memory shape of `chartData` inside `AnalyseView`. Each row gains `_min` and `_max` companion keys per series id when the resolution warrants it; the existing `value` key keeps its mean role. No public API change.

## Frontend changes

### `ui/src/components/history/AnalyseView.tsx`

- Replace the single `<Line>` per series with a `<ComposedChart>` containing:
  - A `<Area>` for `[min, max]` (`fillOpacity ≈ 0.15`, same colour as the line, no stroke) — visible only when `envelopeOn && resolution !== "raw"`.
  - A `<Line>` for `value` (mean) — unchanged behaviour.
- New state: `envelopeOn: boolean` (default `true`).
- New header toggle next to the period selector: "Enveloppe min/max".
- The `chartData` merge in `useMemo` flattens each point to `{time, [s.id]: mean, [s.id + ":min"]: min, [s.id + ":max"]: max}` — Recharts `Area` needs two dataKeys for the band.
- Tooltip formatter: when the payload row carries `min` and `max`, append `(min / max)` to the formatted value.
- New helper `isAllCumulative(series)` from `history-utils.ts` (re-use `isCumulativeBarChart`): switches the entire chart to `<BarChart>` when every series belongs to `rain` or `energy`.

### `ui/src/components/history/history-utils.ts`

- Export a `ChartFamily` union type `"measurements" | "cumulative" | "states"` and a `familyOf(category: string): ChartFamily | null` helper. `null` for categories not chartable in AnalyseView (defensive).
- Export `isCumulativeChart(seriesCategories: string[])` = `seriesCategories.every(c => familyOf(c) === "cumulative")`. Kept as a thin wrapper so existing call sites (HistoryPanel) still compile.
- Export `BOOLEAN_CATEGORIES` set (`motion`, `contact_door`, `contact_window`, `water_leak`, `smoke`) and `isBooleanCategory(category: string): boolean` (= `familyOf(category) === "states"`).
- Export `booleanTickLabels(category: string): [string, string]` returning i18n keys (e.g. `contact_door` → `["analyse.bool.contact.closed", "analyse.bool.contact.open"]`).
- Export `ENVELOPE_CATEGORIES` set listing the Measurement categories that get the min/max band (`temperature*`, `humidity*`, `pressure`, `co2`, `voc`, `noise`, `luminosity`, `power`). `wind`, `battery`, `voltage`, `current` are excluded.

### Family-locked series picker (F7)

- AnalyseView holds `lockedFamily: ChartFamily | null` derived from the first selected series. The state itself doesn't need a `useState` — it's a `useMemo` over `seriesList`.
- The picker disables every binding whose `familyOf(b.category)` differs from `lockedFamily`, with a tooltip rendered via the existing UI tooltip helper. The disabled state uses the standard `disabled` prop on the picker rows so keyboard users get the same UX.
- A "Vider le graphe" button appears next to the family-lock indicator only when `lockedFamily !== null`. Clicking it calls the existing series-reset handler.
- The chart-type selection logic simplifies to a single switch on `lockedFamily`: `cumulative` → BarChart, `states` → LineChart with `stepAfter`, `measurements` → LineChart (+ Area envelope when applicable). No `ComposedChart` path remains in F5/F2.

### Step series rendering (F5)

- Series in family `states` use `<Line type="stepAfter" />` on the single primary Y axis (`domain={[0, 1]}`, `ticks={[0, 1]}`, `tickFormatter` translating `0` / `1` to the semantic labels of the **first** series — multi-series State charts pick the first series' labels for the axis ticks; the tooltip surfaces each series' own labels).
- No `ComposedChart`, no secondary Y axis.
- Tooltip formatter for State rows shows the semantic label, not the raw `0` / `1`.

### No new file required

The envelope rendering stays inline in `AnalyseView` — extracting a `<EnvelopeLine>` component is tempting but adds indirection for a single caller. Defer until a second consumer appears (HistoryPanel might benefit later).

## Backend changes

### `src/history/history-query.ts` (F8)

The cumulative-category branch in `handleHistoryQuery` currently calls `buildFluxQuery` for both the downsampled and the raw-bucket fallback, which is wrong: the resulting Flux filters on `_field == "value_number"`, a field that only exists in the raw bucket.

Refactor:

- For non-raw resolutions in the cumulative branch, build two distinct queries:
  - **Downsampled bucket**: read `_field == "mean"` (no `aggregateWindow`; one point per period is already stored).
  - **Raw bucket** (fallback path): keep the existing `value_number` + `aggregateWindow(fn: sum)` shape.
- Move the field+aggregation choice inside `buildFluxQuery` (parameterised by `isDownsampled`) or extract a small `buildCumulativeFluxQuery` helper. Either way the helper still returns a single Flux string; the caller just selects the right variant.

This keeps the existing fallback semantics for the raw path while making the primary downsampled path actually return rows when the daily / hourly bucket has been populated (by the live writer for non-cumulative categories, by the backfill for `sum_rain_24`).

No other backend change for F1-F7 (the API already returns `min` / `max`; the rain daily total is written by the plugin script, not the core).

## Script changes (already shipped on plugin PR #1)

The patches for F3 and F4 are already committed on `sowel-plugin-netatmo-weather#1` and don't need further work:

- F3: `processGroupDay` computes `dailyTotal = sum(raw rain 30-min)` and writes `sum_rain_24` daily under the existing alias.
- F4: pre-run delete iterates only over aliases the run will actually re-write or compute. `--only=<filter>` restricts iteration.

This spec documents the intent so future readers understand why the script writes `sum_rain_24` despite Netatmo not exposing it directly.

## Migration / rollout

No DB migration. The first user-visible deploy follows the regular release workflow:

1. Merge spec 118 PR (UI changes for F1 + F2).
2. Cut a Sowel release (e.g. v1.15.x or v1.16.0).
3. On installs with an existing Netatmo Weather equipment, no action required — the envelope just starts showing on next chart load.
4. To populate rain daily totals on existing installs, run the patched backfill script with `--only=rain` (one-shot, owner-driven; documented in `sowel-plugin-netatmo-weather/scripts/README.md`).

## Risk & failure modes

| Risk                                                                                | Mitigation                                                                                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Min/max band makes the chart visually noisy on overlay of 3+ series                 | Toggle global to disable. Future iteration: per-series.                                                                                                   |
| Bar chart mode toggling when adding a temperature to a rain series jumps the layout | Acceptable for a power-user feature; toggle is deterministic and predictable.                                                                             |
| Future Sowel core release adds a real rain-sum downsample task                      | The backfill `sum_rain_24` daily entries will be replaced by the live task at next downsample run — no conflict; the alias and field shape are identical. |

## File-by-file summary

| File                                                       | Change                                                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/history/history-query.ts`                             | Cumulative branch reads `mean` from downsampled buckets instead of `value_number` (F8)                                                        |
| `src/history/history-writer.ts`                            | Add `wind_angle`, `gust_strength`, `gust_angle` to `ALIAS_DEFAULTS_OFF` (F6)                                                                  |
| `ui/src/components/layout/Sidebar.tsx`                     | Only suppress nav click on exact `/analyse` route, not sub-routes (F9)                                                                        |
| `ui/src/components/history/AnalyseView.tsx`                | Envelope band, toggle state, BarChart switch, tooltip formatter, picker open by default on empty workspace (F1/F2/F5/F7/F9)                   |
| `ui/src/components/history/history-utils.ts`               | New `isCumulativeChart`, `isBooleanCategory`, `booleanTickLabels` helpers + `BOOLEAN_CATEGORIES` set                                          |
| `ui/src/i18n/locales/fr.json`                              | `analyse.envelopeToggle: "Enveloppe min/max"` + boolean tick labels (`analyse.bool.motion.{on,off}`, `analyse.bool.contact.{open,closed}`, …) |
| `ui/src/i18n/locales/en.json`                              | `analyse.envelopeToggle: "Min/max envelope"` + matching boolean tick labels                                                                   |
| `sowel-plugin-netatmo-weather/scripts/backfill-history.ts` | Already shipped on PR #1                                                                                                                      |
| `sowel-plugin-netatmo-weather/scripts/README.md`           | Document `--only=rain` workflow                                                                                                               |
