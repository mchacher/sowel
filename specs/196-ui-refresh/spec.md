# Spec 196 — Incremental UI refresh

## Context

In November 2026 five independent UI/UX reviews of production (desktop and mobile, light and dark) found that the UI breaks on phones in several places, that its French copy and number formatting are inconsistent, and that it reads as a generic AI-generated dashboard: tracked uppercase labels at three levels, JetBrains Mono on every number, pills everywhere, Tailwind zinc greys, a "Linear-ish night" dark theme with a neon `brightness(1.6)` filter, and amber used for a dozen meanings. The design system itself (`design-system/README.md`) was derived from Anthropic's `frontend-design` skill.

The maintainer rejected every radical redesign and chose an incremental path that keeps the identity (logo, ocean `#1A4F6E`, amber `#F2C035`) and the information architecture. Forty-one decisions were taken on that path (option per question, listed below). This spec turns them into requirements.

## Goals

1. Nothing breaks on a 360–430 px phone or a 768–1023 px tablet.
2. The French UI reads as French: no English leaks, no raw keys, correct plurals, one number format.
3. The UI stops looking generic: sentence-case labels, Inter numerals, one meaning per colour, brand-tinted neutrals, a readable dark theme.
4. The same gesture works the same way everywhere (setpoint, tile tap, gate confirmation).

## Non-Goals

- No new visual identity, no new font family, no new navigation model, no merged Dashboard/Maison.
- No redesign of the dashboard illustrations (`WidgetIcons.tsx`) beyond their dark-mode colours.
- No backend change except the additive `colorIndex` field (FR-E).
- Plugin-side strings (Tuya charger labels, MCZ messages) are handled here only where the UI can map them; the rest is a plugin release.

## Decisions (maintainer, 2026-11-07)

| Id                | Decision                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------- |
| pr1-tablette      | Mobile chrome up to `lg` (1024 px)                                                        |
| pr1-barre         | Mobile top bar: remove the clock only                                                     |
| pr1-cibles        | 44 px invisible hit areas (`hit-44`), drawing unchanged                                   |
| pr1-fab           | Bottom padding under the grid now; FAB removed in FR-6                                    |
| pr2-onoff         | « Marche / Arrêt » everywhere                                                             |
| pr2-dashboard     | "Dashboard" becomes « Accueil » (docs FR updated)                                         |
| pr2-apostrophe    | Straight apostrophe kept                                                                  |
| pr2-jargon        | Admin technical terms kept (broker, topic, plugin)                                        |
| pr3-degre         | « 20,5° » in tiles/rows/strips, « 20,5 °C » in pages, axes, tooltips                      |
| pr3-zero          | One fixed decimal for temperatures and setpoints; trailing zeros dropped elsewhere        |
| pr3-kwh           | kWh adaptive, 3 significant digits, at most 2 decimals                                    |
| pr3-kw            | Whole W below 1 000 W, then kW with 1 decimal                                             |
| pr5-police        | Keep Inter, variable build                                                                |
| pr5-mono          | Mono only for logs, JSON, ids, versions, code fields                                      |
| pr5-codemod       | Script for sizes and bold, by hand for uppercase and mono                                 |
| pr4-ambre         | Amber = something on or running now                                                       |
| pr4-ouvert        | Open/closed are neutral (word + icon)                                                     |
| pr4-niveaux       | Three levels: amber (on), orange (attention), red (fault)                                 |
| pr4bis-primaire   | Dark primary button: `#2B7299` fill, white text                                           |
| pr6-horloge       | Clock only when the browser time zone differs from the home's                             |
| pr6-soleil        | Sunrise/sunset as plain text in the desktop bar, root-zone strip on mobile                |
| pr6-h1            | H1 = page name + optional one-line summary                                                |
| pr6-edition       | Dashboard edit: a button under the grid, sticky bar in edit mode                          |
| pr7-teinte        | Light brand tint in neutrals                                                              |
| pr7-bordures      | Cards without border (shadow in light, tone in dark)                                      |
| pr7-sombre        | Ocean-derived night base                                                                  |
| pr7-rayons        | Radii 6 / 10 / 16                                                                         |
| pr8-envoi         | One order after the last tap; delay per integration (cloud ~600 ms, local near-immediate) |
| pr8-perimetre     | Stepper also for EV current, charge limit, numeric extras                                 |
| pr8-geste         | Corner glyph shows what a tap does                                                        |
| pr8-ligne         | Compact inline stepper in Maison rows                                                     |
| pr9-config        | Configuration card at the bottom, rows collapsed                                          |
| pr9-retour        | Back goes to the equipment's room when origin unknown                                     |
| pr9-dashboard     | Link to the page from the dashboard (sheet footer, tile title)                            |
| pr9-graphique     | 24 h chart open by default                                                                |
| portail-perimetre | Confirm on every UI path where one tap/click actuates a gate                              |
| portail-desktop   | Two-button dialog on desktop                                                              |
| portail-mode      | Mode activation does not confirm                                                          |
| energie-solaire   | Keep today's look: solar greens unchanged                                                 |
| energie-index     | Server sends `colorIndex`; UI picks the themed colour                                     |
| energie-hc        | Keep dark blue / light blue for HP/HC, no hatching; fix dark-theme values only            |

