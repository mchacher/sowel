# Spec 202 — Tariff history: handoff

**Status (2026-11-11): design agreed with the maintainer, reviewed by an independent agent, spec not written, nothing coded.**

> **Superseded in part, same day.** The maintainer cut the scope down: see `spec.md` (« Split of the original
> scope »). This note stays the reference for the facts about the code (§2), the CRE and Enedis data (§8) and the
> repository obligations (§9). Its design sections (§3 to §7, §10) no longer apply as written: no schedule
> history, no `tariff-provider` plugin type (a price file instead), no downgrade safety nets, no per-day EV table.

This note is the input for writing `spec.md`, `architecture.md` and `plan.md` of spec 202. It was produced in a Claude Code session opened in another workspace, hence this handoff. Every claim about the code below was checked against `main` at v1.84.0 (`4908d526`), with file:line references.

## 0. How to use this note

- Follow the `sowel-feature` skill (`.claude/skills/sowel-feature/SKILL.md`): Phase 1 (read), Phase 2 (spec, architecture, plan with test plan, docs delta, specs-index rows, summary « Résumé de la spécification » presented to the maintainer), and **no code before the maintainer's explicit "oui"**.
- §3 lists what the maintainer decided. §4 to §7 are the target design: they are detailed enough to write the spec, not meant to be copied verbatim.
- Two decisions are **contested by the review and not yet re-validated** (§3, marked ⚠). Ask the maintainer first, in Phase 1.
- Open questions are in §10. Do not guess them: ask.
- The maintainer speaks French; answers in the terminal follow `CLAUDE.md` « Answering the user » (short, ordered).

## 1. Problem

After the Bilan page (spec 200, released in v1.84.0), the maintainer found that the HP/HC prices in Sowel were wrong. Entering them by hand is not acceptable with two regulated price changes a year (1 February, 1 August), and **the figures must stay right over time**: a price change must not rewrite the past, and a correction must be possible.

## 2. What the code does today

### 2.1 One undated tariff

- Setting `energy.tariff`: JSON `TariffConfig = { schedules: DaySchedule[] (days 0–6 + slots), prices: { hp, hc } }` (`src/shared/types.ts` ~L2626–2650), read and cached by `TariffClassifier` (`src/energy/tariff-classifier.ts`).
- Written by `PUT /api/v1/settings/energy/tariff` (`src/api/routes/energy.ts` ~L691–705, schema L97–129), read by `GET` (admin only, ~L676–689). It can also be written through the generic `PUT /api/v1/settings` (`src/api/routes/settings.ts` L16: only the shared-access link secret is protected).
- UI: `ui/src/components/settings/TariffSettings.tsx`, in Settings › Énergie (admin only, `ui/src/pages/SettingsPage.tsx` L159–164). It edits **one schedule for all days** (`schedules[0]`, forced to days 0–6 on save), proposes 06:00–22:00 HP / 22:00–06:00 HC before the first save, and says « Ces prix s'appliquent aussi à toute la consommation passée. » (`tariff.priceRetroactiveHint`). `ui/src/lib/tariff.ts`: an empty `schedules` means "never saved".
- Base contract today = no schedule or HP-only slots: everything counts as HP.
- `GET /energy/status.tariffConfigured` = at least one of today's prices > 0 (`energy.ts` L158–169).

### 2.2 Pricing at three different moments

| Data                                                                            | HP/HC split                                                                                                                                                                                                                                           | Price in €                                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| History, Consumption, Bilan, By usage                                           | **frozen at write time**: `energy_hp` / `energy_hc` points written by `HistoryWriter` (`src/history/history-writer.ts` ~L501–523) and, when a production meter exists, by `SelfConsumptionWriter` (`src/energy/self-consumption-writer.ts` ~L332–366) | **at read time with TODAY's prices** (`energy.ts` L210, L295, L420; `src/energy/cost-calculator.ts`)                                              |
| Arbiter gain, `arbiter_daily_gain` (migration 043, per local day and equipment) | computed per minute                                                                                                                                                                                                                                   | **frozen at write time** in € (`src/energy/arbiter-gain-meter.ts` L97–109)                                                                        |
| EV sessions (migration 039)                                                     | session totals `est_grid_hp_wh`, `est_grid_hc_wh`                                                                                                                                                                                                     | **frozen at write time** `est_cost_hp_eur`, `est_cost_hc_eur`; null when prices are 0/0 (`src/energy/ev-sessions/ev-session-tracker.ts` L961–987) |

