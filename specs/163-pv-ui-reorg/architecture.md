# Architecture — Spec 163

## Shape

UI-only. No migration, no route, no type change in `src/shared/types.ts`. The
backend already draws the right permission line: forecast and health reads are
open to every authenticated role, the backfill POST and the solar-profile PUT
are admin — which is exactly the monitoring/configuration split the pages are
being moved onto.

```
before                                   after

EquipmentDetailPage                      EquipmentDetailPage
  PvForecastPanel                          (energy cumuls, electrical measures)
    SolarProfileForm   (embedded)
    [backfill button]                    Energy -> Production
  PvHealthPanel                            ProductionBarChart   (unchanged)
  EnergyDataPanel                          per declared meter:
  ElectricalPanel                            PvForecastPanel    (monitoring only)
                                             PvHealthPanel
Energy -> Production
  ProductionBarChart                     Settings -> Energy (admin tab)
                                           TariffSettings      (unchanged)
Settings -> Energy                         ArbiterSettings     (unchanged)
  TariffSettings                           SolarInstallationSettings
  ArbiterSettings                            [meter selector when > 1]
                                             SolarProfileForm
                                             [backfill button]
```

## Component changes

### `PvForecastPanel` becomes monitoring-only

Today the panel ends with the backfill button row and an embedded
`SolarProfileForm`, and renders the bare form when nothing is declared. Both
leave:

- the embedded `SolarProfileForm` and the backfill row are removed;
- `!data.active` returns `null` — the page decides what an undeclared meter
  shows, because the answer differs by page (hint on Production, nothing
  anywhere else);
- the `declared N Wc` figure in the header stays, and for admins becomes a
  `Link` to `/settings?tab=energy` (FR2). Non-admins keep the plain text.

Everything else — retry/failed state, no-weather vs learning distinction,
merged timeline chart, accuracy window selector — is untouched.

### `ProductionPage` hosts the blocks

After the existing chart card, the page reads the equipments store
(`useEquipments`), filters `type === "energy_production_meter"`, and renders
per meter a `PvMonitoringBlock`: equipment-name heading (only when more than
one meter exists), then `PvForecastPanel` + `PvHealthPanel`.

Whether a meter is "declared" comes straight from the store: `Equipment`
already carries `solarProfile`, and spec 160 already mirrored the backend's
`isActiveSolarProfile` into
`ui/src/components/equipments/solarProfileValidation.ts` — the exact same
rule, kept in lockstep since the form validates with it before every save. So
the page filters `isActiveSolarProfile(eq.solarProfile)` and renders blocks
only for declared meters; the admin hint (FR3) renders when meters exist and
none passes. No callback plumbing, no extra request, and the panels' own
`active: false` answer remains the backstop if the two ever disagree for a
render cycle.

### `SolarInstallationSettings` (new, `ui/src/components/settings/`)

Sits under `ArbiterSettings` in the energy tab. Reads the equipments store,
filters production meters:

- none: one sentence saying a production meter equipment is needed first;
- one: `SolarProfileForm` for it, plus the backfill button row (moved here
  verbatim from `PvForecastPanel`, same endpoint, same busy/notice handling);
- several: a plain `<select>` of meter names above the form, defaulting to
  the first declared one.

The form itself (`SolarProfileForm`) keeps all its logic (draft planes,
validation, save, withdraw) but loses its card chrome: after this spec the
settings section is its only caller, and the section provides the card, the
Sun-icon title and the help line — the form rendering its own would put the
same title on the page twice. The section fetches
`getPvForecast(equipmentId)` to obtain current `planes`/`since` — same call
the detail page made, still one call, now made from settings. The form is
keyed on the equipment id so switching meters remounts it with the right
draft, and it is never rendered from a failed fetch (the empty-form
save-wipes-declaration guard the forecast panel already had).

### `EquipmentDetailPage`

The two conditional renders for `energy_production_meter` (forecast panel,
health panel) are deleted, imports pruned. Nothing else on the page moves.

### `SettingsPage` deep link

`activeTab` is currently pure `useState`. FR2's link needs
`/settings?tab=energy` to land on the tab: initialise the state from
`useSearchParams` when the value names a tab the current role may see, else
fall back to today's default. No URL writing on tab click — the param is an
entry point, not synced state.

## What deliberately does not move

- **The alert banner path** (spec 162): raised via WebSocket + snapshot
  endpoint, composed client-side. It never depended on any page.
- **Energy cumuls / electrical measures** on the equipment page: they
  describe the meter as a device, which is what that page is for.
- **`hasProduction` sidebar gating**: the Production entry already appears
  exactly when production data exists; an undeclared array changes nothing.

## Files

| File                                                       | Change                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ui/src/components/equipments/PvForecastPanel.tsx`         | monitoring-only: drop form + backfill, `null` when inactive, header kWc links to settings (admin) |
| `ui/src/components/equipments/SolarProfileForm.tsx`        | card chrome, title and help hoisted to the settings section                                       |
| `ui/src/components/energy/ProductionPage.tsx`              | render monitoring blocks per declared production meter + admin hint                               |
| `ui/src/components/settings/SolarInstallationSettings.tsx` | new: card + selector + `SolarProfileForm` + backfill row                                          |
| `ui/src/pages/SettingsPage.tsx`                            | mount the section in the energy tab; init tab from `?tab=`                                        |
| `ui/src/pages/EquipmentDetailPage.tsx`                     | remove the two PV panels                                                                          |
| `ui/src/i18n/locales/{en,fr}.json`                         | keys for the settings section, the admin hint, the no-meter sentence                              |
| tests                                                      | see plan                                                                                          |
