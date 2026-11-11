# Implementation Plan — Spec 206

Branch `feat/settings-solar-tab`, one pull request.

## Tasks

- [ ] 1 — Mockup of the two tabs and the phone tab bar
- [ ] 2 — `settings-tab.ts`: `"solar"`
- [ ] 3 — `SettingsPage.tsx`: the tab, the cards moved, the scrolling bar
- [ ] 4 — Links of Production and PV forecast
- [ ] 5 — Strings EN and FR, docs delta
- [ ] 6 — Checked at 1280 px and 390 px, light and dark

## Test Plan

### Modules to test

`ui/src/lib/settings-tab`, `ProductionPage` and `PvForecastPanel` (link targets).

### Scenarios

| Module           | Scenario                                 | Expected       |
| ---------------- | ---------------------------------------- | -------------- |
| settings-tab     | `"solar"`, admin                         | `"solar"`      |
| settings-tab     | `"solar"`, standard user                 | `"account"`    |
| settings-tab     | `"energy"`, admin (unchanged)            | `"energy"`     |
| ProductionPage   | setup hint link                          | `?tab=solar`   |
| PvForecastPanel  | declared link (admin)                    | `?tab=solar`   |

The settings-tab scenario is seen failing once without `"solar"` in the accepted list.