Pricing details that matter for the design:

- `computeTotals` (`energy.ts` ~L1715–1750) sums the period's Wh, **then** prices them at one price. `bill.total` of the Bilan comes from there (`src/energy/bilan.ts` ~L311).
- `/energy/by-usage` prices sub-meters with **one blended rate for the whole period** (`energy.ts` ~L288–315, `blendedRate`). The Bilan's `usageRows` already prices per point (`bilan.ts` ~L193–215).
- `EnergyBilanResponse.prices` is a single value (`bilan.ts` ~L262), shown in `ui/src/components/energy/BilanPage.tsx` ~L395.
- External client: the `sowel-energy-display` firmware reads `/energy/history`. Do not change the meaning of existing fields.

### 2.3 Influx storage and which bucket each view reads

- Retention (`src/core/influx-client.ts` L12–23): raw `sowel` 7 days, `sowel-energy-hourly` 2 years, `sowel-energy-daily` 10 years.
- Downsampling tasks (`influx-client.ts` ~L809–829):
  - hourly: re-aggregates **the last 7 h** of raw, every hour;
  - daily: re-aggregates **the last 2 days** of hourly, every day, by **UTC day** (`aggregateWindow(every: 1d)` without `location`). A daily point therefore covers 01:00→01:00 local time in winter, 02:00→02:00 in summer.
- Bucket per view (`energy.ts` ~L1290–1327, `computeRange`):

  | View             | Bucket        | Resolution                   |
  | ---------------- | ------------- | ---------------------------- |
  | day < 6 days old | raw           | 1h                           |
  | older day        | energy-hourly | 1h                           |
  | week             | energy-hourly | 1d, aggregated at read time  |
  | month            | energy-daily  | 1d                           |
  | year             | energy-daily  | 1mo, aggregated at read time |

- Read-time aggregation uses `location: getServerTz()` = `process.env.TZ ?? "Europe/Paris"` (`energy.ts` ~L1246). The classifier and `localDateStr` use the **process** time zone (`getHours()`, `getDay()`). The two diverge if `TZ` is unset (the docker-compose sets it).
- Points carry a `zoneId` tag (`history-writer.ts` ~L519–523, `self-consumption-writer.ts` ~L361–366). HP/HC points are written for every equipment with an `energy` binding (`history-writer.ts` ~L375–377).
- **The HP/HC split cannot be computed at read time**: month and year read daily points, which have no time of day. It must stay a write-time value.

### 2.4 Recipes

- `ctx.helpers.getTariff(): RecipeTariff = { configured, offPeakToday: TariffSlot[], isOffPeakNow: boolean | null }` (spec 138, `types.ts` ~L849–892, built by `RecipeManager.buildTariffSnapshot`, `src/recipes/engine/recipe-manager.ts` ~L626). Schedule only, **never prices**, copied by value.
- Two external recipes use it, both through `getTariff?.()` (feature detection):
  - `sowel-recipe-ev-charge-smart` (`src/index.ts` L301, L453): `isOffPeakNow` only. `sowelVersion >=1.73.0`.
  - `sowel-recipe-pool-pump-schedule` (`src/index.ts` L1130–1143): `offPeakToday` evaluated on the current minute, midnight wrap handled. `sowelVersion >=1.52.0`.
- Spec 138 left "reading tomorrow's schedule" out of scope.

### 2.5 Plugins

