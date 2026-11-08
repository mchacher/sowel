# Spec 197 — Energy pages refresh

## Context

On 2026-11-08 five independent design reviews (Impeccable critique, Impeccable audit with the Vercel Web Interface Guidelines, ux-ui-audit, taste/frontend-design, dataviz with UI UX Pro Max) read the Energy pages of `main` (v1.80.0) on production data, desktop, tablet and phone, light and dark. They agreed on four points:

- **Live does not answer its first question.** "Am I importing or exporting, and how much?" is shown only by a `↑`/`↓` glyph on the grid node; the status tag says « Appoint solaire » while 96 % comes from the grid; the biggest figure is consumption.
- **An ordinary morning reads as a fault.** The arbiter paints a deficit in the error red, states the same −4,8 kW four times (one of them captioned « Export réseau instantané » while the house imports), and fills the night with orange « En attente » cells.
- **Half of the desktop is empty.** The flow diagram, the breakdown and the phase bars are capped at 600 px without centring; the arbiter starts below the fold at 1440 × 900.
- **Consumption and Production give their answer last.** The total is a sentence under the chart; four segmented-control styles coexist.

The maintainer chose an option for each of 17 questions in the decisions artifact (https://claude.ai/artifact/7xRPLyfajoYg1Kuy1SxNrP, db collection `decisions`): every recommendation was taken, with two notes (E4: no chevron in the middle of a route, find a better design; E6: the charts keep their axes). The incremental-only rule of spec 196 applies: no new visual language, no new information architecture, the spec 196 decisions stand.

Some review findings were fixed on `main` after the screenshots by #1142 (#1126): flow values and tooltip rows in ink, the PV forecast « Attendu » curve no longer amber. This spec starts from that state.

## Goals

1. Live says import or export in words, with one large figure, in the first 100 px of every viewport.
2. A deficit is a state drawn in the grid's slate blue, said once, in words a household member reads.
3. Desktop uses its width: flow and breakdown side by side, the arbiter visible without scrolling at 1440 × 900.
4. The arbiter history is drawn to scale, reads as durations, and is calm at night.
5. The flow animation shows magnitude and respects reduced motion, on Live and on the UPS panel alike.
6. Consumption and Production lead with their total and share one segmented control.

## Non-Goals

- No change to the energy palette (spec 196 decision `energie-solaire`); one text-only ink token is added (FR-E1.4).
- No change to arbiter decisions, claims or metrics (spec 140/158): FR-E5.4 changes only how the timeline reports quarters.
- No new page, no new route, no new API endpoint.
- The two data inconsistencies seen during the review (PAC « Au repos » in the roster while running in the ribbon; history curve ending far from the headline surplus) are diagnosed separately (`sowel-debug`); a fix, if any, is its own PR.

## Decisions (maintainer, 2026-11-08)

| Id           | Decision                                                                                                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| e1-forme     | Balance line at the top of the flow card (40 px figure) and the word under the grid node                                                                                                                                                                                                              |
| e1-mots      | « Import / Export » (not « Achat / Vente »)                                                                                                                                                                                                                                                           |
| e1-encre     | A text-only solar ink, `#1E7B34` in light; fills unchanged                                                                                                                                                                                                                                            |
| e2-pastille  | Sticker « Déficit 4,8 kW » on a neutral slate tint                                                                                                                                                                                                                                                    |
| e2-manque    | « déficit » in grey instead of the per-row missing watts while in deficit                                                                                                                                                                                                                             |
| e2-vocab     | Renamed columns and formula, « par ordre de priorité » caption, sub-line removed, header hints, journal                                                                                                                                                                                               |
| e3-desktop   | Flow and breakdown side by side from `lg`                                                                                                                                                                                                                                                             |
| e3-forme     | Keep the donut, 2 px gaps between segments, smaller on phones                                                                                                                                                                                                                                         |
| e3-autre     | « Autre » stays last, full opacity, « non mesuré »                                                                                                                                                                                                                                                    |
| e3-sobre     | Nodes without tinted wells, percentages as plain text, no icons in Energy section headings                                                                                                                                                                                                            |
| e4-anim      | ~~CSS dashes, width and speed by power tier~~ → **Ruban** (2026-11-08, see below), **at one constant width** (maintainer review of PR #1159: a width following the power « fait moche »); the magnitude is carried by the wave's speed and the share bars; **no mid-route chevron** (maintainer note) |
| e5-echelle   | Zero placed from the window's peaks, live end point, hover readout                                                                                                                                                                                                                                    |
| e5-ruban     | Contiguous equal quarters merge into runs                                                                                                                                                                                                                                                             |
| e5-nuit      | Pending demand while the arbiter is dormant reported as idle, server-side                                                                                                                                                                                                                             |
| e6-tete      | A 28 px total and one sentence at the top of the card                                                                                                                                                                                                                                                 |
| e6-prevision | « Attendu » dashed neutral, « Réalisé » solar green                                                                                                                                                                                                                                                   |
| e6-segment   | One shared segmented control; **charts keep their axes** (maintainer note)                                                                                                                                                                                                                            |
| e7-noeud     | Shares on the nodes: a bar under the value (« Barre sous la valeur »), the route percentages removed                                                                                                                                                                                                  |

**Amendment, 2026-11-08 (after PR #1158).** A design exploration of the flow, shot on still frames of the real Live and UPS cards in both themes, offered the maintainer several directions (pages « flux-propositions », direction 1 « Ruban », and « ruban-declinaisons », declination 2 « Barre sous la valeur »). He chose the **Ruban** for `e4-anim` and the **share bar under the value** (« sans hésiter ») as a new decision `e7-noeud`. FR-E4 below is rewritten for the ribbon and FR-E7 added; the tier dots of the first FR-E4 are replaced, the end arrowhead stays as the ribbon's head.

## Functional Requirements

### FR-E1 — Read the grid (Live flow card)

1. **Balance line.** `FlowDiagram` gains an optional `headline` prop rendered at the top of the diagram's card area: a line `text-small text-text-secondary` with an 8 px dot in a given colour and a label; a value in `text-value` (40 px, semibold, ink, tabular) with its unit in `text-lead text-text-tertiary`; an optional sentence `text-small text-text-secondary`. Live sets it:
   - importing: dot `energy-grid`, « Import réseau », the grid power, « Le soleil couvre {pct} des {consumption} consommés » (or « Pas de production solaire » when production is 0);
   - exporting: dot `solar-injection`, « Export réseau », the exported power, « La maison consomme {consumption}, tout vient du soleil »;
   - balanced (|grid| < 5 W): dot `solar-auto`, « Autonome », the consumption, « Le soleil couvre 100 % des {consumption} consommés »;
   - a stale source adds « · relevé il y a {age} » in `warning-ink` to the sentence; the spec 179/#744 staleness banner stays.
2. **Word under the grid node.** The grid node shows « import » / « export » through `FlowNodeSpec.sub` (nothing under 5 W). The arrow glyph is dropped from the value.
3. **Status tag retired on Live.** The `tag` band (« Appoint solaire » and its siblings) is no longer rendered on Live; the headline replaces it.
4. **Solar ink.** New token `--solar-ink` (light `#1E7B34`, dark `var(--solar-auto)`) and Tailwind `--color-solar-ink`, for any solar figure or word drawn as text (production node value if coloured, arbiter « Accordé » words if solar-tinted). Fills, routes and bubbles keep the decided greens. `energy-palette.test.ts` gains the light-theme rows.
5. **Screen readers.** Live passes an `ariaLabel` to `FlowDiagram` (« Consommation 5 kW : 96 % depuis le réseau, import 4,9 kW ; 4 % du solaire, production 180 W. ») as the UPS already does; when an `ariaLabel` is present the visible pills, nodes and headline figures are `aria-hidden`.
6. **UPS consistency.** The UPS panel moves its status from `tag` to `headline`: dot in its severity colour, label = its status (« Sur secteur », « Sur batterie »…), value = load power on mains / runtime on battery, sentence = the other figure (« Autonomie 45 min » / « Charge 23 % »). The `tag` prop is then unused and removed from `FlowDiagram`.

### FR-E2 — A deficit is a state (arbiter, colours and words)

1. Deficit colour: the arbiter sticker, the aside figure and the curve's negative area and line use `energy-grid` instead of `error`. Red stays for « Surplus retiré » only.
2. Sticker: in deficit « Déficit {kW} » on an `energy-grid` 12 % tint, text `text-secondary`; in surplus « Surplus {kW} » on a `solar-auto` tint, text `text-secondary` (or `solar-ink`). Other sticker states (inactive, degraded) unchanged.
3. Aside: in deficit, label « Import réseau », figure (ink, `text-title`, slate dot), hint « Aucune charge ne peut démarrer ». In surplus unchanged: « Surplus disponible », figure, « Export réseau instantané ».
4. Roster « Il manque » column: while in deficit, waiting rows show « déficit » (`text-caption text-text-tertiary`) instead of the watts in orange; the watts return when surplus is positive.
5. Words (FR and EN): « Charge » → « Puissance », « Tolère » → « Import toléré », « Besoin » → « Surplus requis », « Manque » → « Il manque »; formula « Surplus requis = puissance + 100 W de marge − import toléré »; caption « Charges par ordre de priorité. » after the state sentence; the sub-line « en attente de surplus » is removed when the pill says « En attente »; each column header carries a one-sentence `title` hint; « Démarre à 600 W, il en manque … » → « Démarrera dès 600 W de surplus »; journal « libéré » → « n'attend plus le surplus », « pilotage repris · le pilotage manuel a expiré » → « reprise automatique · fin du pilotage manuel ».
6. « Prochaine bascule » keeps its label at every width.
7. The arbitration card pads `p-4 sm:p-6` like the other cards and loses its heading icon (FR-E3.4).

### FR-E3 — Desktop layout and the breakdown (Live)

1. From `lg` (1024 px): the flow card and the breakdown card sit in one row, `grid-cols-[7fr_5fr]`, equal height; the diagram is centred in its column; `PhaseBreakdown`, when present, goes under the breakdown in the right column. Below `lg`, the order and stacking are unchanged.
2. Breakdown rows: rows above 0 W (after the existing rounding) only, sorted by power; then one line `text-caption text-text-tertiary` « À l'arrêt : Piscine, Congélateur, … »; « Autre » last, full opacity, with « non mesuré » in `text-micro text-text-tertiary`. Stale/offline rows keep their own wording (spec 179/#744). The donut segment order follows the list.
3. Donut: 2 px gaps between segments in the card's surface colour; 140 px below `sm` (180 today). The centre keeps the total.
4. Quieter cards: flow nodes lose their tinted well (`bg-surface`), percentages become plain `text-caption text-text-secondary` text on a surface pad (no border), and the Energy section headings (`SectionHeader` on Live, phases, breakdown, arbiter; the Production forecast and health panels) render without an icon. The `icon` prop becomes optional.

### FR-E4 — A flow that shows magnitude (shared FlowDiagram, « Ruban »)

1. **Ribbon width.** Every active route is a band of one constant width, in screen pixels (`vector-effect: non-scaling-stroke`): 6 px, the share bar's thickness, and 5 px in a narrow diagram (under 32 rem, container query). The first draft made the width follow the power (2.5–18 px); the maintainer turned it down on review (« ça fait moche »): how much flows is told by the wave's speed (FR-E4.2) and the share bars (FR-E7). A route under 5 W is skeleton only.
2. **Tint, wave, halo.** The band is the route's colour mixed into the card (`color-mix`, 36 % light, 40 % dark). A wave of three stacked dashes (lengths L, 0.6 L, 0.3 L with L = 26 + 2 w; opacities 0.3, 0.55, 1; one every 150 px) moves along it in CSS at a continuous speed, 18 + 70 · √(min(P, 8 kW) / 3 kW) px/s. In dark, a faint halo: a stroke 9 px wider at 16 % opacity, no filter. An opacity of the same strength sits under the `color-mix` as a guard (Tailwind 4 already needs Safari 16.4, which has `color-mix`). The wave's CSS cycle has one fixed length; the power sets its playback rate (Web Animations API), so a new reading does not make it jump, and its keyframes use no custom property.
3. **No chevron in the middle of a route** (maintainer note). Direction at rest is the ribbon's head: a solid arrowhead of one size where the route enters its destination node (base w + 10, length 0.55 w + 7 from the constant width, narrow and wide), on a pad in the card's colour, its tip on the node's edge. The dark halo is constant too.
4. Under `prefers-reduced-motion: reduce`, no wave; the band takes more colour (72 %); its head still says which way, and the share bars how much.
5. The UPS panel gets the same rendering through the shared component; the caller passes the power per link, which sets the wave's speed (UPS load; the charge loop, with no reading, moves at the slowest speed).
6. The export route (solar → grid) takes the injection green, like the headline's export dot.

### FR-E5 — Arbiter history

1. Scale: the zero line is placed from the window's own peaks, `y0 = H · maxPos / (maxPos + maxNeg)`, each half at least 15 % of H; the same W/px ratio on both sides; each half labelled with its peak (« +0,3 kW », « 4,8 kW import »). The live surplus value is included in the peaks.
2. Live end point: a dot (r 4, 2 px surface ring) at the right edge in the half's colour, with its value in `text-caption` ink.
3. Hover: a crosshair snapping to the 15-min column across curve and ribbons, tooltip « 06:15 », « Import 4,1 kW », then one line per lane in a non-idle state. Touch keeps today's cell selection (journal scroll).
4. Night: a quarter where a load's claim was pending while the arbiter was dormant (sun below the horizon, no surplus possible) is reported `idle` by `buildLoadTimelines`; roster and ribbon keep one source (spec 165). Spec 165 is amended by one line. Arbiter metrics (spec 158) read surplus samples and are unaffected.
5. Ribbons: contiguous quarters with the same state render as one run per lane (12 px, `rounded-xs`, 1 px gap only between different states); each quarter remains a hit target selecting that quarter. « En attente » keeps its orange tint with a 1 px edge on the run.
6. Legend: only the states present in the window, plus « Au repos », swatches shaped like the runs.
7. Access: each lane is one tab stop (`role="group"`, `aria-label` = load name), ← → move between quarters, Enter selects; visible `focus-visible` ring; each quarter's label reads « Chauffe-eau, 22 h 15, en attente ». History pager buttons get `hit-44` (drawing unchanged).
8. Sizes: curve height 88 px below `lg` (56 today); from 768 px the tablet gets the 12 h window.

### FR-E6 — Consumption and Production lead with the figure

1. Consumption: at the top of the chart card, the period total in `text-display` (28 px) with the period word in `text-small text-text-tertiary` (« aujourd'hui », « cette semaine »…), then « {HP} en heures pleines · {HC} en heures creuses · {pct} autoconsommé » in `text-small text-text-secondary`; in € mode the same in euros (the € total keeps excluding self-consumption). The legend under the chart keeps swatches and names only. **The chart keeps its axes and tick labels** (maintainer note).
2. Production: at the top of the chart card, the produced energy in `text-display` with « sur {forecast} attendus aujourd'hui » when a forecast exists for the period; on the day view the axis floor rises to the larger of the real maximum and the forecast maximum, so a morning shows the expected shape instead of an empty frame. Axes and ticks kept.
3. PV forecast: « Attendu » a dashed neutral line (`text-tertiary`, 1.5 px, 4-3), « Réalisé » solid `solar-production` 2 px; legend keys mirror the strokes. Same on the equipment page that shares the panel.
4. One `SegmentedControl` (`ui/src/components/ui/`): `border border-border rounded-sm`, segments `px-3 py-1.5 text-caption font-medium`, selected `bg-primary-fill text-white`, `aria-pressed`, `hit-44`. It replaces the Wh/€ toggle, Total/Par usage, the period tabs of `PeriodSelector` (shared with Analyse) and the 1j–90j chips of the forecast accuracy.
5. Mobile header of Consumption and Production: one left-aligned column, the period control full width.
6. The forecast and health cards pad `p-4 sm:p-6` and lose their heading icon (FR-E3.4).

### FR-E7 — Shares on the nodes (shared FlowDiagram, « Barre sous la valeur »)

1. **Route percentages removed.** No figure is drawn on or beside a route any more.
2. **Share bar.** `FlowNodeSpec.bar` draws a 6 px bar under the node's value (76 / 96 px under the focal node, 58 / 72 px under a satellite, narrow / wide), segmented in route order and in the routes' colours, 2 px between segments; when it has two parts or more, the first and last percentages sit at its ends (`text-micro`, secondary). The percentages are whole and add up to 100.
3. **Live.** The house always shows its sources, grid then solar (a full slate bar at night, a full green bar on export or self-powered); its solar end equals the headline's « Le soleil couvre {pct} ». The panel shows a bar only while it splits its production, house then export (« 46 % | 54 % »). The grid, a single flow, shows none.
4. **UPS.** A UPS splits nothing: its bars are levels, one part over the track, with no figure (the value above says it). The load (« 11 % ») in the colour of the source carrying it (grid on mains, the severity colour on battery); the battery's charge, green on mains, the severity colour on battery. The mains node shows none. « en charge » moves from a route pill to the battery's sub-line.
5. **Node layout.** A node is built around its icon: the icon's centre sits where the routes meet it, the label above, the value, sub-line and bar below; each part is a box in the card's colour masking the routes under it, and the heads sit on the boxes' real edges. The narrow diagram is 280 px tall (260 before).
6. **Access.** The bar is `aria-hidden`; the diagram's `ariaLabel` carries the shares (the house's in the import sentence, the panel's split in the export sentence, the UPS load's share of its capacity).

## Acceptance Criteria

- [x] AC1 — Live shows « Import réseau » / « Export réseau » / « Autonome » with a 40 px figure above the diagram on desktop, tablet and phone; the grid node says « import » / « export »; no « Appoint solaire » band.
- [x] AC2 — The UPS panel shows its status as the same headline; its diagram still renders on mains and on battery; no `tag` prop remains.
- [x] AC3 — No arbiter element is red in a plain deficit; the deficit figure appears once in the sticker and once in the aside, never as « Surplus disponible −x »; « Export réseau instantané » appears only with a positive surplus.
- [x] AC4 — The roster uses « Puissance / Import toléré / Surplus requis / Il manque » and shows « déficit » in waiting rows while in deficit.
- [x] AC5 — At 1440 × 900 the flow and the breakdown share one row and the arbiter heading is visible without scrolling.
- [x] AC6 — Zero-watt rows fold into one « À l'arrêt » line; « Autre » is last at full opacity; donut segments have gaps.
- [x] AC7 — Flow routes are ribbons of one constant width (6 px, 5 px narrow) with a CSS wave whose speed follows the power (no SMIL), a head of one size at their end and no mid-route mark; under reduced motion no wave and a stronger tint.
- [x] AC8 — The arbiter curve draws equal watts at equal heights on both sides, ends on a live dot, and shows a hover readout.
- [x] AC9 — Pending claims during the dormant night are `idle` in `buildLoadTimelines`; ribbons render runs; the legend lists only present states plus « Au repos ».
- [x] AC10 — Lanes are keyboard-navigable with a visible focus ring.
- [x] AC11 — Consumption and Production open on their total; charts keep their axes; the forecast « Attendu » is dashed neutral and « Réalisé » solar green.
- [x] AC12 — One `SegmentedControl` across Consumption, Production and Analyse, with `aria-pressed`.
- [ ] AC13 — `npm run validate` green; docs EN/FR updated.
- [x] AC14 — No percentage on the routes; the house shows its share bar in every state, the panel only while it splits, the UPS its load and battery levels; the bars are hidden from screen readers.

## Edge Cases

- No main meter or no production source: the headline falls back to « Consommation {kW} » with no sentence (the diagram already degrades the same way).
- Stale grid reading: headline sentence carries the age; the figure stays (dimmed like the node).
- Arbiter disabled or degraded: sticker behaviour of spec 148 unchanged.
- History window entirely in surplus or entirely in deficit: the absent half takes its 15 % minimum and its own label, so zero stays readable.
- A window with a single state per lane: one run per lane, still one hit target per quarter.
- UPS with no load reading: headline value « ? » as the node does today.
- Production day view with no forecast: axis behaviour unchanged, no « attendus » sentence.

## Docs Delta

| Page (EN and FR)                           | Change                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/user/energy.md` + `.fr.md`           | Live: the headline (import/export/autonomous), the ribbons and the share bars (FR-E4, E7), the side-by-side desktop layout, the folded zero rows; arbiter: new column names, deficit wording, history runs and night idle; Consumption/Production: total at the top, forecast line styles |
| `docs/user/equipments.md` + `.fr.md` (UPS) | The UPS status now reads as the headline above the diagram (if the page describes the tag)                                                                                                                                                                                                |
| `specs/165-*/spec.md`                      | One-line amendment: pending quarters while the arbiter is dormant are reported idle (spec 197)                                                                                                                                                                                            |
| `design-system/tokens.md`                  | `--solar-ink`; `SegmentedControl` in the components list                                                                                                                                                                                                                                  |

Screenshots to retake: Energy Live (desktop, mobile), Energy Consumption, Energy Production, UPS panel, if the docs carry them.
