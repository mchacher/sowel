# Implementation Plan — Spec 206

Branch `feat/settings-solar-tab`, one pull request.

## Tasks

- [x] 1 — Mockup of the two tabs and the phone tab bar
- [x] 2 — `settings-tab.ts`: `"solar"`
- [x] 3 — `SettingsPage.tsx`: the tab, the cards moved, the scrolling bar
- [x] 4 — Links of Production and PV forecast
- [x] 5 — Strings EN and FR, docs delta
- [x] 6 — Checked at 1280 px and 390 px, light and dark

## Test Plan

### Modules to test

`ui/src/lib/settings-tab`, `ProductionPage` and `PvForecastPanel` (link targets).

### Scenarios

| Module          | Scenario                      | Expected     |
| --------------- | ----------------------------- | ------------ |
| settings-tab    | `"solar"`, admin              | `"solar"`    |
| settings-tab    | `"solar"`, standard user      | `"account"`  |
| settings-tab    | `"energy"`, admin (unchanged) | `"energy"`   |
| ProductionPage  | setup hint link               | `?tab=solar` |
| PvForecastPanel | declared link (admin)         | `?tab=solar` |

The settings-tab scenario is seen failing once without `"solar"` in the accepted list.
