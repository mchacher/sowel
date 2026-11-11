# Spec 203 — Electricity price file

## Context

Spec 202 gave electricity prices a history: dated versions, each euro priced at read time with the version in
force. The versions are still typed by hand, and the regulated prices change twice a year (1 February,
1 August). The maintainer wants them right without typing, and wants his production to get its whole history
from the same mechanism, not from a one-off manual entry.

This spec is the lot « Price file » of spec 202's split. It replaces decision 8 of the original handoff (a
`tariff-provider` plugin type): a supplier's prices are data, not code.

`specs/202-tariff-history/handoff.md` §8 keeps the facts about the CRE files (format, columns, the 25-day
publication lag).

## Goals

1. A generic, multi-supplier price file, published in this repository, exhaustive for the suppliers it covers:
   every contract type, every subscribed power, every period.
2. The file for EDF Tarif Bleu is produced from the CRE open data, checked, and never published without the
   maintainer's validation.
3. Sowel reads the file every day and adds the prices of the configured contract, at their real start date,
   without ever changing a version that exists.
4. A fresh or upgraded instance gets its past prices from the file, after the user has seen and confirmed them.
5. The mechanism leaves room for other sources later (another supplier in the file; a plugin type for Tempo or
   dynamic prices): nothing in the pricing knows where a version came from.

## Non-Goals

- No supplier other than EDF Tarif Bleu in the file for now. The format takes them; adding one is a pull request.
- No off-peak schedule in the file: the slots are set per meter by Enedis and stay a user input.
- No Tempo, no dynamic prices, no price per hour.
- No change to how a version is priced (spec 202), and no fixed fee on the Bilan (its own lot).
- A version that exists is never corrected from the file, even when its figures differ.

## Functional Requirements

### FR1 — The file

`tariffs/electricity-prices.json`, in this repository:

- a format version, the date it was generated, and a list of suppliers;
- per supplier: an id (`edf-tarif-bleu`), a display name, where the figures come from, and its price rows;
- per row: contract type (`hphc` or `base`), subscribed power (kVA), start date (`YYYY-MM-DD`), peak and
  off-peak price in €/kWh including tax (a `base` row carries its one price in both), fixed fee in €/year
  including tax.

Rows are sorted and unique on (contract type, power, start date). Prices are rounded to 4 decimals, fees to 2.
A power that does not exist for a period simply has no row: nothing is interpolated.

### FR2 — Producing the EDF Tarif Bleu rows

A script reads the two CRE files (`Option_Base.csv`, `Option_HPHC.csv`: CRLF, `;` separator, decimal comma,
dates `DD/MM/YYYY`, the columns including tax) and rewrites the supplier's rows in the file. It fails, without
writing, when a file cannot be read as expected: an unknown column, a duplicate (date, power), a price that is
not a number, a published row that would disappear (a maintainer can allow a removal after checking the source).

A scheduled workflow runs it every night. When the file changes, it opens a pull request that states what
changed (rows added, rows whose figures moved). **Nothing is merged automatically**: the maintainer reviews and
merges. A row whose figures changed for a period already published is called out in the pull request, since
instances that already took it will keep the old figures.

A check runs on every pull request: valid format, sorted and unique rows, prices and fees in range and
rounded, off-peak below peak, an https source link, one row per line.

### FR3 — The contract says whether to follow the file

The contract (spec 202) gains « Mettre à jour les prix automatiquement », on by default when the supplier is in
the file, absent for « Autre fournisseur ». Sowel follows the file only when the option is on, the supplier is in
the file and the power is set.

### FR4 — Daily read

Sowel fetches the file from this repository shortly after startup, then once a day, and when the user asks
(« Vérifier maintenant »). It keeps the last file it read.

For the configured contract (supplier, type, power), the rows whose start date is not the start date of an
existing version are **new prices**. Each is checked before anything is recorded: a real date; prices above 0
and below 1 €/kWh; for `hphc`, off-peak below peak; a fee of 0 or more.

- **Added by itself**: a new price that starts after every existing version (the usual case, each February and
  August), and that moves the peak price by less than 30 % against the version before it.
- **Held for the user**: every other new price. That is the past prices of a fresh or upgraded instance (the
  retroactive fill), a row published late that starts before a version the user entered meanwhile, and a jump of
  30 % or more.