- `PackageType = "integration" | "recipe"` (`types.ts` ~L2132). Manifest `type` defaults to `integration`. `PackageManager` (`src/packages/package-manager.ts`) filters by type (`getInstalledByType`, `getStoreByType`). Loaders: `src/plugins/plugin-loader.ts` (integrations), `src/recipes/recipe-loader.ts` (recipes). UI: `ui/src/pages/PluginsPage.tsx`, `ui/src/components/layout/UpdatesSheet.tsx`, `PluginDetailSheet.tsx`.
- **An older core ignores an unknown type** (loaders and store filter by type): safe after a downgrade.
- Soft isolation (spec 111, `src/plugins/scoped-deps.ts`): integration plugins see only `integration.<id>.*` settings plus `GLOBAL_READABLE_KEYS`, and emit only `ALLOWED_EMIT_TYPES`. "Extend the allowlists, never weaken the gates." It is not a sandbox (`fetch`, `process.env` are reachable).
- Registry: every entry needs `sha256` and `owner` (spec 089); a release is followed by `scripts/backfill-registry-sha256.mjs` and a `chore(registry): bump …` PR. Manifest `sowelVersion` gates installation.
- Outbound HTTP in the core: plain `fetch` with `AbortSignal.timeout(10_000)` (`package-manager.ts` ~L920–936).

### 2.6 Migrations, backup, update

- Migrations: `migrations/NNN_*.sql`, run at startup, **once, by name** (`src/core/database.ts` ~L79–126). Last: `043_arbiter_daily_gain.sql`.
- Backup (`src/backup/backup-manager.ts`):
  - SQLite tables from an **explicit list** `BACKUP_TABLES` (~L110–160): a new table must be added there.
  - Influx buckets, energy included: energy-hourly 2 years, energy-daily 10 years (~L207–213).
  - Restore empties every listed table, then inserts the backup's rows (~L610–626). Columns unknown to the running schema are skipped.
  - **A table unknown to the running core makes the restore fail** (`Unknown table`, ~L600–604). So a backup taken on a newer core cannot be restored on an older one.
- Self-update (`src/core/update-manager.ts` ~L274–320): backs up before updating (`sowel-backup-pre-v<version>-<ts>.zip`), aborts the update if the backup fails, keeps 3.

## 3. Decisions taken with the maintainer (2026-11-11)

1. **Stay HP/HC**, plus Base (one price, counted as HP, as today). Tempo and N named periods: later.
2. **Dated history, generic.** Versions valid from a local date until the next one. Never overwritten by automation. Corrections and back-dated versions are allowed.
   - ⚠ **Contested by the review: one timeline or two.** See §4.1. The note recommends **two independent timelines** (contract and prices / off-peak schedule). To validate with the maintainer.
3. **Store kWh, compute € at read time** with the version in force at each point's date: history, Bilan, by usage, arbiter, EV sessions. The HP/HC split stays a write-time value.
4. **Subscribed power (kVA) and the fixed fee (€/year incl. tax)** are part of the contract and are dated. The fee is shown in the Bilan, prorated to the period.
5. **Seasons** in the schedule: one all-year schedule, or a winter and a summer schedule. Sowel switches by itself every year.
6. **Configuration flow** (Settings › Énergie):
   1. Supplier « EDF – Tarif Bleu (tarif réglementé) » or « Autre fournisseur ». Say "Tarif Bleu": EDF also sells market offers whose prices do not follow the CRE.
   2. Contract type « Base » or « Heures creuses ».
   3. Subscribed power (kVA).
   4. Off-peak slots (HP/HC only), with a checkbox « Mes heures creuses changent entre l'été et l'hiver ».
   5. Prices and fee: from the provider plugin (EDF), with a checkbox « Mettre à jour automatiquement » checked by default; manual with an effective date otherwise.
   6. History: list of versions, « Ajouter un changement », edit a version.
