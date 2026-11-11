# Implementation Plan — Spec 203

Branch `feat/price-file`. Two pull requests, so the file is on `main` before any instance reads it:

1. **PR A — the file and its upkeep** (slices A, B): no change for a running instance.
2. **PR B — the daily read** (slices C to F), once PR A is merged and the file is served.

## Slices

### Slice A — Format and conversion

- [x] A.1 — `src/energy/price-file/price-file.ts`: types, `parsePriceFile`, `rowsFor`
- [x] A.2 — `src/energy/price-file/cre-csv.ts`: `parseCreCsv`, `buildEdfTarifBleu`
- [x] A.3 — Fixtures: two short CSV in the CRE format (synthetic rows plus a few real public ones), expected rows

### Slice B — File, scripts, workflow

- [x] B.1 — `scripts/tariffs/update-edf-tarif-bleu.ts`; first `tariffs/electricity-prices.json` from the live
      CRE files, row counts compared with the CSV
- [x] B.2 — `scripts/tariffs/check.ts`, step in `ci.yml`, `scripts/README.md`
- [x] B.3 — `.github/workflows/tariffs.yml`
- [ ] B.3b — The maintainer creates the secret `TARIFFS_PR_TOKEN`
- [ ] B.4 — Once merged and the secret set, run the workflow by hand: nothing opened on an unchanged file. Then
      exercise the path that pushes, which a no-change run never reaches: run it from a branch where one row of
      the file was removed, check the pull request opens with its checks running, close it

### Slice C — Deciding what to add

- [x] C.1 — `newPrices` in `price-file.ts`
- [x] C.2 — `TariffContract.autoUpdate`, `normalizeContract`, contract routes and their tests

### Slice D — Daily read

- [x] D.1 — `price-file-sync.ts`: `check`, `apply`, `dismiss`, `status`, settings, timers
- [x] D.2 — Notifications; confirm the resolution-without-raise form in the UI and the push channel
- [x] D.3 — Five routes, wiring in `server.ts` and `index.ts`

### Slice E — UI

- [x] E.1 — Mockup of the held prices panel, validated by the maintainer
- [x] E.2 — Option, status line and « Vérifier maintenant » in `TariffContractBlock.tsx`
- [x] E.3 — `TariffPriceProposals.tsx`, strings EN and FR
- [x] E.4 — Checked on a scratch instance reading the real file from `main`: 390 px and 1280 px in light,
      1280 px in dark; the 23 prices of a 9 kVA off-peak contract added through the button (768 px and the phone
      in dark not checked)

### Slice F — Docs and trial

- [x] F.1 — The docs delta of `spec.md`, EN and FR, screenshots
- [x] F.2 — Specs index rows (done with the spec)
- [ ] F.3 — Trial on a local shadow instance seeded from production (`scripts/shadow-deploy.sh`, asked by the
      maintainer): Bilan of a month and a year noted before, the past prices added, the same views after; the
      differences explained by the prices alone

## Test Plan

### Modules to test

`price-file` (parse, rows, new prices), `cre-csv`, `price-file-sync`, `pricing` (`normalizeContract`),
`api/routes/energy` (the five routes, the contract), the scripts (through the modules they call), UI lib and
component for the held prices.

### Scenarios

| Module          | Scenario                                                                                                              | Expected                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| cre-csv         | The off-peak fixture (CRLF, `;`, decimal comma, an empty end date)                                                    | Rows with ISO dates, 4 and 2 decimals, the TTC columns                                                         |
| cre-csv         | The Base fixture                                                                                                      | One price stored as `hp` and `hc`                                                                              |
| cre-csv         | A fee with many decimals (`190,8131821`)                                                                              | `190.81`                                                                                                       |
| cre-csv         | An unknown header; a duplicate (date, power); a figure that is not a number                                           | Throws, names the line                                                                                         |
| price-file      | The committed `tariffs/electricity-prices.json`                                                                       | Parses; rows sorted and unique                                                                                 |
| price-file      | `format` 2; an unknown contract type; a date `2026-02-30`; a price of 2 €/kWh                                         | `PriceFileError` with the reason                                                                               |
| price-file      | Rows out of order; two rows on one key                                                                                | `PriceFileError`                                                                                               |
| price-file      | `rowsFor` a known contract; a power with no row; an unknown supplier                                                  | Its rows oldest first; empty; empty                                                                            |
| price-file      | `newPrices`: only the version without a date exists                                                                   | Every row held, none automatic                                                                                 |
| price-file      | `newPrices`: history present, one newer row within 30 %                                                               | That row automatic                                                                                             |
| price-file      | `newPrices`: two newer rows in one read, each within 30 % of the one before                                           | Both automatic                                                                                                 |
| price-file      | `newPrices`: a newer row 30 % above the version before it                                                             | Held                                                                                                           |
| price-file      | `newPrices`: a row that starts before a manual version                                                                | Held                                                                                                           |
| price-file      | `newPrices`: a start date already used by a version, with other figures                                               | Not proposed                                                                                                   |
| price-file      | `newPrices`: a dismissed row                                                                                          | Not proposed                                                                                                   |
| price-file      | An `hphc` row with off-peak at or above peak; a price with 5 decimals; an http link                                   | `PriceFileError`: the file is refused whole                                                                    |
| pricing         | `normalizeContract`: `autoUpdate` absent for `edf-tarif-bleu`; for `other`                                            | `true`; `false`                                                                                                |
| price-file-sync | Contract `other`, option off, or no power                                                                             | No fetch                                                                                                       |
| price-file-sync | Fetch fails; answers 404; answers invalid JSON; answers `format` 2                                                    | No version created, error in the status, last success unchanged                                                |
| price-file-sync | First read on an instance with one dateless version                                                                   | Pending holds every row; one notification, not repeated by a restart                                           |
| price-file-sync | `apply` every pending row                                                                                             | Versions created oldest first, `origin` `file:edf-tarif-bleu`, the dateless version untouched; notice resolved |
| price-file-sync | `apply` on an instance with no version                                                                                | The oldest row becomes the version without a date                                                              |
| price-file-sync | `dismiss`, then a new read                                                                                            | Nothing pending; the list survives a restart                                                                   |
| price-file-sync | A newer row appears in the file                                                                                       | One version created, one notification                                                                          |
| price-file-sync | Two `check()` at once                                                                                                 | One fetch                                                                                                      |
| price-file-sync | The status after a restart                                                                                            | The dates of the last check and success read from the setting                                                  |
| energy routes   | The status `GET` as a standard user (the POSTs are refused by the global role gate, which the harness does not mount) | `403`                                                                                                          |
| energy routes   | `apply` with a start date that is not pending                                                                         | `400`, nothing created                                                                                         |
| energy routes   | Contract `PUT` with `autoUpdate`                                                                                      | Saved, read back, a check started                                                                              |
| ui              | Held prices: list, « Ajouter ces prix », « Ignorer »                                                                  | The right calls, the list reloads                                                                              |
| ui              | Status line: checked, failed, no price for this contract                                                              | The right sentence                                                                                             |

Core test seen failing on purpose: make `newPrices` return every row as automatic; the « held » tests must fail.

## Validation Plan

- `npm run validate`
- `bash scripts/check-specs-complete.sh`, `check-specs-index.sh folders`, `check-docs-parity.sh`,
  `check-docs-impact.sh`, `npx tsx scripts/tariffs/check.ts`
- `sowel-reviewer` on each pull request, with a close look at: a version never modified, the automatic versus
  held rule, a failed read changing nothing
- Trial F.3 on a local shadow before the release
