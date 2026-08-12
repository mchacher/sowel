# Spec 145 — Architecture

UI + one type. `SavedChartConfig` gains two optional fields; the chart config
is a JSON blob in `chart_configs.config`, so there is **no migration**, no
route change, no event and no backend logic — `ChartManager` stores whatever
the UI sends.

## Files

| File                                              | Change                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                             | `SavedChartSeriesConfig.color?`, `SavedChartConfig.yAxisFit?`                                                     |
| `ui/src/types.ts`                                 | same two fields (the UI keeps its own copy of the types)                                                          |
| `ui/src/components/history/y-axis.ts`             | **new** — `fitYAxis(values)` → `{ domain, ticks }`                                                                |
| `ui/src/components/history/y-axis.test.ts`        | **new** — unit tests for the fit                                                                                  |
| `ui/src/components/history/SeriesColorPicker.tsx` | **new** — palette + free-hue popover                                                                              |
| `ui/src/components/history/history-utils.ts`      | `SERIES_COLORS` and `CATEGORY_UNITS` move here from `AnalyseView`; new `measurementUnits()` / `axisForCategory()` |
| `ui/src/components/history/history-utils.test.ts` | cases for the two new helpers                                                                                     |
| `ui/src/components/history/AnalyseView.tsx`       | colour state, fit state, save/load, render wiring                                                                 |
| `ui/src/i18n/locales/{en,fr}.json`                | `analyse.seriesColor`, `analyse.customColor`, `analyse.yAxisFit`                                                  |
| `docs/specs-index.md`                             | spec 145 row (the French index still stops at spec 136)                                                           |

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
  {...(fittedAxes.left ? { domain: fittedAxes.left.domain, ticks: fittedAxes.left.ticks } : {})}
  …
/>
```

When the toggle is off, neither prop is passed and the axis is byte-for-byte
the one shipped today.

### Which values are fitted

`fittedAxes` is `{ left, right }`, each computed from what that axis actually
carries — `axisForCategory` decides the membership, so the fit follows the
split for free:

- state series never contribute — they live on the `[0, 1]` axis;
- the `:min` / `:max` envelope keys join in only when the band is rendered
  (`envelopeOn && activeResolution !== "raw"` and the category has an
  envelope), so the domain matches what is on screen;
- an axis with no series fits to `null`, so the right axis on a single-quantity
  chart is simply absent.

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

## One axis per quantity (F3)

The rule lives in `history-utils.ts` rather than inline in the view, for the
same reason spec 144 put `familiesCompatible` there: `AnalyseView` has no test
harness, and this is the piece worth pinning down.

```ts
export function measurementUnits(categories: string[]): string[];
export function axisForCategory(category: string, units: string[]): "left" | "right" | "state";
```

`measurementUnits` collects the distinct `CATEGORY_UNITS[category]` values in
insertion order, skipping state categories. Grouping by **unit** rather than by
category is the whole point: two temperatures, or a humidity and a battery
(both `%`), are directly comparable and must not be pulled onto separate scales
— that would suggest a difference that is not there.

`axisForCategory` returns `right` only when there are exactly two units and the
category carries the second one. One unit, or three and up, and everything
lands on `left` — three scales do not fit on two sides, and the alternative
(stacking a third axis) eats the plot width on mobile.

The view then holds nothing but the wiring:

```ts
const chartUnits = useMemo(() => measurementUnits(series.map((s) => s.category)), [series]);
const splitAxes = chartUnits.length === 2;
const axisIdOf = useCallback((c: string) => axisForCategory(c, chartUnits), [chartUnits]);
```

`axisIdOf` feeds the `yAxisId` of every `Line` and every envelope `Area`,
replacing the hardcoded `"left"` / `isState ? "state" : "left"`. The second
`YAxis` renders only when `splitAxes`; the state axis is unchanged and Recharts
stacks it outside the right measurement axis when both exist.

Tick labels carry their unit only in split mode (`formatAxisTick`), because
that is the only case where a bare number is ambiguous. Axis width goes 52 → 62
to fit the suffix.

They are also tinted like their curve, which is the cheapest way to pair a
series with its scale:

```ts
const onAxis = styledSeries.filter((s) => axisIdOf(s.category) === target);
return onAxis.length === 1 ? onAxis[0].color : null;
```

Single series only — two curves on one axis have no single colour to borrow —
and `null` falls back to `--color-text-tertiary`, so a shared axis is exactly
as neutral as today. Only the tick labels take the colour: `axisLine` and
`tickLine` are already off on these axes.

## Colour picker anchors

The picker opens from two places, so `colorPicker` state carries where from:

```ts
type ColorPickerAnchor =
  | { kind: "pill"; id: string }
  | { kind: "legend"; id: string; x: number; y: number };
```

A pill anchors the popover in the DOM (the pill is `relative`). A legend entry
is rendered by Recharts and has no node of ours, so `Legend.onClick` gives the
series id (entries carry `name={series.id}`) and the click point, converted to
chart-card coordinates against a ref on the card and clamped so the 176 px
panel stays inside. That anchor opens the popover **upwards** (`placement`
prop) — the legend sits at the bottom edge of the card.

Neither opener toggles: the picker's own outside-`mousedown` handler has
already closed it by the time the `click` fires, so a toggle could only ever
reopen. Escape or a click elsewhere closes it, as with `IconPicker`.

## Persistence flow

```
load  chart.config.series[].color  → seriesColors map
      chart.config.yAxisFit ?? false → yAxisFit
save  buildConfig() → { series: [{ equipmentId, alias, color }], period, date, yAxisFit }
reset navigating to /analyse (empty workspace) clears both, like period/date
```

## Colour picker panel

`SeriesColorPicker` follows `IconPicker`'s pattern: an absolutely-positioned
panel closed by an outside `mousedown` and by `Escape`. Content is the eight
palette swatches (the current one ringed) plus `<input type="color">` for a
free hue, wired on `change` so dragging the OS picker does not spam state
updates. See "Colour picker anchors" above for how it is positioned.
