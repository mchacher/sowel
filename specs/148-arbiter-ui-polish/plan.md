# Spec 148 — Implementation plan

Two PRs. This plan covers **Phase A** (front-end polish, unblocked). Phase B
(timeline redesign + data endpoint) gets its own spec/PR.

Branch (Phase A): `feat/issue-495-arbiter-ui-tokens`

## Phase A tasks

- [ ] 1. `design-system/tokens.css` + `ui/src/index.css`: add the energy palette
     tokens (`--color-solar-injection/-auto/-production`, `--color-energy-hp/-hc/-grid`,
     `--color-slate`) with light + dark variants and Tailwind aliases.
- [ ] 2. `ui/src/components/energy/arbiterColors.ts`: pure `arbiterStateColor(kind)`
     helper (merges manual+unclaimed → slate).
- [ ] 3. `EnergyBarChart.tsx` / `ProductionBarChart.tsx`: replace hex constants
     with the tokens.
- [ ] 4. `LiveEnergyPage.tsx`: replace hex constants + inline hex styles with tokens.
- [ ] 5. `ArbitrationSurface.tsx`: replace the 7 hex + palette classes with tokens
     via `arbiterStateColor`; merge manual+unclaimed into one "On (hors pilotage)"
     solid state + single legend entry; keep journal cause text; emoji → Lucide.
- [ ] 6. `ArbiterSettings.tsx`: `text-red-500` → `text-error`; ≥36px tap targets;
     `p-4`; token radii.
- [ ] 7. Remove the status pill from the surface (if present) / keep all other info.
- [ ] 8. Tests: `arbiterColors.test.ts`.

### Docs / release

- [ ] 9. `sowel-docs` if any user-facing doc shows the arbiter colours.
- [ ] 10. Release notes (EN + FR) at release time (spec 108).

## Test Plan

### Modules to test

- `arbiterColors` (the only new pure logic in Phase A).

The rest is styling/tokens (no React component tests, per project convention) —
verified by manual light+dark screenshots on the shadow instance.

### Scenarios

| Module        | Scenario     | Expected                                      |
| ------------- | ------------ | --------------------------------------------- |
| arbiterColors | granted      | `var(--color-solar-auto)`                     |
| arbiterColors | revoked      | `var(--color-error)`                          |
| arbiterColors | manual       | `var(--color-slate)`                          |
| arbiterColors | unclaimed    | `var(--color-slate)` (merged, same as manual) |
| arbiterColors | idle/unknown | neutral token                                 |

### Manual verification (shadow, light + dark)

- Arbiter surface + Live diagram + energy bar charts render with the solar-family
  colours; dark mode is correct (no light-mode colours on dark surfaces).
- Accordé green matches the Live diagram's auto-consumption green.
- "On (hors pilotage)" is a single solid slate state; journal still shows the
  precise cause.
- No emoji glyphs remain; icons are Lucide.
- Priority reorder buttons are comfortable to tap; cards use `p-4`.
- No visual regression in light mode; no functional change.
