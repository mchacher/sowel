# Architecture — Spec 202

## Flow diagram

```
Write time (unchanged)                         Read time (changed)

meter ─► HistoryWriter / SelfConsumptionWriter  GET /energy/history, /by-usage, /bilan
          TariffClassifier.classify()             │
          └─► Influx energy_hp / energy_hc        ├─ loadEnergyPoints()      Wh per point
                                                  ├─ TariffVersionStore.all()
arbiter ─► ArbiterGainMeter (every minute)        └─ pricing.ts              € per point, per version
          └─► arbiter_daily_gain                      priceAt(localDate(point))
              solar_hp_wh, solar_hc_wh  ────────► arbiterTile(): Wh × version of the row's day

charger ─► EvSessionTracker                      GET /ev-sessions…
          └─► est_grid_hp_wh, est_grid_hc_wh ───► summary.ts: Wh × version of the session's start

Settings › Énergie ─► /settings/energy/tariff/versions ─► tariff_versions
startup ─► TariffVersionStore.seedFromSetting() (table empty and energy.tariff priced)
```

No event bus event, no WebSocket message: the settings card reloads its list after each save, as it does today.

## Data model

### Migration `044_tariff_versions.sql`

```sql
CREATE TABLE tariff_versions (
  id             TEXT PRIMARY KEY,           -- UUID v4
  start_date     TEXT,                       -- local YYYY-MM-DD; NULL = first version, open backwards
  price_hp       REAL NOT NULL,              -- €/kWh incl. tax
  price_hc       REAL NOT NULL,
  fixed_fee_year REAL,                       -- €/year incl. tax
  kva            REAL,
  origin         TEXT NOT NULL,              -- 'migration' | 'manual' | later 'file:<supplier>', 'provider:<id>'
  created_at     TEXT NOT NULL,              -- ISO 8601
  updated_at     TEXT NOT NULL
);
-- One version per start date, and one version without a date (UNIQUE alone lets several NULLs in).
CREATE UNIQUE INDEX idx_tariff_versions_start ON tariff_versions (COALESCE(start_date, ''));

ALTER TABLE arbiter_daily_gain ADD COLUMN solar_hp_wh REAL NOT NULL DEFAULT 0;
ALTER TABLE arbiter_daily_gain ADD COLUMN solar_hc_wh REAL NOT NULL DEFAULT 0;
```

- `arbiter_daily_gain.solar_wh` stays the total. From this spec the meter adds to `solar_hp_wh` / `solar_hc_wh`
  and adds 0 to `avoided_eur`, which then only holds what was booked before. Read rule:
  `avoided = avoided_eur + cost(solar_hp_wh, solar_hc_wh, version of day)`.
- `ev_charge_sessions.est_cost_hp_eur` / `est_cost_hc_eur`: no longer written (NULL on new sessions) and no
  longer read. The columns stay.
- `energy.tariff`: unchanged shape. Its `prices` are read once, by the seed.
- `energy.contract` (new setting): JSON `TariffContract`. Absent until first saved; the route derives the default
  (spec FR4).

### Types (`src/shared/types.ts`, mirrored in `ui/src/types.ts`)

```ts
export interface TariffVersion {
  id: string;
  /** Local date YYYY-MM-DD. Null for the first version, open backwards. */
  startDate: string | null;
  prices: TariffPrices; // €/kWh incl. tax; a Base contract uses hp only
  fixedFeeYear: number | null; // €/year incl. tax
  kva: number | null;
  origin: string; // "migration" | "manual" | "<writer>:<id>"
  createdAt: string;
  updatedAt: string;
}

export interface TariffVersionInput {
  startDate?: string | null;
  prices: TariffPrices;
  fixedFeeYear?: number | null;
  kva?: number | null;
}

export interface TariffContract {
  supplier: "edf-tarif-bleu" | "other";
  contractType: "hphc" | "base";
  kva: number | null;
}
```

`TariffConfig`, `TariffPrices`, `EnergyPoint`, `EnergyTotals`, `EnergyByUsageResponse` and `EnergyBilanResponse`
keep their shape. `BilanArbiter` keeps its shape.

## Components

