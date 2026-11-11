# Implementation Plan — Spec 202

One branch, `feat/tariff-versions`, one PR. Slices A to D are backend and land in order; slice E (UI) only needs
the types and routes of A and D, so it can be written in parallel once A is on the branch.

## Slices

### Slice A — Versions

- [ ] A.1 — `TariffVersion`, `TariffVersionInput` in `src/shared/types.ts`
- [ ] A.2 — `migrations/044_tariff_versions.sql` (table, unique index, two arbiter columns)
- [ ] A.3 — `src/energy/tariff-version-store.ts`: `all`, `create`, `update`, `remove`, `upsertCurrentPrices`,
      `seedFromSetting`, cache
- [ ] A.4 — `src/index.ts`: create the store, seed after the migrations
- [ ] A.5 — `tariff_versions` in `BACKUP_TABLES`

### Slice B — Pricing by version

- [ ] B.1 — `src/energy/pricing.ts`: `versionOn`, `pricesAt`, `crossesChange`, `pricePoints`, `priceTotals`
- [ ] B.2 — Golden test first: the current `computeTotals` and per-point `computeCost` copied into the test file
      as the reference, compared with the new functions on the fixtures, one version
- [ ] B.3 — `energy.ts`: `EnergyReadCtx.versions`, `loadEnergyPoints`, `computeTotals`, the daily read of a year
      crossed by a change (history and Bilan)
- [ ] B.4 — `/energy/by-usage`: per-point rate; remove `sumConsumptionHpHc` if it has no other caller, and
      `blendedRate`
- [ ] B.5 — `tariffConfigured` (status, Bilan) and the Bilan's `prices` from the store
- [ ] B.6 — `grep -n "getConfig()?.prices\|\.prices" src/api/routes/energy.ts src/energy` shows no reader of the
      setting's prices but the seed

### Slice C — Arbiter gain and EV sessions

- [ ] C.1 — `arbiter-gain-store.ts`, `arbiter-gain-meter.ts`: Wh in HP/HC, no price read
- [ ] C.2 — `bilan.ts` `arbiterTile(…, priceOf)`
- [ ] C.3 — `window-accountant.ts`, `ev-session-tracker.ts`, `summary.ts`: cost at read time

### Slice D — API

