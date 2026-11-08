# Implementation Plan — Spec 197

Three branches from the same spec commit, each its own PR against `main` (they touch disjoint components; i18n and docs conflicts are resolved at merge):

| Branch                    | Slices     | PR content                                  |
| ------------------------- | ---------- | ------------------------------------------- |
| `feat/energy-live-flow`   | E1, E3, E4 | Flow card, headline, UPS, breakdown, layout |
| `feat/energy-arbiter`     | E2, E5     | Arbiter colours, words, history, night idle |
| `feat/energy-consumption` | E6         | Consumption, Production, SegmentedControl   |

## Slices

### Slice E1 — Read the grid

- [ ] E1.1 — `--solar-ink` token (tokens.css, index.css, tokens.md), palette test rows
- [ ] E1.2 — `live-headline.ts` helper + tests
- [ ] E1.3 — `FlowDiagram` `headline` prop; Live uses it; grid node `sub`; Live tag removed; `ariaLabel`
- [ ] E1.4 — UPS panel headline; `tag` prop removed
- [ ] E1.5 — i18n FR/EN

### Slice E3 — Desktop layout and breakdown

- [ ] E3.1 — `lg` two-column layout, phases in the right column
- [ ] E3.2 — breakdown split (active / stopped), « Autre » last full opacity, donut gaps and phone size
- [ ] E3.3 — quieter nodes and pills, `SectionHeader` icon optional, icons dropped on Live sections

### Slice E4 — Flow magnitude

- [ ] E4.1 — `flowTier()` + `powerW` on links (Live and UPS)
- [ ] E4.2 — CSS dashes replace SMIL; reduced motion
- [ ] E4.3 — end-of-route direction cue (no mid-route chevron), checked on still frames

### Slice E2 — Deficit as a state

- [x] E2.1 — `arbiterColors` deficit → `energy-grid`; sticker text per sign
- [x] E2.2 — aside wording per sign; roster « déficit » cell
- [x] E2.3 — renamed columns, formula, caption, header hints, sub-line, next-switch wording, journal wording; « Prochaine bascule » label at all widths
- [x] E2.4 — card padding, heading icon dropped

### Slice E5 — Arbiter history

- [x] E5.1 — backend: dormant pending → idle in `buildLoadTimelines` + tests; spec 165 amendment line
- [x] E5.2 — `surplusScale` helper + tests; live end point; hover crosshair
- [x] E5.3 — `mergeRuns` helper + tests; run rendering with per-quarter hit targets
- [x] E5.4 — legend from present states + « Au repos »
- [x] E5.5 — roving tabindex, focus ring, labels, `hit-44` pager; heights 88 px below `lg`, 12 h window from 768 px

### Slice E6 — Consumption and Production

- [x] E6.1 — `SegmentedControl` + tests; adopted by UnitToggle, Total/Par usage, PeriodSelector, accuracy chips
- [x] E6.2 — Consumption headline (Wh and €), legend without figures, axes kept
- [x] E6.3 — Production headline with forecast sentence; day-view axis floor from forecast max
- [x] E6.4 — forecast line styles (« Attendu » dashed neutral, « Réalisé » solar green)
- [x] E6.5 — mobile header column; forecast/health card padding and icons

### Docs

- [ ] D.1 — `docs/user/energy.md` + `.fr.md` (each branch its own sections)
- [ ] D.2 — UPS docs if the tag is described
- [ ] D.3 — `design-system/tokens.md`

## Test Plan

| Module                       | Scenario                                                   | Expected                                                       |
| ---------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `live-headline.ts`           | grid +4 900 W, solar 180 W, consumption 5 000 W            | kind import, value 4,9 kW, sentence « 4 % des 5 kW »           |
| `live-headline.ts`           | grid −1 200 W                                              | kind export, value 1,2 kW                                      |
| `live-headline.ts`           | \|grid\| < 5 W                                             | kind self                                                      |
| `live-headline.ts`           | production 0                                               | sentence « Pas de production solaire »                         |
| `live-headline.ts`           | no grid source                                             | consumption-only, no sentence                                  |
| `live-headline.ts`           | stale grid                                                 | stale age present                                              |
| `FlowDiagram`                | headline rendered; no `tag`; dashes not SMIL; tiers widths | DOM has headline, no `animateMotion`, stroke widths 2/3/4      |
| `flow-geometry` `flowTier`   | 0, 499, 500, 1 999, 2 000 W                                | tiers 1, 1, 2, 2, 3                                            |
| `UpsPanel`                   | on mains, on battery                                       | headline label/value per state; diagram renders                |
| `submeter-helpers`           | rows with 0 W and positive, « Autre »                      | active sorted, stopped names, Autre last                       |
| `arbiterColors`              | deficit / surplus sticker                                  | grid colour for deficit, never error                           |
| `ArbitrationSurface`         | deficit state                                              | « Import réseau » aside, « déficit » cells, no « −x » surplus  |
| `ArbitrationSurface`         | surplus state                                              | « Surplus disponible », watts in « Il manque »                 |
| `arbiter-timeline` (backend) | pending claim at night (dormant), pending by day           | idle at night, pending by day                                  |
| `surplusScale`               | only deficit, only surplus, both, live beyond samples      | zero placement, ≥ 15 % halves, live included, equal W/px       |
| `mergeRuns`                  | alternating, single state, empty                           | correct runs                                                   |
| `ArbiterTimeline`            | legend; keyboard ← →                                       | only present states + Au repos; focus moves                    |
| `SegmentedControl`           | click, aria-pressed                                        | onChange, pressed state                                        |
| `EnergyPage`                 | Wh and € headline                                          | total and sentence per unit; € total excludes self-consumption |
| `ProductionPage`             | forecast present / absent                                  | sentence present / absent; axis floor                          |

## Validation Plan

- `npm run validate`
- `check-specs-complete`, `check-specs-index folders`, `check-docs-parity`, `check-docs-impact`
- Visual check on the built UI against production data (read-only browsing): Live D/T/M light/dark, UPS equipment page, Consumption, Production; still frame and reduced-motion frame of the flow
