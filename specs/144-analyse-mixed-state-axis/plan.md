# Spec 144 — Implementation plan

Branch: `feat/analyse-mixed-state-axis`

UI-only. No type, route, event, table or migration change; `SavedChartConfig`
is untouched, so saved charts survive as-is.

> Note: the spec was originally drafted for five actuator categories. The
> shipped code narrowed this to the two strictly-binary ones (`light_state`,
> `appliance_state`); `cover_state` / `gate_state` / `lock_state` are excluded
> on purpose because they can carry a third value, which `HistoryWriter`
> encodes by declared index (spec 434). This plan describes what shipped.

## Steps

1. **Classify the binary actuator categories** — add `light_state` and
   `appliance_state` to `BOOLEAN_CATEGORIES` in
   `ui/src/components/history/history-utils.ts`, so `familyOf` and
   `isBooleanCategory` report them as `states`. `cover_state` / `gate_state` /
   `lock_state` are deliberately left out (a three-value cover would clip on a
   two-label `[0, 1]` axis); they keep charting as a plain numeric series.
2. **Family compatibility** — add `familiesCompatible(a, b)` to
   `history-utils.ts`: everything mixes except `cumulative`, which stays alone;
   `null` (unclassified) is compatible with anything. Keeping it in the utils
   file rather than inline in the picker is what lets the test file pin it down;
   `AnalyseView` has no test harness.
3. **Tick labels** — extend `booleanTickLabels` with one case: `light_state` /
   `appliance_state` map to the new power pair (`Arrêt` / `Marche`) rather than
   the generic `Inactif` / `Actif`.
4. **Chart family model** — in `AnalyseView.tsx`, replace the single
   `lockedFamily` with `chartFamilies: Set<ChartFamily>`, `hasStateSeries` and
   `hasMeasurementSeries` derived from the plotted series.
5. **Picker gate** — swap the strict first-series lock for
   `[...chartFamilies].some((f) => !familiesCompatible(f, bindingFamily))`, so a
   state binding is accepted next to a measurement and vice versa, while
   `cumulative` still refuses any other family.
6. **Render branches** — keep the three-branch order: `cumulative` →
   `BarChart` (unchanged); `hasStateSeries && !hasMeasurementSeries` → the
   states `LineChart` (unchanged, but tick labels now come from the first
   _state_ series); otherwise the measurements `ComposedChart`. In the third
   branch add `yAxisId="left"` to the existing axis, band and lines, and render
   a second `YAxis yAxisId="state" orientation="right"` with a fixed `[0, 1]`
   domain, `ticks={[0, 1]}` and semantic labels only when `hasStateSeries`.
   Each line picks `yAxisId` and `type` (`stepAfter` vs `monotone`) from whether
   its series is a state.
7. **Tooltip** — add a `mixedFormatter` that dispatches per series id between
   the existing measurement and state formatters, used only on the mixed chart;
   charts with no state series keep passing `measurementFormatter` directly.
8. **Family pill and envelope toggle** — pill reads `Mesures + états` on a mixed
   chart; the envelope toggle stays gated on measurement series only.
9. **i18n** — add `analyse.family.mixed` and `analyse.bool.power.{off,on}` to
   `ui/src/i18n/locales/{en,fr}.json`.
10. **Tests** — extend `ui/src/components/history/history-utils.test.ts` (see
    test plan below).
11. **Docs** — add the spec to `docs/specs-index.md`.

## Test Plan

### Module to test

- `ui/src/components/history/history-utils.ts` — classification,
  `familiesCompatible` and the new label pair. `AnalyseView.tsx` has no React
  test harness in this project and is covered by manual verification.

### Scenarios (`history-utils.test.ts`)

| Function             | Scenario                                     | Expected                        |
| -------------------- | -------------------------------------------- | ------------------------------- |
| `familyOf`           | `light_state`, `appliance_state`             | `states`                        |
| `familyOf`           | `cover_state`, `gate_state`, `lock_state`    | `null` (not forced onto 0/1)    |
| `familyOf`           | `setpoint`, unknown category                 | `null` (unchanged)              |
| `familiesCompatible` | `measurements` with `states` (either order)  | `true`                          |
| `familiesCompatible` | `cumulative` with `measurements` or `states` | `false`                         |
| `familiesCompatible` | `cumulative` with `cumulative`               | `true`                          |
| `familiesCompatible` | `null` with any family (either order)        | `true`                          |
| `isBooleanCategory`  | `light_state`, `appliance_state`             | `true`                          |
| `isBooleanCategory`  | `temperature`, `rain`                        | `false` (unchanged)             |
| `booleanTickLabels`  | `light_state` / `appliance_state`            | power pair (`Arrêt` / `Marche`) |

### Manual verification

- On a local dev instance, add a temperature measurement and a `light_state`
  relay (historization enabled) to one Analyse chart: measurements draw on the
  left axis, the relay draws as `stepAfter` steps on a right-hand `[0, 1]` axis
  with `Marche` / `Arrêt` ticks, and the tooltip shows `24.8 °C` on one row and
  `Marche` on the next.
- A chart holding only states is unchanged: single `[0, 1]` axis, step lines,
  semantic ticks.
- A chart holding `rain` or `energy` is unchanged and still refuses any other
  family.
- The family pill reads `Mesures + états` on a mixed chart.
- Reload a chart saved before this change: the same series come back.