- [ ] D.1 — The four version routes with Fastify body schemas, admin check on the `GET`
- [ ] D.2 — Legacy `GET` (prices of today's version) and `PUT` (`prices` optional, `upsertCurrentPrices`)
- [ ] D.3 — `GET` / `PUT /settings/energy/contract`, `defaultContract`

### Slice E — UI

- [ ] E.1 — `ui/src/types.ts`, `ui/src/api/energy.ts`
- [ ] E.2 — `TariffContractBlock.tsx`, `TariffPriceHistory.tsx` and `lib/tariffVersions.ts`, wired into
      `TariffSettings.tsx`; the schedule save sends no prices
- [ ] E.3 — Strings EN and FR; `tariff.priceRetroactiveHint` removed
- [ ] E.4 — Check at 375 px, 768 px and desktop, light and dark

### Slice F — Docs

- [ ] F.1 — The docs delta of `spec.md`, EN and FR together
- [ ] F.2 — Screenshot `energy-tariff-settings` EN and FR
- [ ] F.3 — Specs index rows (done with the spec)

## Test Plan

### Modules to test

`tariff-version-store`, `pricing`, `bilan` (`arbiterTile`), `arbiter-gain-meter`, `arbiter-gain-store`,
`ev-sessions/summary`, `ev-sessions/window-accountant`, `api/routes/energy` (version routes, legacy pair,
by usage), `backup-manager` (table list).

Fixtures are synthetic and live in the test files: no installation data in this repository.

### Scenarios

| Module                | Scenario                                                                          | Expected                                                                          |
| --------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| tariff-version-store  | Seed: table empty, `energy.tariff` with prices                                    | One version, `startDate` null, `origin` "migration"                               |
| tariff-version-store  | Seed: table empty, prices 0/0 or no setting                                       | No version                                                                        |
| tariff-version-store  | Seed: table not empty                                                             | Nothing created                                                                   |
| tariff-version-store  | Create the first version with a `startDate`                                       | Stored with `startDate` null                                                      |
| tariff-version-store  | Create a second version on a used date                                            | `DuplicateStartDate`                                                              |
| tariff-version-store  | Remove the version without a date                                                 | `UndatedVersionLocked`                                                            |
| tariff-version-store  | Update a dated version's date to a free date, then to a used one                  | Accepted, then `DuplicateStartDate`                                               |
| tariff-version-store  | `upsertCurrentPrices` with a version in force, then with none                     | Edits it in place; creates the first                                              |
| tariff-version-store  | Write after a read                                                                | `all()` returns the new state (cache invalidated)                                 |
| pricing               | `versionOn`: before every dated version, on a start date, the day before          | Dateless version; the new version; the previous one                               |
| pricing               | `versionOn`: a version dated in the future                                        | Not in force today                                                                |
| pricing               | **Golden, one version**: hourly, daily and monthly fixtures with self-consumption | Points and totals equal the reference formula, to 4 decimals                      |
| pricing               | Two versions, change on the 1st of a month, daily points                          | Each point at its version; totals = sum of the two groups                         |
| pricing               | Two versions, change mid-month, monthly points with daily points                  | The month = days before at old price + days after at new price                    |
| pricing               | Monthly points, change on the 1st                                                 | `crossesChange` false inside months; no daily points needed                       |
| pricing               | No version                                                                        | Every cost 0                                                                      |
| pricing               | DST day (23 h and 25 h), point at local midnight                                  | Local date of the point decides                                                   |
| energy routes         | By usage: a meter consuming only in off-peak points                               | Cost = its Wh at the off-peak price                                               |
| energy routes         | By usage: no main meter                                                           | Every cost 0, as today                                                            |
| energy routes         | `GET` versions as a standard user                                                 | `403`                                                                             |
| energy routes         | `POST` with a bad date, a negative price, a price above 5                         | `400`                                                                             |
| energy routes         | `POST` duplicate date; `DELETE` the dateless version                              | `409`                                                                             |
| energy routes         | Legacy `PUT` with `prices`; without `prices`                                      | Today's version edited; versions untouched, schedule saved                        |
| energy routes         | Legacy `GET`                                                                      | `prices` of the version in force today                                            |
| energy routes         | Contract `GET` without a setting: schedule with an off-peak slot; without one     | `other`, `hphc`, power of the latest version; `base`                              |
| energy routes         | Contract `PUT` valid; unknown supplier; `kva` 0                                   | Saved and read back; `400`; `400`                                                 |
| ui lib tariffVersions | Three versions, the last started; the last in the future; one dateless alone      | End dates the day before the next start; `current` / `upcoming` on the right row  |
| arbiter-gain-meter    | One minute fully in peak, one straddling a slot boundary                          | `solarHpWh` / `solarHcWh` in the classifier's proportions, `avoidedEur` 0         |
| arbiter-gain-store    | Upsert on an existing row                                                         | The two Wh columns add up; `avoided_eur` untouched                                |
| bilan                 | `arbiterTile`: a pre-202 row, a post-202 row, a row with both                     | Booked euros; Wh × version of the day; the sum of both                            |
| bilan                 | `arbiterTile`: rows on each side of a price change                                | Each day at its version                                                           |
| ev summary            | Session with grid Wh, version in force at its start                               | Cost = Wh × that version; equal to the old stored cost when prices did not change |
| ev summary            | Session starting before a change and ending after                                 | Priced entirely with the version of its start                                     |
| ev summary            | No version, or prices 0/0                                                         | Costs null                                                                        |
| backup-manager        | `BACKUP_TABLES`                                                                   | Contains `tariff_versions`                                                        |

Core test seen failing on purpose: in `priceTotals`, price every group with the last version; the two-version
tests must fail.

## Validation Plan

- `npm run validate`
- `bash scripts/check-specs-complete.sh`, `check-specs-index.sh folders`, `check-docs-parity.sh`,
  `check-docs-impact.sh`
- `sowel-reviewer` on the branch, with a close look at: the one-version identity, the year view crossed by a
  change, the arbiter row of the upgrade day
- Manual, on a copy of a real database (kept outside this repository):
  1. note the Bilan of a month and a year, and the Consumption totals, before the upgrade;
  2. upgrade: the same figures, one version in the settings;
  3. add a version dated in the past: only the points from that date change;
  4. EV sessions page and arbiter tile still read a cost.
