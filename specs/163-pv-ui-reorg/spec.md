# Spec 163 — PV monitoring and configuration find their place

## Problem

Specs 160/161/162 shipped three PV surfaces — expected production with its
accuracy record, the history backfill, and panel health — and parked all of
them on the detail page of the production meter equipment. That page now
stacks the forecast chart, the declaration form, the backfill button, the
health card, the energy cumuls and the live electrical measures. Two things
are wrong with it:

1. **Discovery.** A household asking "how is my solar doing" opens the Energy
   menu. Nothing there says a word about forecast or health; the answer hides
   behind Equipments, then the right meter, then a scroll. The Energy →
   Production page, meanwhile, is a single bar chart.
2. **Mixing observation with configuration.** The declaration
   (tilt/azimuth/peak power/since) is an admin act performed once per array
   change. It sits embedded under the forecast chart, on a page every viewer
   role can open, next to data that changes every hour. Settings → Energy
   already exists for exactly this kind of thing (tariffs, arbiter) and does
   not carry it.

## What this does

A pure relocation. No backend change, no migration, no new endpoint, no new
data. Three moves:

- **Energy → Production** becomes the PV monitoring home: the existing
  production bar chart, then for each production meter with a declared array,
  the forecast/accuracy panel and the health panel (read-only).
- **Settings → Energy** gains a "Photovoltaic installation" section: the
  declaration form and the fit-from-history button, per production meter.
- **The equipment detail page** keeps only what belongs to the meter as a
  device: energy cumuls, live electrical measures. The forecast and health
  panels leave it.

## Functional requirements

- **FR1** — Energy → Production shows, below the existing production chart,
  one monitoring block per `energy_production_meter` equipment: the forecast
  panel (curve, today/tomorrow figures, accuracy record and window selector)
  and the health panel. When several meters exist, each block is titled with
  the equipment name; with a single meter no title is added.
- **FR2** — The declared peak power stays visible on the monitoring view
  (it already is, in the forecast panel header). For an admin it links to
  Settings → Energy; a stale declaration must stay visible where it does the
  damage.
- **FR3** — A production meter with no declared array contributes no
  monitoring block. If no meter has a declared array, the Production page
  shows, for admins only, a one-line hint linking to Settings → Energy;
  other roles see the page exactly as today.
- **FR4** — Settings → Energy (admin tab) gains a "Photovoltaic
  installation" section holding the declaration form and the backfill
  ("adjust from history") button. With several production meters the section
  shows an equipment selector; with one, no selector. With none, the section
  says there is no production meter and does nothing else.
- **FR5** — The equipment detail page for `energy_production_meter` no
  longer renders the forecast panel or the health panel. Energy cumuls and
  electrical measures are untouched.
- **FR6** — No behavioural change to the panels themselves: same endpoints,
  same refresh, same alert banner path, same i18n keys where the copy is
  unchanged. The health alarm keeps raising and resolving exactly as spec 162
  shipped it.

## Acceptance criteria

- [x] Production page renders forecast + health panels for the declared meter
- [x] Multiple meters: one titled block each; single meter: no title
- [x] No declared array: admin sees the settings hint, viewer sees today's page
- [x] Settings → Energy carries the declaration form + backfill, admin only
- [x] Selector appears only when more than one production meter exists
- [x] Equipment detail page no longer shows forecast/health panels
- [x] Declared kWc visible on the monitoring view, linking to settings (admin)
- [x] All existing panel tests still pass; new placement covered by tests

## Out of scope

- Any backend change (routes, permissions, model, alarms)
- Redesign of the panels themselves (charts, copy, thresholds)
- The energy sidebar/mobile navigation structure (Production entry exists)
- Per-plane or per-meter comparison views

## Edge cases

| Case                                   | Behaviour                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| No production meter equipment at all   | Production page unchanged; settings section states it plainly                          |
| Meter exists, nothing declared         | No monitoring block; admin hint on Production, form empty in Settings                  |
| Two meters, one declared               | One monitoring block (the declared one), selector in Settings lists both               |
| Viewer (non-admin) opens Production    | Monitoring blocks render (GET routes are open to all roles); no settings link, no hint |
| Forecast endpoint fails transiently    | Panel keeps its existing retry/failed state; the page must not blank the chart above   |
| Meter deleted while its block is shown | Panel 404s and renders nothing on next load, as today on the detail page               |
