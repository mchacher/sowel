# Plan — Spec 163

## Steps

1. [x] `PvForecastPanel`: remove embedded `SolarProfileForm` + backfill row;
       `null` when `!data.active`; admin link on the declared-kWc header
       figure; per-equipment SVG gradient id (two panels can now share a
       page); clock read moved from render to fetch time
       (react-hooks/purity).
2. [x] `SolarProfileForm`: card chrome, title and help hoisted to the
       settings section (its only remaining host).
3. [x] `SolarInstallationSettings`: new settings section (selector when
       several meters, form, backfill row with its busy/notice handling),
       stale-response guard so a late profile fetch cannot cross meters.
4. [x] `SettingsPage`: mount the section under the energy tab; initialise
       the active tab from `?tab=` via `initialSettingsTab`.
5. [x] `ProductionPage`: monitoring blocks per declared production meter,
       titled whenever several meters exist (FR1), admin hint when a meter
       exists but none is declared.
6. [x] `EquipmentDetailPage`: drop the two panels and their imports.
7. [x] i18n keys (en + fr): `settings.solar.noMeter`, `settings.solar.meter`,
       `energy.pv.setupHint`.
8. [x] Tests (below), then full validate (tsc backend+ui, vitest, eslint).
9. [x] Docs: `docs/specs-index.md` row. No `docs/user` page ever documented
       the equipment-page placement, so nothing to relocate there.

## Test plan

### Modules to test

- `PvForecastPanel` (changed behaviour: inactive, no form, admin link)
- `SolarInstallationSettings` (new)
- `ProductionPage` (new composition)
- `initialSettingsTab` (pure helper)

### Scenarios

| Module                    | Scenario                    | Expected                                                                        |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| PvForecastPanel           | `active: false`             | renders nothing, no form shown                                                  |
| PvForecastPanel           | `active: true`              | monitoring card renders with declared kWc                                       |
| PvForecastPanel           | admin viewer                | declared kWc is a link to `/settings?tab=energy`                                |
| PvForecastPanel           | non-admin viewer            | declared kWc is plain text                                                      |
| PvForecastPanel           | no backfill button          | the backfill control is gone from the panel                                     |
| SolarInstallationSettings | no production meter         | states it, no form                                                              |
| SolarInstallationSettings | one meter                   | form shown, no selector                                                         |
| SolarInstallationSettings | two meters                  | selector shown, defaults to the declared one, switching loads the other profile |
| SolarInstallationSettings | backfill click              | POST called, notice rendered                                                    |
| SolarInstallationSettings | undeclared meter            | form shown, backfill hidden                                                     |
| SolarInstallationSettings | fetch fails                 | retry offered, no empty form (a save from it would wipe the declaration)        |
| SolarInstallationSettings | stale response after switch | late cross-meter response dropped (proven to fail without the guard)            |
| ProductionPage            | one declared meter          | forecast + health blocks, no title                                              |
| ProductionPage            | two declared meters         | one titled block each                                                           |
| ProductionPage            | two meters, one declared    | one block, titled with its meter name; undeclared meter never fetched           |
| ProductionPage            | zero declared, admin        | hint with settings link                                                         |
| ProductionPage            | zero declared, viewer       | no hint                                                                         |
| ProductionPage            | no meter at all             | no hint either                                                                  |
| initialSettingsTab        | `?tab=energy`, admin        | energy tab active                                                               |
| initialSettingsTab        | `?tab=energy`, non-admin    | falls back to account tab                                                       |
| initialSettingsTab        | unknown/absent param        | role default                                                                    |

Existing suites that stayed green untouched: `PvHealthPanel.test.tsx`,
`useWebSocket.test.ts` (banner path), backend `energy.test.ts`.
