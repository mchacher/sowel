# Architecture — Spec 203

## Flow diagram

```
CRE open data (2 CSV)                      this repository                         a Sowel instance
        │                                                                                │
        ▼                                                                                │
.github/workflows/tariffs.yml (nightly, manual)                                          │
  └─ npx tsx scripts/tariffs/update-edf-tarif-bleu.ts                                    │
       parseCreCsv() ─► buildSupplier() ─► tariffs/electricity-prices.json               │
  └─ file changed? ─► pull request (maintainer reviews, merges)                          │
                                                                                         │
ci.yml: npx tsx scripts/tariffs/check.ts (on a PR touching the file)                     │
                                                                                         ▼
                              raw.githubusercontent.com/mchacher/sowel/main/tariffs/electricity-prices.json
                                                                                         │ daily, 10 s timeout
                                                                                         ▼
                                                                    PriceFileSync.check()
                                                                      parsePriceFile()  (validates, refuses a newer format)
                                                                      newPrices(file, contract, versions, dismissed)
                                                                        ├─ automatic ─► TariffVersionStore.create(…, "file:<supplier>")
                                                                        │                └─ notification
                                                                        └─ held ──────► status.pending ─► standing notice
                                                                                         │
                                              Settings › Énergie ◄── GET status ─────────┘
                                                 « Ajouter ces prix » ─► POST apply ─► create()
                                                 « Ignorer »          ─► POST dismiss
```

## The file

`tariffs/electricity-prices.json`:

```json
{
  "format": 1,
  "generatedAt": "2026-11-11",
  "suppliers": [
    {
      "id": "edf-tarif-bleu",
      "name": "EDF, Tarif Bleu (tarif réglementé)",
      "source": "CRE, historique des tarifs réglementés de vente d'électricité (résidentiel)",
      "sourceUrl": "https://www.cre.fr/documents/open-data",
      "prices": [
        {
          "contractType": "base",
          "kva": 9,
          "startDate": "2026-08-01",
          "hp": 0.1985,
          "hc": 0.1985,
          "fixedFeeYear": 239.84
        },
        {
          "contractType": "hphc",
          "kva": 9,
          "startDate": "2026-08-01",
          "hp": 0.2142,
          "hc": 0.1589,
          "fixedFeeYear": 239.84
        }
      ]
    }
  ]
}
```

About 300 rows today (115 Base, 185 off-peak), 23 periods since 23 July 2012. One line per row, so a pull request
reads as a list of added lines.

## Components

### New: `src/energy/price-file/price-file.ts` (pure)

- Types `PriceFile`, `PriceFileSupplier`, `PriceFileRow`; `PRICE_FILE_FORMAT = 1`.
- `parsePriceFile(value: unknown): PriceFile` — throws `PriceFileError` with a reason: not an object, a format
  above the one known, a supplier without id, a row with an unknown contract type, a date that is not a real
  day, a price or fee out of range, rows not sorted or not unique. Used by the core on every read and by the CI
  check: one definition of a valid file.
- `rowsFor(file, contract): PriceFileRow[]` — the supplier's rows of that type and power, oldest first.
- `newPrices(rows, versions, dismissed): { automatic: PriceFileRow[]; held: PriceFileRow[] }` — FR4: drops the
  start dates already used by a version and the dismissed ones; `automatic` = rows after every existing version
  whose peak price is within 30 % of the price in force before them (each row compared with the one before it,
  so two new periods in one read chain correctly); everything else is `held`. With no version at all,
  everything is held.
- `MAX_AUTO_CHANGE = 0.3`.

### New: `src/energy/price-file/cre-csv.ts` (pure)

`parseCreCsv(text, contractType): PriceFileRow[]` — CRLF, `;`, decimal comma, `DD/MM/YYYY`, the `_TTC` columns,
4 and 2 decimals. Throws on a header that is not the expected one, a duplicate (date, power), a non-numeric
figure. `buildEdfTarifBleu(baseCsv, hphcCsv): PriceFileSupplier`.

### New: `scripts/tariffs/update-edf-tarif-bleu.ts`, `scripts/tariffs/check.ts`

Run with `npx tsx`, and type-checked with the tests (`tsconfig.test.json`). The update script only reads and
writes: it fetches the two CSV and hands them to `planSupplierUpdate` (`cre-csv.ts`, tested), which refuses a
published row that disappeared (unless `--allow-removal`), returns nothing to write when the rows and the
supplier's texts are as published, and gives the summary (added, changed, removed) the workflow puts in the pull
request body. The check script runs `parsePriceFile` on the committed file and compares its layout with
`serializePriceFile`.

### New: `.github/workflows/tariffs.yml`

