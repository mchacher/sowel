# Architecture — Spec 197

UI-only except FR-E5.4 (one change in how the arbiter timeline reports quarters). No migration, no new endpoint, no new event.

## Flow

```
EnergyLive state (store, WebSocket)          capacity-arbiter getPublicState()
        │                                              │
LiveEnergyPage ── headline + nodes + links ──► FlowDiagram ◄── UpsPanel (headline + nodes + links)
        │                                              (shared: wells, pills, stroke tiers, CSS dashes, end caps)
        ├── LiveSubmeterBreakdown (rows, « À l'arrêt » line, donut gaps)
        ├── PhaseBreakdown
        └── ArbitrationSurface ── roster, aside, sticker (arbiterColors)
                 └── ArbiterTimeline ◄── timelines[] from buildLoadTimelines (night pending → idle)
```

## Components

### `ui/src/components/flow/FlowDiagram.tsx` and `flow-geometry.ts` (FR-E1, E3.4, E4)

- `FlowDiagramProps.headline?: { dotColor: string; label: string; value: string; unit?: string; sentence?: ReactNode }` rendered above the SVG. `tag` removed once Live and UPS no longer pass it.
- `FlowLinkSpec` gains `powerW?: number` (absolute watts on the route) from which the tier (width, dash speed) is derived by a pure helper `flowTier(powerW)` in `flow-geometry.ts`.
- The SMIL `<animateMotion>` circles are replaced by a dashed path per active link with a CSS animation class; reduced motion handled by a `@media (prefers-reduced-motion: reduce)` rule.
- Direction cue at rest: an end cap where the route meets its destination node (marker or path-drawn), never mid-route.
- Node well: `bg-surface`; percentage pill: plain text on a surface pad.

### `ui/src/components/energy/LiveEnergyPage.tsx` (FR-E1, E3.1)

- Pure helper `liveHeadline(state)` (new file `live-headline.ts`) returning `{ kind: "import" | "export" | "self" | "consumption-only", value, sentence, stale }` — tested without React.
- Grid node `sub` « import » / « export »; `ariaLabel` built from the same helper.
- Layout: `lg:grid lg:grid-cols-[7fr_5fr]` wrapper for flow + breakdown (+ phases in the right column).

### `ui/src/components/equipments/UpsPanel.tsx` (FR-E1.6, E4.5)

- Moves its status to `headline`; passes `powerW` on links.

### `ui/src/components/energy/LiveSubmeterBreakdown.tsx`, `submeter-helpers.ts` (FR-E3.2–3)

- `submeter-helpers.ts` gains the split active rows / stopped names (pure, tested).

### Arbiter (FR-E2, E5)

- `arbiterColors.ts`: deficit colour `energy-grid`; sticker text/tint per sign.
- `ArbitrationSurface.tsx`: aside wording by sign, roster columns, « déficit » cell, captions, `p-4 sm:p-6`.
- `ArbiterTimeline.tsx`: scale helper (pure, exported for tests) `surplusScale(samples, live, H)`; runs helper `mergeRuns(cells)`; hover crosshair; roving tabindex; legend from present states.
- `src/energy/arbiter-timeline.ts` `buildLoadTimelines`: receives dormant periods (or a predicate) and reports pending quarters inside them as `idle`. `capacity-arbiter.ts` passes it from the SunlightManager it already holds.

### Consumption / Production (FR-E6)

- New `ui/src/components/ui/SegmentedControl.tsx`, used by `UnitToggle`, `EnergyPage` (Total/Par usage), `PeriodSelector` (energy and the Analyse one if it is the same component), PV forecast accuracy chips.
- `EnergyPage.tsx`, `ProductionPage.tsx`: headline block; Production day-view axis floor from the forecast maximum.
- PV forecast panel: line styles.

## Files changed (expected)

| Domain   | File                                                                                                                                                         | Change                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| UI flow  | `ui/src/components/flow/FlowDiagram.tsx`, `flow-geometry.ts`, tests                                                                                          | headline, tiers, CSS dashes, end caps |
| UI live  | `LiveEnergyPage.tsx`, `live-headline.ts` (new), `LiveSubmeterBreakdown.tsx`, `submeter-helpers.ts`, `SectionHeader.tsx`, `PhaseBreakdown.tsx`, tests         | headline, layout, breakdown           |
| UI UPS   | `ui/src/components/equipments/UpsPanel.tsx`, tests                                                                                                           | headline, link power                  |
| UI arb.  | `ArbitrationSurface.tsx`, `ArbiterTimeline.tsx`, `arbiterColors.ts`, `arbiterReason.ts`, tests                                                               | colours, words, scale, runs, a11y     |
| Backend  | `src/energy/arbiter-timeline.ts`, `src/energy/capacity-arbiter.ts`, tests                                                                                    | night pending → idle                  |
| UI cons. | `EnergyPage.tsx`, `ProductionPage.tsx`, `ProductionBarChart.tsx`, `PeriodSelector.tsx`, `UnitToggle.tsx`, PV forecast panel, `ui/SegmentedControl.tsx` (new) | headline, control, forecast lines     |
| Tokens   | `design-system/tokens.css`, `tokens.md`, `ui/src/index.css`                                                                                                  | `--solar-ink`                         |
| i18n     | `ui/src/i18n/locales/fr.json`, `en.json` (or the project's locale files)                                                                                     | new and renamed strings               |
| Docs     | `docs/user/energy*.md`, UPS section, `specs/165-*/spec.md`                                                                                                   | docs delta                            |
