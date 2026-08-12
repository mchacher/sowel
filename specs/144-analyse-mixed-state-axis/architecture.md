# Spec 144 — Architecture

UI-only. No type, route, event, table or migration changes; `SavedChartConfig`
is untouched, so saved charts survive as-is.

## Files

| File | Change |
| ---- | ------ |
| `ui/src/components/history/history-utils.ts` | `BOOLEAN_CATEGORIES` gains the five actuator state categories; new `familiesCompatible(a, b)`; `booleanTickLabels` gains power / lock / gate-cover cases. |
| `ui/src/components/history/AnalyseView.tsx` | `lockedFamily` → `chartFamilies` + `hasStateSeries` / `hasMeasurementSeries`; picker gate, family pill, envelope toggle and the render branches follow. |
| `ui/src/components/history/history-utils.test.ts` | Cases for the new classification, `familiesCompatible` and the new label pairs. |
| `ui/src/i18n/locales/{en,fr}.json` | `analyse.family.mixed`, `analyse.bool.power.{off,on}`, `analyse.bool.lock.{unlocked,locked}`. |

## Family model

`familyOf` keeps returning one family per category. What changes is that a
chart is no longer described by one family:

```ts
const chartFamilies: Set<ChartFamily>   // families actually present
const hasStateSeries: boolean           // ≥1 series in `states`
const hasMeasurementSeries: boolean     // ≥1 series in `measurements` or unclassified
```

`familiesCompatible(a, b)` states the only remaining exclusion — `cumulative`
against anything else — and the picker applies it against every family already
plotted rather than against the first series':

```ts
const familyMismatch = [...chartFamilies].some((f) => !familiesCompatible(f, bindingFamily));
```

Keeping the rule in `history-utils.ts` rather than inline in the picker is what
lets the test file pin it down; `AnalyseView` has no test harness.

## Render branches

Three branches, selected in this order:

1. `chartFamilies.has("cumulative")` → `BarChart`, unchanged.
2. `hasStateSeries && !hasMeasurementSeries` → the states `LineChart`,
   unchanged except that its tick labels now come from the first *state*
   series instead of the first series.
3. otherwise → the measurements `ComposedChart`, which grows the secondary
   axis.

The mixed case is the third branch rather than a fourth one: a chart with no
state series renders exactly as before, only with explicit `yAxisId="left"`
on the existing axis, band and lines (Recharts requires the id on every child
once a second axis exists).

```tsx
<YAxis yAxisId="left" … />
{hasStateSeries && (
  <YAxis yAxisId="state" orientation="right" domain={[0, 1]} ticks={[0, 1]}
         tickFormatter={(v) => (v >= 0.5 ? t(stateOnKey) : t(stateOffKey))} />
)}
…
<Line yAxisId={isState ? "state" : "left"} type={isState ? "stepAfter" : "monotone"} … />
```

The fixed `[0, 1]` domain matters: an empty state series would otherwise
collapse the axis, and a series that only ever reports `ON` in the window would
draw its line on the axis floor.

## Tooltip

The two existing formatters are kept as-is and a `mixedFormatter` dispatches
between them per series id, so a mixed chart shows `24.8 °C` on one row and
`Marche` on the next. Charts with no state series keep passing
`measurementFormatter` directly — same output as before, no extra lookup per
point.

## Labels

`booleanTickLabels` gains three cases. `light_state` / `appliance_state` map to
a new power pair (`Arrêt` / `Marche`) rather than the existing generic
`Inactif` / `Actif`, which reads wrong for a relay. `lock_state` gets
unlocked/locked, and `gate_state` / `cover_state` reuse the contact pair
(`Fermé` / `Ouvert`).

`gate_state` and `cover_state` are classified even though some plugins expose
them as `enum` rather than `boolean`. That is harmless: the writer stores no
`value_number` for enums, so such a binding has no points to chart either way,
and the classification is right the day a plugin reports it as a boolean.
