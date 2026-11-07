# Implementation Plan — Spec 196

Delivered as stacked pull requests, one per phase, one commit per slice so each slice can be reviewed alone.

## Slices

### PR A — Repair (phase 1)

- [x] 1a — Mobile breakages: Logs, PageHeader, SensorValues wrap, IntegrationRow, chart ticks, FAB padding, mobile top bar without clock, Maison strip, gutters
- [x] 2a — French copy: categories, Accueil / En direct / Marche-Arrêt, plurals, `lang`, typography, ZoneDetailPage badge key
- [x] 3a — `lib/format` + tests + lint rule (warn) + energy screens
- [x] 2b — ApiError, 429/404 texts, equipment page keeps data and reads from the store, orphan series in Analyse, gate texts and unknown state
- [x] 1b — Mobile chrome up to `lg`, `hit-44`, sliders
- [x] 3b — Remaining components on `lib/format`, lint rule to error

### PR B — Calm (phase 2)

- [x] 5a — Inter variable, type tokens, size codemod, bold → semibold, lint rule
- [x] 5b — Sentence case, mono only where allowed, flow diagram sized for its labels
- [x] 4 — Colour roles, contrast, open/closed neutral, switches, `color-scheme`, mode badges
- [x] 4b — Dark primary fill/ink, illustrations without filter, PWA splash
- [x] 7a — Neutrals and ocean night
- [x] 6 — Top bar, H1, Dashboard edit button
- [x] 7b — Radii, borderless cards
- [x] 7c — Maison panels as slices under a lid, Activité as a log

### PR C — Same gesture everywhere (phase 3)

- [x] 8a — SetpointStepper everywhere, per-integration commit delay
- [x] 8b — Explicit mobile tiles
- [x] 9 — Equipment page order, back to room, dashboard link
- [x] P — Gate confirmation on every path

### PR D — Energy palette

- [x] E — Dark values, themed legends and series, `colorIndex`

## Test Plan

| Module                | Scenario                                                 | Expected                                            |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `lib/chart-ticks`     | day period, 390 px vs 1440 px                            | interval 6 h on phone, 2 h on desktop               |
| `lib/chart-ticks`     | month and year periods on phone                          | labels never closer than the minimum gap            |
| `lib/format`          | `formatNumber(1234.5, fr)`                               | `1 234,5` with U+202F                               |
| `lib/format`          | negative value fr                                        | U+2212 sign; `-0` → `0`                             |
| `lib/format`          | `null`, `NaN`                                            | `—`                                                 |
| `lib/format`          | `formatPower` 999.6 / 1000 / 3650 W                      | `1 000 W` boundary handled, `3,7 kW`                |
| `lib/format`          | `formatEnergy` 0.704, 7.09, 14.27, 983.66                | `0,7` `7,09` `14,3` `984` kWh                       |
| `lib/format`          | `formatTemperature` 20, 20.5 compact and full            | `20,0°` `20,5°` `20,5 °C`                           |
| `lib/format`          | `formatPercent` 39                                       | `39 %`                                              |
| `lib/format`          | `formatDuration` 59, 60, 132, 3599, 3900, 86400 s        | `59 s` `1 min` `2 min 12 s` `59 min` `1 h 05` `1 j` |
| `lib/format`          | English locale                                           | dot decimal, no U+202F                              |
| `lib/format`          | unknown unit                                             | number formatted, unit verbatim                     |
| i18n                  | every `category.*` used by equipment types has fr and en | no missing key                                      |
| i18n                  | French typography lint over `fr.json`                    | no plain space before `: ; ! ?`                     |
| i18n                  | plurals `devices.count` 1 / 2                            | « 1 appareil » / « 2 appareils »                    |
| `lib/api-error`       | 429, 404, network, 500                                   | translated texts; 429 offers retry                  |
| `EquipmentDetailPage` | fetch returns 429, equipment in the store                | page shows it from the store, no notice             |
| `EquipmentDetailPage` | fetch returns 429, fetched copy only                     | page keeps it, shows a non-blocking notice          |
| `EquipmentDetailPage` | A → B (both in the store), then B deleted                | B refetched, « not found »                          |
| colour roles          | every role text/background pair, light and dark          | ≥ 4.5:1 (text), ≥ 3:1 (graphic)                     |
| `SetpointStepper`     | 4 taps within the delay                                  | one `onCommit` with the final value                 |
| `SetpointStepper`     | unmount during the delay                                 | pending value committed                             |
| `setpointCommitDelay` | cloud vs local integration                               | ≈ 600 ms vs ≈ 150 ms                                |
| `mobile-click-action` | each equipment type                                      | action and glyph match the table in the slice       |
| `useGuardedAction`    | gate requiring confirmation, pointer fine / coarse       | dialog / slide sheet; no order before confirm       |
| `useGuardedAction`    | gate not requiring confirmation                          | order sent directly                                 |
| gate texts            | open, closed, unknown                                    | « Fermer… », « Ouvrir… », « État inconnu »          |
| energy palette        | neighbouring series, series vs « Other », light and dark | the FR-E rule (spec), ≥ 3:1 against the dark card   |
| `energy.ts` (backend) | by-usage response                                        | each series has `colorIndex`, `color` unchanged     |

`formatDuration` keeps the seconds below ten minutes only: 3599 s reads « 59 min », not « 59 min 59 s ».

The core scenario of each new module (format, stepper, guarded action) is seen failing once on purpose before being fixed.

## Validation Plan

- `npm run validate` after every slice.
- `check-specs-complete`, `check-specs-index folders`, `check-docs-parity`, `check-docs-impact` before each PR.
- Visual check after each slice: the built UI served locally against production data (read-only), desktop 1440 and mobile 390, light and dark, on the reviewed screens.
- `sowel-reviewer` on each PR diff.