7. **Energy pages**: the Bilan invites to configure the contract when none is set, shows the contract in force, marks tariff changes on the chart (« nouveau tarif au 1er août »), and says when the previous-year comparison used different prices.
8. **Supplier-specific code goes in a plugin of a new plugin type** (third `PackageType`, working name `tariff-provider`). The core works fully without any provider (« Autre fournisseur » = manual).
9. **EDF – Tarif Bleu provider plugin**, separate repository: Base and HP/HC; a button that fills past versions after validation; daily automatic update; prices and fee only, never slots.
10. **Re-split in this lot**: when the schedule is corrected back-dated, an explicit action rewrites the HP/HC split (§5).
11. **Recipes: "do what is best"** (§4.6).
12. **Every instance is cleaned up automatically at upgrade** (§6).
13. **Deadlines.** ⚠ The review contests the first one, see §7.2. To validate.

## 4. Target design

### 4.1 Two timelines (⚠ to validate, replaces "one version holds everything")

Why: with a single timeline, two cases give silently wrong figures.

- **Case 1.** On 12 February the user records a slot change dated 10 February. The CRE row dated 1 February arrives about 25 days late. It is no longer "after the last version", so it is never applied, and the old price stays for good.
- **Case 2.** The user corrects a slot back-dated. A later version, created by automation with a copy of the old slots, stays wrong.

Proposed model:

| Timeline                                           | Content                                                                                                                                                                                                                                                                                   | Who writes                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Contract** (`tariff_contract_versions`)          | `startDate`, `supplier` (`"other"` or a provider id), `contractType` (`"base"` \| `"hphc"`), `kva`, `prices` (`{ hp, hc }`, TTC €/kWh; Base uses `hp` only), `fixedFeeYear` (TTC €/year, nullable), `origin` (`"manual"` \| `"provider:<id>"` \| `"migration"`), `createdAt`, `updatedAt` | user, provider (append only), migration |
| **Off-peak schedule** (`tariff_schedule_versions`) | `startDate`, `schedule`: `{ kind: "all-year", slots }` or `{ kind: "seasonal", winter: { slots }, summer: { slots }, summerStart: "04-01", winterStart: "11-01" }` (season boundaries stored, Enedis values as defaults), `origin`, timestamps                                            | user and migration only                 |

Rules:

- `startDate` is a local date `YYYY-MM-DD`, computed with the **same helper as the classifier** (`localDateStr`, process time zone). It is unique per timeline (same date = edit that version).
- The **first version of each timeline has no start date**: it is open backwards, so every past point has a version.
- The version in force at instant `t` is the last one with `startDate <= localDate(t)`.
- **The season is that of the minute considered**, not of the slot's start. The night of 31 March to 1 April uses winter slots until 23:59 and summer slots from 00:00. This keeps the classifier per-minute logic and the pool-pump `offPeakToday` evaluation correct without any change.
- A Base contract has no schedule: everything counts as HP, as today.
- IDs are UUID v4 and dates ISO 8601 (`CLAUDE.md`). Both tables go into `BACKUP_TABLES`.

### 4.2 Pricing rules (read time)

- **Price each point** with the contract version in force at the point's start. **Totals are the sum of per-point costs**, not the total Wh at one price: replaces the single-price `computeTotals`.
- With a single version, the result must equal today's figures to the cent. Group the points by version, sum their Wh, then price each group, so the `round4` rounding matches today's.
- **Year view:** price the daily points (the Bilan already loads `currentDaily` / `previousDaily`), then roll up to months, instead of pricing the read-time `1mo` aggregate.
- **By usage:** per point, as `usageRows` already does. `blendedRate` per period goes.
- **Arbiter:** `arbiter_daily_gain` gets `solar_hp_wh` and `solar_hc_wh`, priced at read time with the version of its local day (exact: arbiter rows are per local day).
- **EV sessions:** session totals cannot be priced exactly when a session crosses a version change (overnight charge from 31 July to 1 August). Add a per-session, per-local-day table of Wh HP/HC.
- **Remaining, documented error:** daily points are UTC days. In month and year views, the first 1–2 hours of the night of a change are priced with the previous version. Hourly and raw points align with local midnight (Paris offsets are whole hours), so they are exact.
- **Fixed fee:** per day = `fixedFeeYear / days in that year` (365 or 366). The current period counts elapsed days, today included. Exposed in a **separate field**, never inside the existing `cost_*` / `bill.total`.

### 4.3 API