### New: `src/energy/tariff-version-store.ts`

SQLite persistence and the rules of FR1, following `ArbiterGainStore` for style.

- `all(): TariffVersion[]`, oldest first (the dateless version first). Cached in memory, invalidated on every
  write: the read routes call it on each request.
- `create(input, origin)`, `update(id, input)`, `remove(id)`. They throw typed errors (`DuplicateStartDate`,
  `UndatedVersionLocked`, `NotFound`) that the routes map to `409` / `404`.
- `seedFromSetting(tariff: TariffConfig | null): boolean`, FR2. Called once from `src/index.ts`, after the
  migrations and before the routes are registered.
- `upsertCurrentPrices(prices)`, for the legacy `PUT`: edits the version in force today, or creates the first.

### New: `src/energy/pricing.ts`

Pure module, no I/O. It takes the versions as an argument.

- `versionOn(versions, localDate): TariffVersion | null`: last version with `startDate <= localDate`, the
  dateless one otherwise.
- `pricesAt(versions, instant: Date): TariffPrices`: `versionOn(...)`'s prices, `{ hp: 0, hc: 0 }` without one.
- `crossesChange(versions, from, to): boolean`: a dated version starts strictly inside `(from, to)` in local
  dates.
- `pricePoints(points, versions, daily?)`: fills `cost_hp`, `cost_hc`, `cost_total` of each point with
  `computeCost(hp, hc, pricesAt(point.time))`. For a `1mo` point crossed by a change, sums `computeCost` of the
  month's `daily` points grouped by version.
- `priceTotals(pricingPoints, versions): { cost_hp, cost_hc, cost_total }`: grid-side Wh (the autoconso
  subtraction moved from `computeTotals`, unchanged) grouped by version, `computeCost` per group, then
  `cost_hp = round4(Σ)`, `cost_hc = round4(Σ)`, `cost_total = round4(cost_hp + cost_hc)`. `pricingPoints` are
  the response's points; for a `1mo` range with a change inside a month, `monthlyPricingPoints` swaps the crossed
  month for its days and keeps the other months, whose share of the total therefore does not move.

`cost-calculator.ts` keeps `computeCost`; `blendedRate` is removed with its last caller.

### Changed: `src/api/routes/energy.ts`

- `EnergyReadCtx.prices` becomes `versions`. `loadEnergyPoints` returns Wh and calls `pricePoints`.
- `computeTotals` keeps the Wh totals and takes its three cost fields from `priceTotals`.
- `/energy/history`, year period: when `crossesChange(from, to)`, one more `loadEnergyPoints` at `1d` on the
  same bucket, passed to `pricePoints` and `priceTotals`. `/energy/bilan` already loads `currentDaily` and
  `previousDaily` in the year view and passes them the same way (the previous year is priced with its own
  versions).
- `/energy/by-usage`: `sumConsumptionHpHc` and the blended rate are replaced by the main meter's points
  (`loadEnergyPoints` without production) and a per-point rate `cost_total × 1000 / (hp + hc)`. Each series,
  `other` and the total are `Σ wh × rate`, rounded once at the end. The same helper as `usageRows` in `bilan.ts`.
