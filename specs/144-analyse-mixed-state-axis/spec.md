# Spec 144 — States and measurements on one Analyse chart

> Shipped-scope note: this spec was drafted for five actuator categories, but
> the shipped code classifies only the two strictly-binary ones (`light_state`,
> `appliance_state`) as `states`. `cover_state` / `gate_state` / `lock_state`
> are excluded on purpose (they can carry a third value, which `HistoryWriter`
> encodes by declared index, spec 434), so AC1's five-category list and the
> lock/gate/cover tick labels below describe the original design, not what
> ships. See plan.md for the shipped behaviour.

## Context

Following a water heater means reading two series together: the tank
temperature and the relay that heats it. The temperature answers _how hot_, the
relay answers _why_ — a rise with no relay activity is solar gain or a wrong
sensor, a relay run with no rise is a dead element. Separately, neither series
says much; overlaid, they are a diagnosis.

The Analyse page could not draw them together. Two rules stood in the way, both
from spec 118:

1. **The state categories of actuators were not classified.** `BOOLEAN_CATEGORIES`
   in `ui/src/components/history/history-utils.ts` listed the sensor states
   (`motion`, `contact_door`, `contact_window`, `water_leak`, `smoke`) and
   nothing else. A water heater's relay reports `light_state` — the category
   every on/off actuator binding gets — so `familyOf("light_state")` returned
   `null`, and the series fell through to the measurements branch: smooth
   `monotone` interpolation between 0 and 1 (a relay does not ramp), and a
   tooltip reading `0` / `1` instead of the state.

2. **F7 locked a chart to one family.** The metric picker disabled any binding
   whose family differed from the first series'. Once `light_state` is
   classified as `states`, that lock would forbid the very combination this
   spec is about.

Simply allowing the mix is not enough either: a single Y axis shared by a
24→63 °C curve and a 0/1 series squeezes the state into the bottom ~2 % of the
plot, which is how the relay reads today when its category is unclassified.

## Goals

1. A chart can hold measurement series and state series at once, each on a
   scale where it is readable.
2. An actuator's on/off feedback is charted as what it is — steps, and
   Marche/Arrêt in the tooltip and on the axis.
3. The bar family (`rain` / `energy`) keeps its exclusivity: it owns the plot.
4. No change to what is historized. Actuator states stay opt-in per binding
   (`HistoryWriter.resolveHistorize` defaults them off); this spec is about what
   the page does with them once the user turns them on.

## Non-goals

- Historizing actuator states by default. The relay of every light in a house
  is a lot of points for a series most users will never plot.
- A per-series axis. Two measurement series still share the left axis, as
  before — the split is by family, not by unit.
- Backend changes. `queryHistory` already forces `raw` resolution and
  `stepAfter` rendering for `boolean`/`enum` bindings, and `HistoryWriter`
  already writes a `0`/`1` `value_number` for booleans.

## Acceptance criteria

- [x] `familyOf` classifies `light_state`, `appliance_state`, `lock_state`,
      `gate_state` and `cover_state` as `states`.
- [x] The metric picker accepts a state binding on a chart that already holds a
      measurement, and vice versa.
- [x] A chart holding both renders the measurements on the left axis and the
      states on a right-hand axis with domain `[0, 1]` and ticks labelled with
      the category's semantic pair.
- [x] State series render as `stepAfter` on a mixed chart, as they already do
      on a states-only chart.
- [x] The tooltip picks its formatter per series: `24.8 °C` for the
      measurement, `Marche` / `Arrêt` (or `62 % Marche` on an aggregated
      bucket) for the state.
- [x] A chart holding only states is unchanged: single `[0, 1]` axis, step
      lines, semantic ticks.
- [x] A chart holding `rain` or `energy` is unchanged, and still refuses any
      other family.
- [x] The family pill reads `Mesures + états` on a mixed chart.
- [x] Saved charts keep working: `SavedChartConfig` is untouched, and a chart
      saved before this change reloads with the same series.

## Edge cases

- **State series with no points yet.** Historization is opt-in and the writer
  only emits on transition, so a freshly enabled relay has an empty series until
  it next switches. The right axis renders anyway (fixed `[0, 1]` domain) and
  the line appears at the first transition.
- **Several state categories on one chart.** The right axis has one pair of tick
  labels; it takes them from the first state series. The tooltip stays exact —
  it resolves labels per series.
- **Mismatched resolutions.** States are always `raw` while measurements may be
  aggregated to `1h`/`1d`. The merged dataset therefore has rows where only one
  series has a value; `connectNulls` already covers it.
- **Unclassified categories** (`familyOf` → `null`, e.g. `setpoint`) keep their
  pre-144 behaviour: charted on the left axis, accepted next to anything.