`schedule` (nightly) and `workflow_dispatch`. Steps: checkout without persisted credentials, Node 24, `npm ci`
with `HUSKY=0` (the repository's git hooks must not run on the runner: its pre-push is `npm run validate`),
update script, check script, and when `git diff --quiet tariffs/` fails: commit on the fixed branch
`chore/tariffs-update`, force-push, `gh pr create`, or `gh pr edit` when a pull request of this repository is
already open. When the update branch already holds the same rows (a pull request waiting, or closed on purpose),
nothing is pushed: only the generation date would differ.

The secret `TARIFFS_PR_TOKEN` (fine-grained, this repository only, contents and pull requests: write) is
required: a pull request opened with the default token does not start the CI workflows `main` requires, and this
repository does not let the default token open pull requests. The default token is read-only here; the secret
is given to the last step alone, after `npm ci` and the script have run, so no dependency code runs with a token
that can write. Without the secret, a night when the file changed fails with a message; nothing is opened.

### Changed: `.github/workflows/ci.yml`, `scripts/README.md`

A job step `npx tsx scripts/tariffs/check.ts`, next to the registry check.

### New: `src/energy/price-file/price-file-sync.ts`

`PriceFileSync` — the only part with I/O.

- `start()` / `stop()`: a first check one minute after startup, then every 24 h (`setInterval`, as
  `VersionChecker`). Handlers never throw.
- `check(): Promise<PriceFileStatus>` — returns at once when the contract does not follow the file (FR3).
  Otherwise `fetch(PRICE_FILE_URL, { signal: AbortSignal.timeout(10_000) })`, `parsePriceFile`, `rowsFor`,
  `newPrices`; creates the automatic ones through `TariffVersionStore.create(row, "file:<supplier>")`; keeps the
  held ones in memory; stores the status. A second call while one runs returns the same promise.
- `apply(startDates)` / `dismiss(startDates)`: from the held list of the last read. `apply` creates oldest first,
  so the first version of an empty instance is the oldest row (spec 202: the first version has no date).
- `status()`: `{ following, lastCheckAt, lastSuccessAt, error, latestStartDate, noPriceForContract, pending }`.
- Settings: `energy.priceFile.status` (the three dates and the error, so the card is right after a restart),
  `energy.priceFile.dismissed` (JSON list of `"<supplier>|<type>|<kva>|<startDate>"`).
- The URL is a constant, as `REGISTRY_URL` is: an instance cannot be pointed at another file.

### Notifications

Through the existing alarm events, which already reach the activity feed and the push channel:

- prices held: `system.alarm.raised`, level `warning`, `alarmId: "price-file.pending"`, source `price-file`,
  with a `messageKey`; resolved (`system.alarm.resolved`) when the list is empty again;
- a price added by itself: a `system.alarm.resolved` event alone, `alarmId: "price-file.added.<startDate>"`,
  which the feed and the push show as a done item. To confirm when implementing that the UI accepts a resolution
  without a raise; if not, a raise followed by its resolution.

### Changed: contract (`src/shared/types.ts`, `src/energy/pricing.ts`, routes, UI)

`TariffContract.autoUpdate: boolean`. `normalizeContract` reads it, defaulting to `true` for a supplier in the
file and `false` for `other`. A contract change calls `PriceFileSync.check()` (not awaited by the route).

### Changed: `src/api/routes/energy.ts`

Admin only, same gating as the version routes:

- `GET  /api/v1/settings/energy/price-file` → `PriceFileStatus`
- `POST /api/v1/settings/energy/price-file/check` → runs a check, returns the status
- `POST /api/v1/settings/energy/price-file/apply` body `{ startDates: string[] }` → `{ created, status }`;
  `400` when a date is not waiting, nothing created
- `POST /api/v1/settings/energy/price-file/dismiss` body `{ startDates: string[] }` → the status
- `POST /api/v1/settings/energy/price-file/restore-dismissed` → the status, the contract's set-aside prices
  proposed again

`DELETE …/tariff/versions/:id` also sets the deleted version's date aside when its origin is `file:…`:
otherwise the next read would add it again.

### Changed: UI

- `TariffContractBlock.tsx`: the checkbox and its status line (mockup validated on 2026-11-11), « Vérifier
  maintenant ».
- New `TariffPriceProposals.tsx`: the held prices, above the price list, with « Ajouter ces prix » and
  « Ignorer ». **A to-scale mockup is validated by the maintainer before this component is coded.**
- `TariffPriceHistory.tsx` reloads after an apply.
- `ui/src/api/energy.ts`, `ui/src/types.ts`, strings EN and FR.

## Files changed

| Domain  | File                                                                           | Change                                         |
| ------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| Data    | `tariffs/electricity-prices.json` (new)                                        | The price file                                 |
| Energy  | `src/energy/price-file/{price-file,cre-csv,price-file-sync}.ts` (new)          | Format, CRE conversion, daily read             |
| Energy  | `src/energy/pricing.ts`                                                        | `normalizeContract` with `autoUpdate`          |
| Types   | `src/shared/types.ts`, `ui/src/types.ts`                                       | `TariffContract.autoUpdate`, `PriceFileStatus` |
| API     | `src/api/routes/energy.ts`, `src/api/server.ts`                                | Four routes, wiring                            |
| Core    | `src/index.ts`                                                                 | Create, start and stop `PriceFileSync`         |
| Scripts | `scripts/tariffs/update-edf-tarif-bleu.ts`, `scripts/tariffs/check.ts` (new)   | Produce and check the file                     |
| CI      | `.github/workflows/tariffs.yml` (new), `.github/workflows/ci.yml`              | Nightly pull request, file check               |
| UI      | `ui/src/components/settings/Tariff{ContractBlock,PriceProposals,Settings}.tsx` | Option, status, held prices                    |
| Docs    | see the docs delta in `spec.md`                                                |                                                |