- `tariffConfigured` (status and Bilan) and the Bilan's `prices` from the store.
- The four version routes, next to the legacy pair. The `GET` carries its own admin check, as the legacy `GET`
  does (issue #381); mutating methods are covered by the role gate of spec 131.
- `GET` / `PUT /api/v1/settings/energy/contract`, same admin rule, body schema with the two enums and
  `kva` above 0 or null. The default of an absent setting is computed in a pure helper `defaultContract(tariff,
versions)` in `pricing.ts`.
- Legacy `PUT`: body schema `required: ["schedules"]`; writes the setting with the `prices` it already holds
  when none are sent; calls `upsertCurrentPrices` when they are.

### Changed: `src/energy/bilan.ts`

- `arbiterTile` takes `priceOf(day): TariffPrices` and applies the read rule above. `ArbiterGainRow` gains
  `solarHpWh`, `solarHcWh`.
- Nothing else: `splitPoint`, `billOf`, `usageRows` and the comparisons read the points' costs, which are now
  priced by version.

### Changed: `src/energy/arbiter-gain-meter.ts`, `arbiter-gain-store.ts`

The meter no longer reads prices. `book(day, equipmentId, wh, hpShare)` adds `wh`, `wh × hpShare`,
`wh × (1 − hpShare)`. The store's upsert and read carry the two columns.

### Changed: `src/energy/ev-sessions/`

- `ev-session-tracker.ts`, `window-accountant.ts`: `settleWindow` no longer takes prices and no longer returns
  costs; the tracker's `prices()` goes.
- `summary.ts`: `sessionMoney(s, prices)` computes `costHpEur = gridHpWh / 1000 × prices.hp` (and HC), null when
  `prices` is null or 0/0. The tracker passes `pricesAt(versions, session.startedAt)`.
- The API and UI shapes of a session and of the monthly summary are unchanged.

### Changed: `src/backup/backup-manager.ts`

`"tariff_versions"` appended to `BACKUP_TABLES` (no foreign key, order free).

### Changed: UI

- `ui/src/api/energy.ts`: `getTariffVersions`, `createTariffVersion`, `updateTariffVersion`,
  `deleteTariffVersion`, `getTariffContract`, `saveTariffContract`; `saveTariffConfig` sends the schedule only.
- `ui/src/components/settings/TariffSettings.tsx`: the price fields and the hint go; it renders the new
  `TariffContractBlock` and `TariffPriceHistory` above the schedule, and its button reads « Enregistrer les
  horaires ».
- New `ui/src/components/settings/TariffContractBlock.tsx`: the three selects of FR6, saved on change.
- New `ui/src/components/settings/TariffPriceHistory.tsx`: list and inline form of FR6. Dates through
  `lib/format`, numbers in `tabular-nums`, controls with `border border-border`, no middle dot.
- New `ui/src/lib/tariffVersions.ts` (pure, tested): rows newest first with their end date and status
  (`current`, `upcoming`, none) from the versions and today's local date.
- `ui/src/lib/tariff.ts`: `isTariffSaved` unchanged (it looks at the schedule).
- `ui/src/i18n/locales/{en,fr}.json`: `tariff.prices.*` keys; `tariff.priceHp`, `tariff.priceHc` reused in the
  form; `tariff.priceRetroactiveHint` removed.

## Files changed

| Domain | File                                                                            | Change                                                     |
| ------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Types  | `src/shared/types.ts`, `ui/src/types.ts`                                        | `TariffVersion`, `TariffVersionInput`                      |
| DB     | `migrations/044_tariff_versions.sql`                                            | New table, two arbiter columns                             |
| Energy | `src/energy/tariff-version-store.ts` (new)                                      | Store, rules, seed                                         |
| Energy | `src/energy/pricing.ts` (new)                                                   | Version lookup, point and total pricing                    |
| Energy | `src/energy/cost-calculator.ts`                                                 | `blendedRate` removed                                      |
| Energy | `src/energy/bilan.ts`                                                           | `arbiterTile` prices at read time                          |
| Energy | `src/energy/arbiter-gain-meter.ts`, `arbiter-gain-store.ts`                     | Wh in HP/HC instead of euros                               |
| Energy | `src/energy/ev-sessions/{ev-session-tracker,window-accountant,summary}.ts`      | Cost at read time                                          |
| API    | `src/api/routes/energy.ts`                                                      | Pricing by version, version routes, legacy GET/PUT         |
| API    | `src/api/routes/ev-sessions.ts`                                                 | Passes the versions to the summary, if not via the tracker |
| Core   | `src/index.ts`                                                                  | Store creation, seed, wiring into routes, meter, tracker   |
| Backup | `src/backup/backup-manager.ts`                                                  | `tariff_versions` in `BACKUP_TABLES`                       |
| UI     | `ui/src/components/settings/TariffSettings.tsx`, `TariffPriceHistory.tsx` (new) | Price history                                              |
| UI     | `ui/src/api/energy.ts`, `ui/src/i18n/locales/{en,fr}.json`                      | Client calls, strings                                      |
| Docs   | see the docs delta in `spec.md`                                                 |                                                            |
