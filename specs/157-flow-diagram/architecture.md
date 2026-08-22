# Spec 157 — Architecture

## Files

| File                                             | Change                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `ui/src/components/flow/flow-geometry.ts`        | **New** — slots, edges, routes, pill placement, `flowDuration`, the prop types           |
| `ui/src/components/flow/FlowDiagram.tsx`         | **New** — the component, and nothing but the component                                   |
| `ui/src/components/flow/FlowDiagram.test.tsx`    | **New** — 17 tests on the generic behaviour                                              |
| `ui/src/components/energy/LiveEnergyPage.tsx`    | `LiveDiagram` rebuilt as a FlowDiagram caller; `Pill` and `flowDuration` deleted (moved) |
| `ui/src/components/energy/LiveDiagram.test.tsx`  | **New** — characterization test, written first                                           |
| `ui/src/components/equipments/UpsPanel.tsx`      | Rewritten on FlowDiagram + two cards                                                     |
| `ui/src/components/equipments/upsStatus.ts`      | `readUpsBindings`, `upsMarginOf`; `isUpsStatus` exported                                 |
| `ui/src/components/equipments/UpsPanel.test.tsx` | **New** — 15 tests                                                                       |
| `ui/src/components/icons/GridPylonIcon.tsx`      | **New** — the pylon, shared by Live's Réseau node and the UPS's Secteur node             |
| `ui/src/i18n/locales/{en,fr}.json`               | 46 keys                                                                                  |

The geometry/component split is not cosmetic: `react-refresh/only-export-components`
fails the lint when a `.tsx` exports a non-component, which is why `vmcSpeed.ts`
already exists beside `VmcControl` (spec 153). Same pattern here.

## Why a characterization test came first

The extraction's whole risk is silently moving a pixel on a production page
that had **no test at all**. So `LiveDiagram.test.tsx` was written against the
pre-extraction implementation and run green _before_ a line of it changed: it
pins the three route `d` strings, which strokes appear on which route in
import / export / mixed states, the node labels, the power formatting (kW with
one decimal above 1000 W, nearest 5 W below), the share pills and the status
tag. It stays in the suite afterwards as the regression guard.

That ordering is the only reason to trust the refactor, since the rendering is
SVG geometry that no type checker can vouch for.

## Reading the UPS bindings

`readUpsBindings` resolves the panel's working set in one pass. Categories win
where they are unambiguous (`ups_status`, `battery`, `battery_runtime`,
`ups_load`). `voltage` is the exception — a UPS reports both an input and a
battery voltage under it — so those two are read by alias. That is the single
place the panel cannot be category-driven, and it is commented as such.

`charging` and `replace_battery` prefer the explicit booleans the NUT plugin
pushes, falling back to a regex on the raw `status_flags` string so a different
integration that only mirrors `ups.status` still drives the charge loop.

## The margin summary

`upsMarginOf` is deliberately coarse — three buckets, thresholds at 80 % load
and 50 % charge. The rows underneath carry the detail; a header that changed on
every percent would be noise rather than a summary.

## Colours

Straight from the energy palette (spec 148), no new tokens:

| Role     | Token                               |
| -------- | ----------------------------------- |
| Mains    | `--color-energy-grid`               |
| Load     | `--color-energy-hp`                 |
| Battery  | `--color-solar-auto`                |
| Idle     | `--color-text-tertiary`             |
| Severity | `--color-warning` / `--color-error` |

The battery branch borrows the status severity during an outage: amber the
moment the mains is gone, red once the hardware calls the charge low.

## Icons

The mains node borrows Live's transmission pylon rather than picking a
lightning bolt of its own: the two surfaces look at the same grid, so the glyph
is extracted to `GridPylonIcon` and shared. Extracting it also lifts a ~1 KB
inline path out of the page component.

The battery glyph tracks the charge (`BatteryFull` / `BatteryMedium` /
`BatteryLow` / `BatteryWarning`), on the thresholds the low-battery monitor
already uses (spec 143), so the level reads before the number does. It also
drops `BatteryCharging`, whose built-in bolt claimed the unit was charging when
it was not — charging has its own branch on the diagram.