- New admin routes for the two timelines: list, create, edit, delete a version, with validation (dates, slots covering 24 h without overlap, prices ≥ 0, kVA > 0). Exact paths: to be set in `architecture.md`.
- Legacy `GET /api/v1/settings/energy/tariff`: same shape, returns the versions in force today.
- Legacy `PUT`: **edits the versions in force today in place**, i.e. today's retroactive behaviour, which old UI and external clients expect. Deprecated, removed at increment 8. ⚠ To confirm (§10).
- `/energy/status.tariffConfigured`: true when a contract version has a price > 0.
- `EnergyBilanResponse`: keep `prices` = the version in force at the end of the period. Add `tariffVersions[]` (the versions crossing the period, for the chart markers) and `fixedFee`.
- `/energy/history`: existing fields keep their meaning (firmware client).
- Types in `src/shared/types.ts`, mirrored in `ui/src/types.ts`.

### 4.4 `tariff-provider` plugin type

- Third `PackageType`, with its own loader next to `PluginLoader` / `RecipeLoader`, store and installed lists, a Plugins page section, and the registry.
- **Narrow contract.** The plugin is a pure function, with no access to settings, the event bus or devices:
  ```ts
  interface TariffProvider {
    id: string;
    contractTypes: Array<"base" | "hphc">;
    supportedKva(contractType): number[];
    propose(q: {
      contractType;
      kva;
      after?: string; /* YYYY-MM-DD */
    }): Promise<ProposedContractVersion[]>;
  }
  // deps: logger only (it may fetch on its own; spec 111 is not a sandbox)
  ```
- **The core owns** the daily schedule, retries, validation and recording.
- **Validation before recording** (core):
  - start date valid and not already present in the contract timeline;
  - 0 < price < 1 €/kWh; for HP/HC, HC < HP;
  - kVA in `supportedKva`;
  - a change of more than ±30 % against the previous version is **not** recorded automatically: it is held for the user to confirm.
- **Append rule** (fixes case 1):
  - a proposed version is recorded **at its real start date** whenever no contract version exists with that start date, even when later versions exist;
  - it never modifies an existing version;
  - when later manual versions exist, the user is notified that they may need a look (a manual version created on 10 February with the old prices, for example).
- **Every automatic append triggers a notification** (existing notification service).
- **Failure** (offline, file unreachable, format changed): log at `warn`, keep the versions, retry the next day, and show the last successful check in the settings.
- **UI states:** last check date and last known tariff date; check failed; provider not installed (« Installer ») or install failed (offline).

### 4.5 EDF – Tarif Bleu plugin

- Separate repository. Name to agree: integrations are `sowel-plugin-*`, recipes `sowel-recipe-*`.
- Source: the CRE CSVs (§8). Parse:
  - CRLF line endings, `;` separator, `,` decimal;
  - dates `DD/MM/YYYY`; an empty `DATE_FIN` means "current";
  - round to 4 decimals (the current row has `190,8131821`);
  - use the TTC columns.
- Not every power exists in every period: in the 2026 rows, Base goes from 3 to 15 kVA only. A missing power is a clear error, never a guess.
- « Remplir l'historique » button: proposes every period since 2012 for the contract type and power of each contract version. The user validates the list before anything is recorded.

### 4.6 Recipes API (decision: "what is best")

- `getTariff()` is **unchanged**: shape, today's slots, and `isOffPeakNow` computed on the current minute with the season of that minute. **The two existing recipes need no change.**
- Add two **optional** helpers, feature-detectable by an older core:
  - `isOffPeak?(at: Date): boolean | null`, which returns null when no tariff is configured;
  - `getTariffOn?(date: "YYYY-MM-DD"): RecipeTariff`, to plan tomorrow.
- A recipe using them raises its `sowelVersion`.
- Prices stay out of the recipes API (spec 138).

## 5. Re-split (re-découpage)

Writing back only the hourly bucket is not enough (review, checked in `influx-client.ts` ~L809–829 and `energy.ts` ~L1297–1302):

