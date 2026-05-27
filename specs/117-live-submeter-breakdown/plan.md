# Spec 117 — Implementation plan

## Tasks

1. [x] Create `ui/src/components/energy/submeterPalette.ts` with the
       8-color `SUBMETER_PALETTE` and `pickSubmeterColor(index)`
       helper. Cross-reference comment to `src/api/routes/energy.ts:714`.
2. [x] Add a one-line cross-reference comment in
       `src/api/routes/energy.ts` above the existing
       `SUBMETER_PALETTE` constant pointing to the new UI helper.
3. [x] Create the pure helpers in
       `ui/src/components/energy/LiveSubmeterBreakdown.tsx` (or a
       sibling `submeter-helpers.ts` if cleaner):
   - `readSubmeterPower(eq)`
   - `buildSubmeterRows(equipments)` — filter, palette-assign by
     sorted-id index, then sort for display by power desc.
   - `computeOther(house, submeters)`
4. [x] Write the React component `LiveSubmeterBreakdown`:
   - Title `Décomposition consommation` (i18n key).
   - SVG donut with stroke-dasharray segments + center label.
   - Legend list (one row per submeter + optional "Autre" row).
   - "Maison à l'arrêt" branch when `house < 5 W`.
   - "Σ ≥ total maison" footnote branch when overshoot > 5%.
   - Mobile breakpoint at 520 px (donut on top, legend below).
   - CSS transitions on segment dasharray/offset.
5. [x] Wire `<LiveSubmeterBreakdown />` into
       `ui/src/components/energy/LiveEnergyPage.tsx`. Compute
       `houseW` and `hasMainMeter` and pass them down. Component
       returns `null` when no `energy_meter` exists, so no extra
       guard at the parent.
6. [x] Add i18n keys to `ui/src/i18n/locales/en.json` and
       `ui/src/i18n/locales/fr.json`:
   - `energy.live.breakdown.title`
   - `energy.live.breakdown.other`
   - `energy.live.breakdown.offline`
   - `energy.live.breakdown.offlineSince`
   - `energy.live.breakdown.noData`
   - `energy.live.breakdown.houseIdle`
   - `energy.live.breakdown.overshoot`
7. [x] Write unit tests in
       `ui/src/components/energy/LiveSubmeterBreakdown.test.ts`
       (Vitest). See Test Plan below.
8. [x] Run validations: `cd ui && npx tsc -b --noEmit`,
       `cd ui && npx eslint .`, `npx vitest run`.
9. [ ] Manually verify on the running app: a known production
       instance has at least 2 `energy_meter` equipments (PAC clamp,
       pool clamp). Open the Live page in a browser and confirm:
       segments size/colors match the By-usage chart for the same
       equipments, values match the dashboard widget values, donut
       updates live (~1 Hz).
10. [ ] Update `docs/specs-index.md` to add spec 117 under a "V1.14
        / V1.15 — live submeter breakdown" section. Update
        `docs/user/energy.md` (if it documents the Live page) with
        a sentence describing the new section.

## Test Plan

### Modules to test

- `submeterPalette.ts` — `pickSubmeterColor` (single function)
- `LiveSubmeterBreakdown.tsx` pure helpers — `readSubmeterPower`,
  `buildSubmeterRows`, `computeOther`

No React component tests are written (project convention: no React
tests in this repo). The rendering logic is validated through manual
verification (task 9).

### Scenarios per module

| Module              | Scenario                                      | Expected                                                               |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| `pickSubmeterColor` | index 0..7                                    | Returns palette[index]                                                 |
| `pickSubmeterColor` | index 8                                       | Returns palette[0] (wraps modulo 8)                                    |
| `pickSubmeterColor` | index 17                                      | Returns palette[1]                                                     |
| `readSubmeterPower` | online equipment with `power=1200`            | Returns 1200                                                           |
| `readSubmeterPower` | online equipment with `power=-50` (backwards) | Returns 50 (abs value)                                                 |
| `readSubmeterPower` | online equipment without `power` binding      | Returns null                                                           |
| `readSubmeterPower` | offline equipment (status="offline")          | Returns null even if `power` binding exists                            |
| `readSubmeterPower` | degraded equipment with `power=800`           | Returns 800 (degraded still counts)                                    |
| `buildSubmeterRows` | 3 submeters with mixed power values           | Returns 3 rows, color stable per id, sorted by power desc              |
| `buildSubmeterRows` | offline submeter mixed with online ones       | Offline row exists, sorted last, `power=null`                          |
| `buildSubmeterRows` | 9 submeters                                   | 9 rows, 9th gets palette[0] again (wrap), color stable across reorders |
| `buildSubmeterRows` | empty input                                   | Returns []                                                             |
| `buildSubmeterRows` | non-energy_meter equipments mixed in          | Filtered out, not in result                                            |
| `computeOther`      | house=3200, submeters sum to 2570             | Returns 630                                                            |
| `computeOther`      | house=3200, submeters sum to 3500 (overshoot) | Returns 0 (clamped)                                                    |
| `computeOther`      | house=0, no submeters                         | Returns 0                                                              |
| `computeOther`      | house=1000, submeter sum 1000                 | Returns 0 (no "Autre" segment)                                         |

### Manual verification checklist (task 9)

- [ ] Open Live page on a real instance with ≥ 2 `energy_meter`.
- [ ] Donut total matches the Maison node value.
- [ ] Each submeter color matches the same equipment's color in the
      historical By-usage chart (open `/energy?view=by-usage` for a
      side-by-side check).
- [ ] Values update ~1 Hz as `power` changes (watch the Shelly
      production stream).
- [ ] Power off a sub-circuit (e.g. PAC): its segment shrinks to 0,
      "Autre" grows accordingly.
- [ ] Pull network on one zigbee clamp (force offline): equipment
      drops out of the donut, appears greyed in the legend with the
      "hors-ligne · Xmin" hint.
- [ ] Resize the window to < 520 px: donut centers on top, legend
      goes full-width below.
- [ ] When all sub-circuits are at rest and house < 5 W: section
      shows "Maison à l'arrêt" instead of a 0-W donut.
- [ ] When only an `energy_production_meter` (solar) is configured
      and no `main_energy_meter`: donut still renders, no "Autre",
      center value = Σ submeters.
- [ ] When no `energy_meter` exists at all: section is entirely
      absent from the page.
