# Spec 117 — Live submeter breakdown (donut)

## Summary

Enrich the Live energy page with a real-time breakdown of house
consumption per submeter (`energy_meter` equipment). A donut chart
displayed below the Maison/Réseau/Solaire diagram shows one segment per
submeter and an "Autre" residual segment, sized by instantaneous `power`
(W). The view is fully frontend and reactive: it re-renders from the
same `equipment.data.changed` WebSocket stream that already feeds the
diagram, no new endpoint or computed alias.

## Why

Since spec 091, users can attach `energy_meter` clamps on dedicated
circuits (PAC, pool, EV, etc.) to break down their household
consumption. The breakdown is currently only visible in the
**historical** view (`Energy → By usage`). When the user opens the
**Live** page to understand what is consuming **right now** ("why is my
import 1.5 kW at 23:00?"), they see only the aggregated 3.2 kW figure
on the Maison node, with no clue which appliance is responsible. Spec
091 explicitly excluded the live breakdown ("No live (real-time)
breakdown view. The existing 'Live' page is untouched.") — this spec
closes that gap.

## Scope

### In

- New `LiveSubmeterBreakdown` component rendered below the existing
  Maison/Réseau/Solaire diagram on the Live page.
- Donut SVG (D3-style stroke-dasharray on a circle) with one segment
  per `energy_meter` equipment + an "Autre" residual segment.
  - Donut total in the center: house consumption in W/kW (matches
    the Maison node value).
  - Legend on the right (desktop) / below (mobile): one row per
    submeter and per "Autre", with colored dot + name + W + %.
- Submeter sizing: read each `energy_meter` equipment's `power`
  binding (alias `power`) from the existing `useEquipments` store.
  If multiple devices are bound (multi-channel), the existing
  binding/aggregation logic already produces a single equipment-level
  value — we read it as-is.
- "Autre" segment = `house - Σ submeters`, clamped to ≥ 0. House is
  computed from `gridPower + solarPower` exactly like the diagram
  above (no separate source of truth).
- Color palette: reuse the existing 8-color `SUBMETER_PALETTE` defined
  for spec 091 backend so the same equipment gets the same color in
  both the historical By-usage chart and the Live donut. Assignment is
  deterministic: submeters sorted by `id` ascending, palette indexed
  modulo 8.
- Submeter sort order in the donut (clockwise from top) and the
  legend: by current `power` descending. Equipments with no live
  power (null/offline) sort last.
- Per-submeter offline/stale handling (spec 116 grammar):
  - `status === "offline"`: equipment is **excluded from the donut**
    (size 0) but listed in the legend, greyed, with a small
    "hors-ligne" badge and the "donnée perdue depuis Xmin" reason.
  - `status === "degraded"`: same as online but the legend row shows
    a small dot indicator (no badge — the value is still recent).
  - `power` binding missing entirely: equipment is excluded from the
    donut, listed in the legend with "—" as value and a muted "pas
    de mesure" hint.
- Empty state: if there is **no** `energy_meter` equipment at all,
  the entire section is hidden (no empty card, no placeholder).
- Case without `main_energy_meter`: the donut still renders with just
  the submeter segments (no "Autre" segment). The center total is
  `Σ submeters` instead of `gridPower + solarPower`. The legend
  hides the "Autre" row.
- Case where `Σ submeters > house` (measurement noise, clamp
  saturation): "Autre" is clamped to 0 and a small footnote appears
  below the donut ("Σ sous-compteurs ≥ total maison — Autre = 0"),
  styled as a muted warning. Only displayed if the difference
  exceeds 5% of the house value to avoid noise from rounding.
- i18n: French and English keys, namespaced under `energy.live.breakdown.*`.
- Reactive update: re-renders on every `equipment.data.changed`
  event via the existing `useWsSubscription(["equipments"])` already
  in place on the Live page.
- Mobile responsive: donut + legend stack vertically on screens
  below 520 px.

### Out

- No new REST endpoint and no new WebSocket message. The view is
  derived 100% client-side from the equipments store.
- No new computed alias on `energy_meter` (no integration of `power`
  for the Live view — the equipment's existing `power` binding is
  read as-is).
- No interaction (clicking a segment, hovering for sparkline, etc.).
  Read-only display.
- No persistence of any "preferred order" or "preferred color" per
  submeter — the deterministic palette mapping is good enough.
- No support for grouping submeters into "categories" (e.g. all PAC
  equipments grouped). Each `energy_meter` is its own segment.
- No staleness logic specific to the Live breakdown: we lean on the
  same `EquipmentStatus` machinery from spec 116 used by the parent
  Live page. No new threshold, no new event.
- No alert/notification when "Autre" exceeds an absolute or
  proportional threshold. Display only.
- No change to the existing Maison/Réseau/Solaire diagram, the
  EnergyByUsageChart (spec 091), or the `/api/v1/energy/by-usage`
  endpoint.

## Acceptance criteria

- [x] The Live page renders a "Décomposition consommation" section
      below the diagram when at least one `energy_meter` equipment
      exists.
- [x] The section is fully hidden when no `energy_meter` exists.
- [x] Donut total (center) equals `house = gridPower + solarPower`
      (or `Σ submeters` if no `main_energy_meter`), formatted with
      the same rules as the diagram's house value (W under 1000, kW
      with one decimal otherwise).
- [x] One donut segment per `energy_meter` with `status !==
    "offline"` AND a numeric `power` value, sized proportional to
      that `power`, colored from `SUBMETER_PALETTE` by sorted-id
      index.
- [x] "Autre" segment present when `main_energy_meter` exists and
      `house - Σ submeters > 0`. Hidden otherwise.
- [x] Submeter sort order (clockwise from top, top of legend): by
      `power` descending; offline/no-data submeters last.
- [x] Each `energy_meter` color matches what `EnergyByUsageChart`
      uses for the same equipment id (visual continuity between
      Live donut and historical By-usage chart).
- [x] Offline submeter: excluded from donut, listed greyed in
      legend with "hors-ligne · Xmin" hint.
- [x] Submeter with no `power` binding: excluded from donut, listed
      in legend with "—" value and muted "pas de mesure" hint.
- [x] On WebSocket `equipment.data.changed` event, the donut and
      legend values update without a full page reload.
- [x] On mobile (< 520 px), donut and legend stack vertically.
- [x] Existing diagram, status pill, percentages on flow curves,
      and stale/offline banner behavior are unchanged.

## Edge cases

- **Solar exporting (grid < 0)**: house = grid + solar is still ≥ 0.
  Donut shows the breakdown of what the house consumes regardless of
  grid direction. If grid is strongly negative and solar low,
  `house ≈ 0` — in that case the donut renders all-grey ("Autre" if
  ≥ 5 W, otherwise the entire section shows "Maison à l'arrêt").
- **House < 5 W (everything off)**: render an "Maison à l'arrêt"
  message in place of the donut center. Skip segments entirely.
  Avoids a flashy 0-W donut and rounding artefacts.
- **Single submeter covering 100%**: full ring in that submeter's
  color, no "Autre".
- **Recently created submeter, no data yet**: appears in legend with
  "—" until the first `power` sample arrives.
- **`power < 0` on a submeter (clamp wired backwards)**: take the
  absolute value (consistent with spec 091 backend integration). Log
  once at debug.
- **More than 8 submeters**: palette wraps modulo 8. Two submeters
  may share a color but the legend disambiguates by name. Acceptable
  for the foreseeable future (user currently has 2-3).
- **Submeter equipment renamed mid-session**: name updates live via
  the `equipment.updated` event already consumed by the store. No
  special handling.
- **Submeter equipment deleted mid-session**: it disappears from
  both donut and legend immediately on the next render cycle.