## Functional Requirements

### FR-1 — Mobile and tablet layout

Logs rows wrap the message under time/level/module; a shared `PageHeader` wraps actions under the title below 640 px (Équipements, Appareils, Topologie); `SensorValues` gains `layout="wrap"` for the equipment list; integration rows lose their fixed 180 px column; energy bar charts compute tick intervals from width (every 6 h on phones); the Dashboard grid reserves room for the floating button; the mobile top bar drops the clock so the home name fits; the Maison aggregation strip wraps on two lines; page gutters are `p-4 sm:p-6`; the mobile chrome (bottom bar, contextual ☰, compact title) applies up to `lg`; a `hit-44` utility gives 44 px hit areas to setpoint chevrons, sliders and header pills.

### FR-2 — French copy and errors

All 30 `category.*` keys without a label get one, guarded by a test; English leaks are translated (Accueil, En direct, Marche/Arrêt, Appui simple, …); `ZoneDetailPage` reads the right translation key for mode badges; plurals use i18next plural keys; `<html lang>` follows the language; French typography (no-break space before `: ; ! ?`). An `ApiError` type and `apiErrorMessage()` map 429 to « Serveur occupé » with a retry and 404 to « introuvable »; the equipment page keeps the last good data when a background refresh fails and reads the equipment from the store instead of re-fetching on every data event; Analyse labels series whose equipment was deleted and lets the user drop them; gate texts follow the real state and an unknown state reads « État inconnu ».

### FR-3 — One number formatter

`ui/src/lib/format.ts` exposes `formatNumber`, `formatPower`, `formatEnergy`, `formatTemperature`, `formatPercent`, `formatDuration` and friends (signatures in architecture.md). French output: decimal comma, U+202F before units, U+2212 minus, rules from the decisions above. English output keeps the dot. An ESLint rule forbids `toFixed` in rendering code.

### FR-4 — Colour roles and contrast

Role tokens: amber (on/running) with a text variant `#8A6100`; orange `#E8730C` (attention) with text `#A85500`; red `#B42318` (fault); green `#13794A` (ok). `--color-warning` becomes orange. Open/closed states are neutral. Plugins, meters and motion lose amber. Off switches get a visible outline; `color-scheme` and `accent-color` follow the theme. The `eco`/`night` mode badges use tokens. A contrast test guards the role pairs.

### FR-4b — Dark theme primary and illustrations

Primary fill vs primary ink are separated; dark primary buttons use `#2B7299` with white text. The `brightness(1.6)` filter is removed; illustrations take token colours (logo blue strokes, night fills, amber when on). PWA splash colours follow the palette.

### FR-5 — Typography

Inter variable (`@fontsource-variable/inter`, family "Inter Variable"); a 7-step size scale (11–28 px) plus a 40 px value size as tokens; all arbitrary `text-[Npx]` mapped to tokens; `font-bold` → `font-semibold`; uppercase labels become sentence case by role; mono is kept only where FR decision pr5-mono says; an ESLint rule rejects arbitrary font sizes. Components with fixed geometry (the live flow diagram nodes) are sized so their labels and values fit.

### FR-6 — Top bar and titles

Clock shown only when time zones differ; the connection indicator only when degraded; sunrise/sunset as plain text (desktop) or in the root-zone strip (mobile); the updates pill is not error-red; H1 is 28 px desktop / 22 px mobile, weight 600, no icon, with an optional summary line; the Dashboard edit action is a button under the grid (sticky bar while editing) and the FAB is removed.

### FR-7 — Neutrals and shapes

Neutral scale lightly tinted with the brand blue (light) and an ocean-derived night (dark) in which cards are lighter than the page and tertiary text passes AA; cards lose their border (shadow in light, tone in dark); radii 6 / 10 / 16.

### FR-8 — One setpoint control, explicit tiles

A `SetpointStepper` (44 and 56 px) replaces the seven setpoint implementations and also serves EV current, charge limit and numeric extras. It sends one order after the last tap, with a delay chosen per integration (cloud ≈ 600 ms, local ≈ 150 ms), flushes a pending value when its sheet closes, and does not snap back while a cloud device has not reported yet. Mobile tiles show what a tap does with a corner glyph; tiles that do nothing on tap do not press; a disabled light cannot be toggled; the thermostat card shows its setpoint.

### FR-9 — Equipment page