- the hourly task re-reads 7 h of raw and would overwrite re-split hours with the old split;
- the daily task only re-aggregates 2 days, so months and years would never see it;
- the day view reads raw for days less than 6 days old.

The required procedure:

1. Scope: the user's date range, at most 2 years (hourly retention), **excluding hours still open**. Only `energy_hp` / `energy_hc` points that already exist; equipments with only `energy` gain nothing.
2. For each affected hour, recompute the split from the hour's `energy` with the corrected schedule. A slot boundary inside an hour (e.g. 22:30) is prorated within that hour; raw points, where present (7 days), give the exact split.
3. Write back to raw (when in range) and hourly, **copying the existing point's full tag set** (`zoneId` included). Using the current tags after a zone change would create a second series and count the energy twice.
4. Recompute the **daily** points of the affected days exactly as the task does (UTC days, no `location`, sum of the hourly points).
5. Before writing: export the affected points (the restore format), show a before/after preview of kWh HP/HC and €, and ask for confirmation.
6. Daily points older than the hourly retention keep their split.

## 6. Migration, downgrade, backup

- **Seeding at upgrade:** `energy.tariff` becomes the first version of each timeline, open backwards, `origin: "migration"`.
- **Arbiter rows** (a few days at most, since v1.84.0): `hpShare = (rate − hc) / (hp − hc)`, clamped to [0, 1]. This is exact when prices have not changed since the row was written, approximate on those few days otherwise. When `hp = hc`, or prices are 0/0, everything counts as HP (state it).
- **EV sessions:** the existing per-session HP/HC Wh price without loss. Older sessions have no per-day table: price them on the version at their start (state it).
- **Downgrade safety:**
  - until increment 8, keep writing `energy.tariff`, `avoided_eur` **and** `est_cost_hp_eur` / `est_cost_hc_eur`, so that an older core still shows its figures;
  - an older core (or the generic `PUT /api/v1/settings`) may edit `energy.tariff` after a downgrade. At startup, the new core reconciles: it stores a hash of the last synced value, and when the setting changed outside it, it updates the versions in force today;
  - migrations run once by name. Do the seeding so that **a jump straight to increment 8 cannot lose the tariff**: increment 8 deletes `energy.tariff` only when a "converted" marker exists.
- **Backup:**
  - add both tables (and the EV per-day table) to `BACKUP_TABLES`;
  - restoring a backup taken before spec 202 empties the version tables and restores `energy.tariff`: **reseed after restore** when the timelines are empty;
  - a backup taken after spec 202 cannot be restored on an older core (`Unknown table`): rollback goes through the pre-update backup. Say so in the release notes.

## 7. Increments, deadlines, tests

### 7.1 Increments (each one releasable; figures unchanged until the user acts)

| #   | Increment                                                                                                                                                                            | Visible                                 | Rollback                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------- |
| 0   | Reference fixtures (synthetic, in the repo) + golden tests on history, Bilan, by usage                                                                                               | nothing                                 | –                                  |
| 1   | Two timelines, seeding, legacy GET/PUT on top, reconcile at startup, backup tables, reseed after restore                                                                             | nothing                                 | yes                                |
| 2   | Per-point pricing by version; arbiter Wh HP/HC; EV per-day table; old € columns still written. One release in shadow: **display the old figures**, compute the new ones, log any gap | nothing                                 | yes                                |
| 3   | New configuration flow, « Autre fournisseur » only; Bilan invitation, contract shown, change markers, fee                                                                            | **first visible change**, release notes | yes, through the pre-update backup |
| 4   | Seasons; recipes `isOffPeak?` / `getTariffOn?`                                                                                                                                       | « été/hiver » checkbox                  | yes                                |
| 5   | Re-split (§5)                                                                                                                                                                        | new action                              | export taken before writing        |
| 6   | `tariff-provider` type, loader, core scheduler, validation, notifications                                                                                                            | nothing without a provider              | yes                                |
| 7   | EDF – Tarif Bleu plugin + registry entry                                                                                                                                             | « EDF » in the flow                     | uninstall; versions stay           |
| 8   | Cleanup one or two releases later: `energy.tariff` (with marker), `avoided_eur`, `est_cost_*`, legacy PUT                                                                            | nothing                                 | no, hence the wait                 |

