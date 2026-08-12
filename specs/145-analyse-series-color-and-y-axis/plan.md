# Spec 145 — Plan

## Steps

1. **Types** — add `SavedChartSeriesConfig.color?` and
   `SavedChartConfig.yAxisFit?` to `src/shared/types.ts` and mirror them in
   `ui/src/types.ts`. No migration: the config column is a JSON blob.
2. **`ui/src/components/history/y-axis.ts`** — `fitYAxis(values, marginRatio?)`
   returning `{ domain, ticks }` or `null`, plus the private `niceStep` helper.
3. **`ui/src/components/history/y-axis.test.ts`** — the table below.
4. **`ui/src/components/history/SeriesColorPicker.tsx`** — palette swatches +
   free-hue input, outside-click and Escape close, modelled on `IconPicker`.
   `SERIES_COLORS` moves to `history-utils.ts` so both it and `AnalyseView` can
   import it (a `.tsx` file may not export non-components).
5. **`AnalyseView.tsx`**
   - drop `color` from the `SeriesConfig` state shape; add `seriesColors` and
     derive `styledSeries`;
   - render pills and every Recharts child from `styledSeries`;
   - wire the dot to `SeriesColorPicker`;
   - add `yAxisFit` state, its toggle button (guarded by
     `showYAxisFitToggle`), hoist `showBand`, and compute `fittedAxis`;
   - apply `domain` / `ticks` on the left `YAxis` of the measurements branch;
   - load both from `chart.config`, write both in `buildConfig()`, reset both
     on the empty workspace.
6. **i18n** — `analyse.seriesColor`, `analyse.customColor`, `analyse.yAxisFit`
   in `en.json` and `fr.json`.
7. **Docs** — spec 145 row in `docs/specs-index.md`. The French index still
   stops at spec 136, so nothing to add there (spec 144 made the same call).
8. **Validate** — `npm run validate`: backend typecheck, lint, format check,
   tests, then the UI lint and typecheck.

## Test Plan

### Modules to test

`ui/src/components/history/y-axis.ts` — the only new business logic. The colour
map and the toggle are React state plumbing with no branching worth a harness;
`AnalyseView` has no test harness (spec 144 made the same call), so they are
covered by the manual pass below.

### Scenarios

| Module     | Scenario                                   | Expected                                                                                    |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `fitYAxis` | Nominal — temperature 48…55                | Domain padded by 8 % on both sides, curve inside; ticks are round numbers within the domain |
| `fitYAxis` | Ticks stay inside the domain               | `ticks[0] >= domain[0]`, `ticks.at(-1) <= domain[1]`                                        |
| `fitYAxis` | Ticks are multiples of one step            | Constant gap between consecutive ticks, no float noise (`0.30000000000000004`)              |
| `fitYAxis` | Positive series (0…3000 W)                 | Lower bound clamped to 0                                                                    |
| `fitYAxis` | Series crossing zero (−5…12)               | Lower bound is negative, no clamp                                                           |
| `fitYAxis` | Flat non-zero series (20.5 only)           | Symmetric window around the value, at least two ticks                                       |
| `fitYAxis` | Flat zero series                           | `[0, 1]`                                                                                    |
| `fitYAxis` | Empty input                                | `null`                                                                                      |
| `fitYAxis` | Only non-finite values (`NaN`, `Infinity`) | `null`                                                                                      |
| `fitYAxis` | Mixed finite and non-finite                | Non-finite ignored, fit computed on the rest                                                |
| `fitYAxis` | Custom `marginRatio`                       | Padding scales with the ratio                                                               |

### Manual pass (acceptance criteria of `spec.md`)

1. Three-series chart → recolour the middle one from the palette → only it
   changes, in pill + line + legend + band.
2. Free hue via the colour input → applies live; the network tab shows no
   history request (the fetch loop is not re-triggered).
3. Save → hard reload → reopen: colours and fit toggle restored.
4. Open a chart saved before this branch → palette order, zero-based axis.
5. Temperature chart → toggle the fit → axis tightens, curve off both edges.
6. Power chart → toggle the fit → axis still starts at zero.
7. Rain/energy chart → no fit toggle.
8. Motion-only chart → no fit toggle, axis still `Absent` / `Présent`.
9. Water-heater chart (temperature + relay) → fit on → left axis tightens, the
   right `[0, 1]` axis and the step line are unchanged.