Use first: value, setpoint, mode and a 24 h chart above the fold; configuration in the existing card at the bottom with collapsed rows. Back goes to the origin, or to the equipment's room; the breadcrumb shows Maison › room. The Dashboard links to the page (sheet footer on mobile, tile title on desktop).

### FR-P — Gate confirmation

When an admin enabled "require confirmation" on a gate, every UI path where one tap or click actuates it (dashboard tiles on every width, Maison row, equipment page, zone commands) confirms first: slide-to-confirm on touch, a two-button dialog on desktop. Texts follow the real state. Mode activation does not confirm. Amends spec 146; matches what `docs/user/dashboard.md` already promises.

### FR-E — Energy palette

Today's look is kept (solar greens, HP dark blue / HC light blue). Only dark-theme values are corrected where two series are indistinguishable (≥ 2:1 between neighbours, ≥ 3:1 against the surface), legends take token colours instead of hard-coded hex, sub-meter and Analyse series use themed palettes without state colours, and the server adds a `colorIndex` to by-usage series (additive; `color` kept).

## Acceptance Criteria

- [x] AC-1 No horizontal overflow and no overlapping text on Logs, Équipements, Appareils, Topologie, Intégrations, Dashboard, Maison and Énergie at 360, 390 and 430 px; tablet 768–1023 px reaches the zone tree, Énergie sub-pages and Analyse charts.
- [x] AC-2 No English string, raw i18n key or UUID in the French UI on the reviewed screens; 429 shows « Serveur occupé » with a retry; the equipment page never flips to « introuvable » on a failed background refresh.
- [x] AC-3 No `toFixed` in rendering code (lint); every displayed number goes through `lib/format`.
- [x] AC-4 Every text/background role pair passes WCAG AA (contrast test); amber is used only for on/running.
- [x] AC-5 No arbitrary font size in `ui/src` (lint); uppercase only in table headers; mono only in the allowed places.
- [x] AC-6 Top bar shows no clock (same zone) and no "Connecté" when connected; no FAB on the Dashboard.
- [x] AC-7 Dark theme: cards lighter than page, no `brightness` filter, primary buttons ≥ 4.5:1.
- [x] AC-8 One setpoint component across the UI; repeated taps send one order.
- [x] AC-9 Equipment page shows usage above the fold; back returns to the room.
- [x] AC-10 Gate confirmation on every path when enabled; texts follow the state.
- [ ] AC-11 Energy series pairs in dark theme ≥ 2:1; `colorIndex` present in by-usage responses.
- [x] AC-12 `npm run validate` green; screenshots of the reviewed screens retaken after each slice.

## Edge Cases

- Unknown unit from a plugin: formatted number, unit kept as given.
- `null` / `NaN` values: « — ».
- English UI: numbers keep the dot; plural keys exist in both locales.
- Browser and home in the same time zone: no clock anywhere; different zone: home time shown with its zone.
- Gate with several actions (open/close/stop): the confirmation names the action chosen; STOP never asks (maintainer decision, phase 3 review: delaying a stop defeats it).
- Setpoint sheet closed during the debounce: the pending value is sent.
- Device not reporting after a setpoint order: the stepper keeps the requested value until the next report or a timeout, then shows the reported one. A zone keeps it until its average reaches the value (± half a step) or the timeout: its first report is one thermostat of several.
- Weather forecasts show whole degrees (« 13° »): an exception to pr3-zero, a forecast carries no tenth.
- Tablet keeps desktop content layouts (`useIsMobile` < 640 px) while the chrome is mobile up to 1024 px (pr1-tablette): page titles shown in the compact top bar are hidden from the page below `lg`.

## Docs Delta

| Page (EN and FR)                                                       | Change                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `docs/user/dashboard.md` + `.fr.md`                                    | « Accueil » name (FR), edit button under the grid, tile corner glyphs, gate confirmation on every path, setpoint behaviour |
| `docs/user/energy.md` + `.fr.md`                                       | « En direct » (FR), legend and colour notes                                                                                |
| `docs/user/equipments.md` + `.fr.md` (or the equipment page section)   | Usage-first equipment page, back to the room                                                                               |
| `docs/user/*.fr.md` that say "Dashboard" or « vue Accueil » for Maison | Renamed consistently                                                                                                       |
| `docs/technical/contributing.md` + `.fr.md`                            | Frontend rules: `lib/format`, i18n plurals and categories, type scale, colour roles, no arbitrary sizes                    |
| `docs/technical/api-reference.md` + `.fr.md`                           | `colorIndex` on `/api/v1/energy/by-usage`                                                                                  |
| `design-system/*.md`                                                   | Tokens, roles, typography, dark theme (outside `docs/`)                                                                    |

Screenshots to retake: `docs/screenshots/*` showing the dashboard, Maison, energy and an equipment page, light and dark.