### 7.2 Deadlines (⚠ to validate, the review contests 1 December)

- **1 December 2026 is not the forcing date.** The split is written at the time of measurement, so editing today's single setting on the day the slots change already gives a correct split from then on.
- What breaks first is **the price change of 1 February 2027**: entering it today reprices the whole past.
- Proposal:
  - **increments 1–3 before 1 February 2027.** The CRE lag lets the version be entered back-dated until about the end of February;
  - **increment 4 before 1 April 2027** (first summer switch for phase 2 customers);
  - the rest without a deadline.
- Increments 1–3, with a shadow release, in 3 weeks are not realistic.

### 7.3 Test strategy

- Golden tests on **synthetic fixtures**: no installation data in this public repo (`CLAUDE.md`, private `sowel-ops`). Real-instance comparisons stay in `sowel-ops`.
- With one version: history, Bilan and by-usage figures are identical to today's, to the cent. Arbiter and EV gaps are expected when prices were ever edited: log them, do not assert zero.
- Cases to cover:
  - a version starting on the 1st;
  - a version starting mid-month;
  - an EV session across a change;
  - a seasonal night (31 March → 1 April, 31 October → 1 November);
  - DST nights;
  - `end = "00:00"` and midnight-wrap slots;
  - Base contract;
  - prices 0/0;
  - a late CRE row inserted before a later manual version;
  - a ±30 % jump held for confirmation;
  - reconciliation after a downgrade edit;
  - restore of a pre-202 backup;
  - re-split with a zone change (tags preserved) and with open hours excluded.

## 8. External facts (checked 2026-11-11)

**CRE open data, regulated residential tariffs (Tarif Bleu).** data.gouv.fr dataset « Historique des tarifs réglementés de vente d'électricité pour les consommateurs résidentiels », producer CRE, semiannual. Last update 2026-08-26. **Licence not specified** on data.gouv.fr: to clear before publishing the plugin (§10).

- HP/HC: <https://www.cre.fr/fileadmin/Documents/Open_data/Marches_de_detail/Option_HPHC.csv> (data.gouv redirect <https://www.data.gouv.fr/api/1/datasets/r/f7303b3a-93c7-4242-813d-84919034c416>)
  `DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HC_HT;PART_VARIABLE_HC_TTC;PART_VARIABLE_HP_HT;PART_VARIABLE_HP_TTC`
- Base: <https://www.cre.fr/fileadmin/Documents/Open_data/Marches_de_detail/Option_Base.csv> (redirect `…/r/c13d05e5-9e55-4d03-bf7e-042a2ade7e49`)
  `DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HT;PART_VARIABLE_TTC`
- Notice: <https://www.cre.fr/fileadmin/Documents/Open_data/Marches_de_detail/Notice.txt>. Scope: Tarif Bleu residential, mainland France, ≤ 36 kVA. Fixed part = annual subscription in €; taxes included in TTC: CTA, CSPE (accise), TCFE, VAT.
- Both files:
  - ASCII, CRLF, `;` separator, `,` decimal, dates `DD/MM/YYYY`;
  - data since 23/07/2012, 23 periods;
  - no duplicate (date, power) pair.
- Powers present in the 2026 rows: HP/HC 3 to 36 kVA (3 kVA in one period only), Base 3 to 15 kVA.
- Last rows for 6 kVA:
  ```
  HPHC 01/08/2025;31/01/2026;6;135,6;189,99;0,1063;0,1635;0,1434;0,2081
  HPHC 01/02/2026;31/07/2026;6;141,6;188,24;0,1007;0,1578;0,1412;0,2065
  HPHC 01/08/2026;;6;143,28;190,8131821;0,1018;0,1589;0,1479;0,2142
  BASE 01/08/2025;31/01/2026;6;132,84;185,94;0,1327;0,1952
  BASE 01/02/2026;31/07/2026;6;141,6;188,2;0,1308;0,1940
  BASE 01/08/2026;;6;143,28;190,81;0,1361;0,2001
  ```