A version created from the file carries `origin: "file:<supplier>"`. An existing version is never modified or
deleted by the file. A read that fails (offline, file unreachable or invalid) changes nothing, is logged, and is
tried again the next day.

### FR5 — Held prices

The settings card lists the held prices of the contract: start date, prices, fee. The user adds them all
(« Ajouter ces prix ») or sets them aside (« Ignorer »). Set aside, a price is not proposed again; it comes back
if the contract changes (another type or power) or when the user asks for the full list.

Adding the past prices does not touch the version without a date: it keeps covering what precedes the first row
of the file.

### FR6 — Telling the user

- A price added by itself: one notification (activity feed and push), saying the date and the prices.
- Prices held: one standing notice, however many prices, until they are added or set aside.
- Under the option, the card says when the file was last checked, the start date of the latest price known for
  the contract, and, when it applies: the check failed (with the date of the last success), or the file has no
  price for this contract (a power that does not exist for this contract type).

## Acceptance Criteria

- [ ] `tariffs/electricity-prices.json` holds every row of the two CRE files for EDF Tarif Bleu, and the check
      passes.
- [ ] The script run on the committed CRE fixtures gives the committed expected rows; a malformed fixture makes
      it fail without writing.
- [ ] The nightly workflow opens a pull request only when the file changes, and merges nothing.
- [ ] With the option on and a contract of 9 kVA off-peak on an instance that only has the version without a
      date, the first read holds every past price; « Ajouter ces prix » creates them with
      `origin: "file:edf-tarif-bleu"`, and the Bilan of a past month is then priced with them.
- [ ] A new period published later is added by itself, with one notification.
- [ ] A row that starts before a manual version, and a 30 % jump, are held, not added.
- [ ] A version that exists is never changed by a read, whatever the file says for its date.
- [ ] An unreachable or invalid file changes nothing and is reported under the option.
- [ ] « Autre fournisseur », the option off, or no power: no read is made.
- [ ] A price set aside is not proposed again by the next read.

## Edge Cases

- The file has no row for the contract (Base at 18 kVA): no proposal, the card says so.
- The user changes the power from 6 to 9 kVA after taking the 6 kVA history: the 9 kVA rows share the start
  dates of the existing versions, so nothing is proposed; the existing versions keep their fee. Stated in the
  docs: correct the versions by hand, or delete them and take the list again.
- A row of the file changes after an instance took it: the instance keeps what it has.
- The user deletes a version that came from the file: its date is set aside, so the next read does not add it
  again.
- Shadow mode: the daily timers are off, like every other outbound poll; « Vérifier maintenant » still reads
  the file, so a shadow seeded from production can try the retroactive fill.
- The option toggled twice in a row, or « Vérifier maintenant » pressed during a read: one read runs, not two.
- The file's format version is higher than the one this Sowel knows: the read is refused and reported, nothing
  is added.
- The first read on an instance with no version at all: the past prices are held like any other, and adding
  them creates the first version without a date from the oldest row, as spec 202 does for any first version.
- The clock is wrong or the newest row is dated in the future: a future version is legitimate (spec 202), it is
  added and applies from its day.

## Docs Delta

| Page (EN and FR)                                | Change                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `docs/user/energy.md` + `.fr.md`                | Step 4: automatic prices, the list of prices to confirm, what « Ignorer » does, the power-change case |
| `docs/technical/api-reference.md` + `.fr.md`    | Contract `autoUpdate`; price file status, check now, apply and dismiss routes                         |
| `docs/technical/architecture.md` + `.fr.md`     | Price file: format, where it lives, the daily read, added by itself versus held                       |
| `docs/technical/data-model.md` (no FR copy)     | Settings `energy.contract.autoUpdate`, `energy.priceFile.*`; `origin` values                          |
| `docs/technical/contributing.md` + `.fr.md`     | How the price file is maintained: the nightly pull request, how to add a supplier                     |
| `docs/release-notes.md` + `.fr.md` (at release) | Automatic prices for EDF Tarif Bleu; how to take the past prices after the upgrade                    |

Screenshots to retake: `energy-tariff-settings-en.png` and `-fr.png` (the option and its status line).
