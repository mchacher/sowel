# Spec 148 — Energy arbiter UI polish (design-system + redesigned timeline)

## Context

The energy arbiter UI (spec 140: `ArbitrationSurface`, `ArbiterSettings`, and the
`LiveEnergyPage` diagram it sits under) does not respect the Sowel design system
and renders poorly on mobile/PWA (issue #495). Root cause: a hand-rolled palette
of raw hex constants and Tailwind palette classes instead of semantic tokens,
which breaks dark mode; plus a fixed 840px day-timeline that is unusable on a
phone and whose greens do not match the production graph.

The full target design was validated interactively with the maintainer.

## Goals

- Tokenize the whole energy palette so every energy surface is dark-mode correct
  and consistent, and the arbiter reuses the **production graph's solar greens**.
- Replace emoji glyphs with Lucide icons.
- Redesign the arbiter timeline into a readable, mobile-friendly, quarter-hour
  ribbon + signed surplus/deficit curve, while preserving every piece of
  information the current screen shows.
- Fix the design-system nits.

## Scope and phasing

The work splits into two phases (implemented as two PRs):

**Phase A — pure front-end (this spec's primary deliverable, unblocked)**

- Promote the energy palette to shared semantic tokens `--color-solar-*` (+ the
  consumption blues) in `design-system/tokens.css`, with light+dark variants.
- Replace the hardcoded hex / Tailwind palette classes in `EnergyBarChart`,
  `ProductionBarChart`, `LiveEnergyPage`, and `ArbitrationSurface`.
- Align the arbiter state colors to the solar family (below).
- Emoji → Lucide in `ArbitrationSurface`.
- Nits: `text-error`, ≥36px tap targets, `p-4` cards, token radii.
- No data change; the existing `ArbitrationSurface` structure is re-tokenized.

**Phase B — timeline redesign (needs backend data; separate spec/PR)**

- The new quarter-hour ribbon + signed surplus/deficit curve + 6h window + 48h
  scroll + journal-linked click. Deferred because it needs a data source
  (see "Data dependency"). Phase A ships the colours/tokens the timeline will use.

The colour/state model below applies to **both** phases.

## Colour & state model (validated)

| Meaning                                      | Token                     | Value (from the production palette)            |
| -------------------------------------------- | ------------------------- | ---------------------------------------------- |
| Surplus solaire (resource / signed curve ≥0) | `--color-solar-injection` | `#2D8F3E` (INJECTION_COLOR, dark green)        |
| Accordé (surplus consumed by a load)         | `--color-solar-auto`      | `#6BCB77` (AUTOCONSO_COLOR)                    |
| Déficit (signed curve <0)                    | `--color-error`           | red                                            |
| Maison / consumption                         | `--color-solar-hp` (blue) | `#4F7BE8` family                               |
| Surplus retiré (revoked)                     | `--color-error`           | red                                            |
| On (hors pilotage)                           | `--color-slate`           | solid slate `#6E7C88` (light) / lighter (dark) |
| Idle / off                                   | neutral                   | light grey                                     |

- **On (hors pilotage)** is a single solid state in the timeline that merges the
  current `Manuel` (override) and `Marche hors arbitrage` (unclaimed-run); the
  **journal keeps the precise cause** ("pilotage manuel" / "marche hors
  arbitrage"). Solid colour, not hatched.
- Accordé uses the exact auto-consumption green so it matches the Live diagram.

## Timeline design (Phase B target)

- Per-load **quarter-hour (15-min) ribbon cells**, each showing the state at the
  end of that quarter. No multi-event indicator (loads don't oscillate; the exact
  intra-quarter detail is in the journal).
- A **signed surplus/deficit curve** on the same time axis: green above the zero
  baseline (surplus), red below (deficit), with a small **vertical kW scale**
  (zero baseline + reference gridlines + gutter labels).
- **Window = last 6 hours**, "now" at the right edge; **prev/next** back to **48h**
  of depth (day markers aujourd'hui/hier/...).
- The **decision journal stays permanently below**; **clicking a cell** highlights
  and scrolls the journal to that quarter's entries.

## Preserve all current info (parity, re-tokenized)

- "Répartition en cours" allocation bar (Maison + granted segments + Surplus libre).
- "En attente de surplus" list with full detail:
  `en attente de surplus (besoin de {W})` + `charge {W}, tolère {W} de soutirage`.
- The decision journal and the real labels (`Accordé (surplus)`, `Surplus retiré`,
  `On (hors pilotage)`).
- **Remove** the top status pill ("Actif · X kW libre") — low value.

## PWA / mobile

Web and mobile must read the same: allocation-bar caption on narrow widths,
single-line header, tuned label gutters and legend, cells that fit a phone. No
horizontal overflow.

## Data dependency (Phase B)

The 48h timeline needs 48h of history at 15-min resolution:

- **Per-load state** (accordé/retiré/hors pilotage) is reconstructable from the
  **persisted arbiter decision journal** (spec 147, 7-day retention).
- **Signed surplus/deficit series**: today `surplusSeries` is in-memory and 24h
  only (`capacity-arbiter.ts:160,820`). Phase B must either persist/extend it to
  ≥48h or derive the 15-min signed grid power from the InfluxDB energy history.
- A **new read endpoint** assembles the window (reconstructed per-load intervals +
  surplus series) for the UI.

## Acceptance criteria — Phase A

- [ ] `--color-solar-*` (+ consumption blues) tokens exist in
      `design-system/tokens.css` with light+dark variants.
- [ ] No raw hex or Tailwind palette color remains in `ArbitrationSurface.tsx`,
      `LiveEnergyPage.tsx`, `ArbiterSettings.tsx`, `EnergyBarChart.tsx`,
      `ProductionBarChart.tsx`.
- [ ] Arbiter and production/energy charts share the same solar greens; dark mode
      renders correctly.
- [ ] Emoji glyphs replaced by Lucide (stroke 1.5).
- [ ] `Manuel` + `Marche hors arbitrage` merged to a single solid "On (hors
      pilotage)" state in the surface; journal keeps the precise cause.
- [ ] Status pill removed; all other current info preserved and re-tokenized.
- [ ] Nits fixed (`text-error`, tap targets ≥36px, `p-4`, token radii).
- [ ] No functional / arbitration-logic change.

## Out of scope

- Phase B timeline data source and endpoint (separate spec/PR).
- Any change to arbitration logic or the data model.

## Edge cases

- Existing installs: token changes are visual-only; no migration.
- No-PV homes never see the arbiter surface (unchanged).
- Dark mode: every new token must have a dark value that keeps contrast.