- The 1 August 2026 row was published about 25 days after the change.

**Enedis off-peak reform** (<https://www.enedis.fr/heures-creuses>, article of 2026-11-09):

- Phase 1, November 2025 – May 2026, ~1.7 M customers: new slots, same all year.
- Phase 2, **from 1 December 2026**, progressive until the end of October 2027, ~9.3 M customers: **seasonal slots**, winter 1 November – 31 March, summer 1 April – 31 October.
- 8 off-peak hours a day, at least 5 consecutive at night. Windows: winter 11h–17h and 21h–7h; summer 10h–18h and 23h–7h.
- Set locally by Enedis, changed remotely through Linky; the supplier warns about one month before.
- No public source for a customer's slots: they stay a user input. (Linky TIC could give the live period; not checked, out of scope.)

## 9. Repository obligations (from `CLAUDE.md`)

- Feature branch `feat/…`; conventional commits, scope `energy` (also `plugins`, `recipes`, `backup`, `db`, `ui`). **No `Co-Authored-By: Claude` line.** Never merge without the maintainer's explicit approval.
- Row for spec 202 in **both** `docs/specs-index.md` and `docs/specs-index.fr.md`, at most 250 characters, ending `Unreleased.`. `check-specs-index.sh` fails the first PR otherwise.
- Docs EN + FR to update (both files of each pair change together, `check-docs-parity.sh`):
  - `docs/user/energy`, `docs/user/getting-started`, `docs/user/index`;
  - `docs/deep-dives/energy-tour`, `docs/deep-dives/surplus-arbiter`;
  - `docs/technical/data-model` (EN only today), `api-reference`, `architecture` (plugin types, §InfluxDB), `plugin-development` (new type), `recipe-development` (`getTariff`), `deployment` (backup / rollback note).
- Release notes EN + FR at each visible increment (`verify-release-notes`).
- Plugin soft isolation: extend the allowlists, never weaken the gates. Registry sha256 / owner procedure for the EDF plugin (`sowel-plugin-dev` skill).
- `npm run validate` green before each push. `sowel-reviewer` agent before each PR.

## 10. Open questions for the maintainer

1. ⚠ Two timelines (contract and prices / schedule) instead of one (§4.1)?
2. ⚠ Deadlines: increments 1–3 before 1 February 2027 instead of 1 December 2026 (§7.2)?
3. Legacy `PUT /settings/energy/tariff`: edit today's versions in place (recommended) or append a version dated today?
4. ±30 % threshold for holding an automatic price change: OK?
5. Name of the EDF plugin repository, and the new plugin type's name (`tariff-provider`?).
6. CRE data licence: who checks before the plugin is published?
7. One spec 202 with one PR per increment (recommended), or split into several specs (core / provider type / EDF plugin)?

## 11. Review trail

An independent agent reviewed the first version of this note on 2026-11-11 (read-only, against `main`). Its findings, verified by the author and integrated above:

- re-split invisible without rewriting raw + hourly + daily, and tag preservation (§5);
- per-bucket pricing not exact: UTC daily buckets, `1mo` year view, blended by-usage rate, single-price `computeTotals`, EV session totals (§4.2);
- one timeline gives silent errors with late CRE rows and back-dated slot corrections (§4.1);
- the forcing deadline is 1 February 2027 (§7.2);
- "identical figures" does not hold for EV / arbiter or rounding (§7.3);
- downgrade / skipped versions / reconcile (§6);
- backup list and restore seeding (§6);
- legacy API semantics (§4.3);
- provider validation, notification and narrow contract (§4.4);
- time zone helper (§4.1);
- public repo vs installation data, specs index, docs list (§7.3, §9);
- "day/month/year read daily" was wrong (§2.3).

The review also confirmed as correct: the line references for pricing (EV off by about 2 lines, fixed), the write-time € of the arbiter and EV, the retention values, the recipes API without prices, the two plugin types, and the arbiter conversion formula.
