# Spec 145 — Architecture

UI + one type. `SavedChartConfig` gains two optional fields; the chart config
is a JSON blob in `chart_configs.config`, so there is **no migration**, no
route change, no event and no backend logic — `ChartManager` stores whatever
the UI sends.

## Files

| File                                              | Change                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/types.ts`                             | `SavedChartSeriesConfig.color?`, `SavedChartConfig.yAxisFit?`                                                                                                                  |
| `ui/src/types.ts`                                 | same two fields (the UI keeps its own copy of the types)                                                                                                                       |
| `ui/src/components/history/y-axis.ts`             | **new** — `fitYAxis(values)` → `{ domain, ticks }`                                                                                                                             |
| `ui/src/components/history/y-axis.test.ts`        | **new** — unit tests for the fit                                                                                                                                               |
| `ui/src/components/history/SeriesColorPicker.tsx` | **new** — palette + free-hue popover                                                                                                                                           |
| `ui/src/components/history/history-utils.ts`      | `SERIES_COLORS` moves here from `AnalyseView` — the picker and the view both need it, and a `.tsx` file may not export non-components (`react-refresh/only-export-components`) |
| `ui/src/components/history/AnalyseView.tsx`       | colour state, fit state, save/load, render wiring                                                                                                                              |
| `ui/src/i18n/locales/{en,fr}.json`                | `analyse.seriesColor`, `analyse.customColor`, `analyse.yAxisFit`                                                                                                               |
| `docs/specs-index.md`                             | spec 145 row (the French index still stops at spec 136)                                                                                                                        |

## Data model

```ts
export interface SavedChartSeriesConfig {
  equipmentId: string;
  alias: string;
  /** Series colour as `#rrggbb`. Absent on charts saved before spec 145 —
   *  the palette default by position applies. */
  color?: string;
}

export interface SavedChartConfig {
  series: SavedChartSeriesConfig[];
  timeRange?: string;
  period?: "day" | "week" | "month" | "year";
  date?: string;
  /** Fit the measurement Y axis to the visible data instead of anchoring it
   *  at zero. Absent = off, which is the pre-145 rendering. */
  yAxisFit?: boolean;
}
```

Both fields are optional and absence means "behave as before", so old rows
deserialise untouched and a downgrade to a pre-145 build just ignores them.

## Colour: why it is not a field of `SeriesConfig`

The obvious move — add `color` to the `SeriesConfig` state objects and mutate
it — breaks the fetch loop:

```ts
useEffect(() => {
  if (series.length > 0) fetchSeriesData(series, chartWindow);
}, [series, chartWindow, fetchSeriesData]);
```

`series` is the effect's dependency, so recolouring a series would rebuild the
array and refetch every series from InfluxDB. Colour is presentation; it must
not touch the identity list that drives the fetch.

So `series` keeps carrying identity only, and the colour lives in a sibling
map keyed by series id, projected onto a derived list used by the render:

```ts
const [seriesColors, setSeriesColors] = useState<Record<string, string>>({});

const styledSeries = useMemo(
  () =>
    series.map((s, i) => ({
      ...s,
      color: seriesColors[s.id] ?? SERIES_COLORS[i % SERIES_COLORS.length],
    })),
  [series, seriesColors],
);
```

`styledSeries` feeds the pills and every Recharts child; `series` still feeds
the fetch, the family computation and the picker gate. The palette fallback by
index is the pre-145 behaviour, so an untouched chart is pixel-identical.

`buildConfig()` persists the _effective_ colour of every series, not only the
overridden ones — a saved chart then keeps its exact look even if the palette
is later reordered.

## Y axis fit

`fitYAxis` lives in its own module because it is the only piece of this spec
with logic worth pinning down in a test (`AnalyseView` has no test harness,
same reasoning as spec 144's `history-utils.ts`).

```ts
export interface FittedYAxis {
  domain: [number, number];
  ticks: number[];
}
export function fitYAxis(values: Iterable<number>, marginRatio?: number): FittedYAxis | null;
```

Steps: scan for min/max (a loop, not `Math.min(...arr)` — the array is one
entry per point per series and would blow the argument limit) → pad by
`marginRatio` (8 %), or by `max(|v| × ratio, 1)` when the series is flat →
clamp the lower bound at zero when the data never goes negative → pick a
`1 / 2 / 5 × 10ⁿ` step targeting five intervals → emit the step multiples that
fall **inside** the padded domain.

The ticks are computed inside the domain rather than by rounding the domain
outwards to step multiples. Rounding outwards is the classic "nice axis"
recipe, but it gives back most of the margin and can widen a 36–94 window to
20–100 — the opposite of fitting. Keeping the exact padded bounds and only
rounding the _labels_ is what makes the result both tight and legible.

### Feeding Recharts exactly this domain

An explicit numeric `domain` is not enough on its own: `combineNiceTicks` in
Recharts re-nices any numeric axis and `combineAxisDomainWithNiceTicks` widens
the domain to cover the ticks it produced. Passing our own `ticks` alongside
the domain keeps both under our control (the fixed-domain tick generator never
leaves the interval, so the domain is preserved either way).

```tsx
<YAxis
  yAxisId="left"
  {...(fittedAxis ? { domain: fittedAxis.domain, ticks: fittedAxis.ticks } : {})}
  …
/>
```

When the toggle is off, neither prop is passed and the axis is byte-for-byte
the one shipped today.

### Which values are fitted

Only what the left axis actually carries:

- state series are skipped — they live on the right `[0, 1]` axis;
- the `:min` / `:max` envelope keys join in only when the band is rendered
  (`envelopeOn && activeResolution !== "raw"` and the category has an
  envelope), so the domain matches what is on screen.

`showBand` moves from inside the render IIFE up to component scope, since the
fit memo needs it too.

### Where the toggle shows

```ts
const showYAxisFitToggle = !chartFamilies.has("cumulative") && hasMeasurementSeries;
```

Same shape as `showEnvelopeToggle`. Cumulative is out (bars need a zero
baseline); a states-only chart has `hasMeasurementSeries === false`, so it is
out too, and the fit is only ever applied in the measurements/mixed
`ComposedChart` branch.

## Persistence flow

```
load  chart.config.series[].color  → seriesColors map
      chart.config.yAxisFit ?? false → yAxisFit
save  buildConfig() → { series: [{ equipmentId, alias, color }], period, date, yAxisFit }
reset navigating to /analyse (empty workspace) clears both, like period/date
```

## Colour picker

`SeriesColorPicker` follows `IconPicker`'s pattern: an absolutely-positioned
panel closed by an outside `mousedown` and by `Escape`, opened by the pill dot
which becomes a `<button>`. Content is the eight palette swatches (the current
one ringed) plus `<input type="color">` for a free hue, wired on `change` so
dragging the OS picker does not spam state updates.
