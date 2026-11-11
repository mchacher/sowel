# Spec 202 — Dated electricity prices

## Context

Sowel keeps one undated tariff (`energy.tariff`: an HP/HC schedule and two prices). The HP/HC split of each
consumption is frozen when it is written, but euros are computed when a page is read, with today's prices
(spec 123). So every price change reprices the whole past, and the Bilan (spec 200) compares a year with the
previous one at the same prices. Regulated prices change twice a year (1 February, 1 August): the next change,
on 1 February 2027, would silently rewrite every figure already shown.

The arbiter gain (spec 200) and the EV sessions (spec 191) do the opposite: they freeze euros when they are
written, so a wrong or late price can never be corrected.

This spec gives prices a history and makes every euro a read-time value computed with the price in force at the
date of the energy.

`handoff.md` in this folder is the reference for the facts about the code (with `file:line`), the CRE data and
the repository obligations. Its design sections (§3 to §7, §10) are replaced by this spec and by the split below.

## Split of the original scope

The handoff described one large lot. The maintainer cut it down on 2026-11-11:

| Lot                                  | Content                                                                                                                                                                                                                                                                                                                                                                                                          | When                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Spec 202 (this one)**              | Dated prices with subscribed power and fixed fee, every euro priced at read time with the version of its date, contract (supplier, type, power) and price history in the settings                                                                                                                                                                                                                                | now                    |
| Fixed fee and changes on the Bilan   | The fee prorated to the period in a separate field, price-change markers on the chart, a mention when the previous year used other prices                                                                                                                                                                                                                                                                        | before 1 February 2027 |
| Price file                           | A generic, multi-supplier price file (supplier, contract type, power, start date, HP/HC or Base prices incl. tax, yearly fee incl. tax) published in a GitHub repository; a nightly action converts the CRE CSVs and opens a PR, the maintainer validates, nothing is published automatically; the core reads the file daily, validates, appends a version at its real start date, notifies. Replaces decision 8 | before 1 February 2027 |
| Seasonal off-peak slots              | Winter and summer slots in the schedule setting, switch dates stored with the Enedis values as defaults, the season being that of the minute considered                                                                                                                                                                                                                                                          | before 1 April 2027    |
| Re-split of past HP/HC (issue)       | The procedure of handoff §5: raw, hourly and daily points, tags kept, open hours excluded                                                                                                                                                                                                                                                                                                                        | no date                |
| `isOffPeak(at)`, `getTariffOn(date)` | Recipe helpers, sent to issue #392                                                                                                                                                                                                                                                                                                                                                                               | with #392              |

Each later lot gets its spec number when it starts.

The whole Settings › Énergie tariff card was validated by the maintainer on 2026-11-11 on a to-scale mockup
(<https://claude.ai/artifact/8db2iKvckRQ7TpCupgDkNt>, private to the maintainer). It shows the target page; this
spec builds the « Contrat » and « Prix » blocks only. Left to their lots: the checkbox « Mettre à jour les prix
automatiquement » (price file), and the winter and summer blocks (seasonal slots: one block per season on the model
of today's block, the season dates of Enedis, 1 April and 1 November, stored in the setting and not shown as
fields, no « apply from » date).

Dropped for good: a history of the off-peak schedule (the schedule stays the live setting, since the split is a
write-time value), the `tariff-provider` plugin type and the EDF plugin, the downgrade safety nets (double writes,
reconciliation, shadow release, cleanup increment), the per-day EV table.

## Goals

1. A price change no longer reprices the past.
2. A past price can be corrected, and a past change can be entered late.
3. One rule for every euro Sowel shows: history, Bilan, by usage, arbiter gain, EV sessions.
4. With a single version, the history and Bilan figures are the same as today, to the cent.
5. The price history can take other writers later (a price file, then possibly a plugin type for Tempo or
   dynamic tariffs) without a schema change in the pricing.

## Non-Goals

- No change to the HP/HC schedule, to the write-time split or to `ctx.helpers.getTariff()`.
- The fixed fee and the subscribed power are stored and editable, but shown nowhere outside the settings.
- No automatic price source. The supplier is stored and shown, and has no effect before the price file lot.
- No change to the meaning of the existing fields of `/energy/history` (the `sowel-energy-display` firmware
  reads it).
- No safety net for a downgrade: rollback goes through the pre-update backup.

## Functional Requirements

### FR1 — Price versions

A price version holds: the peak and off-peak prices (€/kWh incl. tax; a Base contract uses the peak price only,
as today), the fixed fee (€/year incl. tax, optional), the subscribed power (kVA, optional), its origin and its
timestamps.

- A version is valid from its start date, a local date `YYYY-MM-DD`, until the next version.
- The first version has no start date: it is open backwards, so every past point has a price.
- The version in force for an instant is the last one whose start date is on or before the local date of that
  instant (`localDateStr`, the helper the classifier side already uses).
- Two versions cannot share a start date. A start date may be in the future.
- Any version can be edited. A dated version can be deleted. The version without a date cannot be deleted.
- `origin` is free text with a prefix convention: `migration`, `manual` today; a later writer adds its own
  (`file:<supplier>`, `provider:<id>`). Pricing never reads it.

### FR2 — Automatic creation at startup

At startup, when the version table is empty and `energy.tariff` exists with at least one price above 0, Sowel
creates the first version, without a start date, with those prices and `origin: "migration"`. It logs one `info`
line. Nothing else is migrated.

This also covers the restore of a backup taken before this spec: the restore empties the table, the restart
creates the version again from the restored setting.

After that, the `prices` kept inside `energy.tariff` are no longer read.

### FR3 — Every euro priced with the version of its date

- **Points** of `/energy/history` and `/energy/bilan`: each point is priced with the version in force at its
  start.
- **Totals**: the grid-side Wh are summed per version, each group is priced, the groups are added. With one
  version this is today's computation.
- **Year view** (monthly points): a month crossed by a price change is priced from its daily points, per
  version. A month under one version is priced as today.
- **By usage** (`/energy/by-usage` and the Bilan table): each meter is priced point by point, with the price of
  the main meter's point (its € divided by its kWh). The period-blended rate goes.
- **Arbiter gain**: the meter books Wh in peak and off-peak; euros are computed at read time with the version of
  the row's local day. What was booked in euros before this spec stays as booked.
- **EV sessions**: a session is priced at read time, from its stored grid Wh in peak and off-peak, with the
  version in force at its start.
- `/energy/status.tariffConfigured` and the Bilan's `tariffConfigured`: a version in force has a price above 0.
- The Bilan's `prices` field: the version in force on the last day of the period, today for a running period.

Accepted, documented approximations:

- Daily points are UTC days. In month and year views, the first one or two hours of the night of a price change
  are priced with the previous version.
- An EV session that crosses a price change is priced entirely with the version of its start. Its HP/HC split
  stays exact. At most two nights a year.

By usage is the one place where figures change with a single version: a load that runs in off-peak hours is now
priced at the off-peak price instead of the period's average. The Consumption page and the Bilan table then agree.

### FR4 — Contract

The current contract is one setting, `energy.contract`: the supplier (`edf-tarif-bleu` or `other`), the contract
type (`hphc` or `base`) and the subscribed power in kVA. It is what the price file lot will match its rows on.

- Without the setting, the contract reads `other`, `hphc` when the schedule has an off-peak slot and `base`
  otherwise, and the power of the latest version.
- A new price version is pre-filled with the contract's power.
- With a Base contract, the price form asks for one price and stores it as both the peak and the off-peak price,
  so a consumption is priced the same whatever its split. The table shows one price column.
- Changing the contract never changes an existing version.

### FR5 — API

- `GET` / `PUT /api/v1/settings/energy/contract` (admin): `{ supplier, contractType, kva }`.
- `GET /api/v1/settings/energy/tariff/versions` (admin): the versions, oldest first.
- `POST /api/v1/settings/energy/tariff/versions` (admin): add a version. The first version ever created has no
  start date, whatever is sent.
- `PUT /api/v1/settings/energy/tariff/versions/:id` (admin): edit prices, fee, power, and the start date of a
  dated version.
- `DELETE /api/v1/settings/energy/tariff/versions/:id` (admin): delete a dated version.
- `GET /api/v1/settings/energy/tariff`: same shape; `prices` are those of the version in force today.
- `PUT /api/v1/settings/energy/tariff`: `prices` becomes optional. When sent, they edit in place the version in
  force today (today's behaviour for an external client), or create the first version; prices 0/0 with no
  version create nothing, and a price out of range answers `400` before anything is written. The schedule is
  saved as today.

Validation: a real calendar date; prices finite, from 0 to 5 €/kWh; fee 0 or more; power above 0. Errors answer
`400`; a start date already used answers `409`; deleting the version without a date answers `409`.

### FR6 — Settings › Énergie

The card « Tarifs énergie » has three blocks, separated by a rule: « Contrat », « Prix », « Heures pleines et
heures creuses ». The two price fields and the sentence « Ces prix s'appliquent aussi à toute la consommation
passée. » go.

```
Contrat
Fournisseur [EDF, Tarif Bleu (tarif réglementé) ▾]   Type de contrat [Heures creuses ▾]   Puissance souscrite [6 kVA ▾]

Prix
Chaque consommation est valorisée au prix en vigueur à sa date. Prix TTC.

DÉBUT        FIN          HP €/KWH   HC €/KWH   ABONNEMENT    PUISSANCE
01/08/2026   En cours     0,2142     0,1589     190,81 €/an   6 kVA      [modifier] [supprimer]
01/02/2026   31/07/2026   0,2065     0,1578     188,24 €/an   6 kVA      [modifier] [supprimer]
01/08/2025   31/01/2026   0,2081     0,1635     189,99 €/an   6 kVA      [modifier] [supprimer]
…                                                                         (scrolls)
Origine      31/01/2024   0,2460     0,1828     155,97 €/an   6 kVA      [modifier]

[+ Ajouter un changement de prix]
```

- **Contrat**: three selects, saved on change. Suppliers: « EDF, Tarif Bleu (tarif réglementé) », « Autre
  fournisseur ». Types: « Heures creuses », « Base ». Powers: 3, 6, 9, 12, 15, 18, 24, 30, 36 kVA.
- **Prix**: newest first. « Début » is the start date, « Origine » for the version without a date. « Fin » is the
  day before the next version; the last version reads « En cours » in a pill once started, « À venir » before.
- The list shows three versions and scrolls for the others, the column headers staying in place.
- « Ajouter un changement de prix » and « modifier » open the same inline form under the list: « Date de
  début », peak price, off-peak price, fixed fee (€/an, optional), power (kVA, optional), with « La période
  précédente se termine la veille de cette date. ». A new change is pre-filled with the latest version's fee and
  the contract's power. The version without a date has no date field.
- With no version yet, the block shows the form directly, without a date.
- On a phone a version takes three lines (« Depuis le 01/08/2026 », « Du 01/02/2026 au 31/07/2026 »,
  « Jusqu'au 31/01/2024 »; prices; fee and power), the form stacks, and controls are 44 px high.
- The schedule block is unchanged. Its button reads « Enregistrer les horaires » and saves the schedule only.

## Acceptance Criteria

- [ ] After the upgrade of an instance that had prices, one version without a date exists with those prices, and
      history, week, month, year and Bilan figures are unchanged.
- [ ] Adding a version dated in the past changes the cost of the points on and after that date only.
- [ ] A month crossed by a change shows, in the year view, the sum of its days priced on each side.
- [ ] `/energy/history` totals equal the per-version sum; with one version they equal today's totals to the cent
      (test against the current formula).
- [ ] A meter that only runs in off-peak hours is priced at the off-peak price in by usage.
- [ ] The arbiter tile reprices when a version covering its days is edited; rows booked before the upgrade keep
      their euros.
- [ ] An EV session's cost follows the version of its start date; a session before any price reads no cost.
- [ ] The version without a date cannot be deleted; a duplicate start date is refused.
- [ ] An old client calling `PUT /settings/energy/tariff` with `prices` still changes today's prices.
- [ ] Restoring a pre-202 backup and restarting gives one version from the restored setting.
- [ ] The settings card shows the contract and the history with start and end dates, three versions at a time,
      and no sentence about retroactive prices.
- [ ] The contract is saved and read back; a Base contract asks for one price.
- [ ] `tariff_versions` is in the backup.

## Edge Cases

- No tariff at all (fresh install): no version, every cost is 0, `tariffConfigured` is false, as today.
- `energy.tariff` with a schedule and prices 0/0: no version is created; the form creates the first one.
- A point whose start falls before every dated version: the version without a date.
- A version dated in the future: listed, in force from that day, no effect before.
- A version dated today: applies from local midnight of today, including points already shown today.
- Prices 0/0 in a version: its points cost 0; an EV session starting under it reads no cost (null), as today.
- An arbiter row of the upgrade day holds both booked euros (before) and Wh in HP/HC (after): both parts add up.
- DST days and the midnight wrap: unchanged, the date of a point is its local date.
- A year view with a change on the 1st of a month: no month is crossed, no daily read.

## Docs Delta

| Page (EN and FR)                                | Change                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/user/energy.md` + `.fr.md`                | Step 4: prices are a history, how to add a change and correct one. Wh/€ section: the sentence "changing your tariff re-values past consumption" is replaced. By usage: priced point by point. Arbiter gain: priced at read time |
| `docs/technical/api-reference.md` + `.fr.md`    | The four version routes; legacy GET/PUT semantics; `/energy/by-usage` cost rule; `/energy/bilan` `prices`; EV session cost                                                                                                      |
| `docs/technical/architecture.md` + `.fr.md`     | Energy: pricing by version, the two accepted approximations; arbiter gain in Wh                                                                                                                                                 |
| `docs/technical/data-model.md` (no FR copy)     | Table `tariff_versions`; `arbiter_daily_gain.solar_hp_wh` / `solar_hc_wh`; `est_cost_*_eur` no longer written                                                                                                                   |
| `docs/technical/deployment.md` + `.fr.md`       | Rollback: a backup taken after this version does not restore on an older one; use the pre-update backup                                                                                                                         |
| `docs/release-notes.md` + `.fr.md` (at release) | Price history; by usage figures change; rollback through the pre-update backup                                                                                                                                                  |

Screenshots to retake: `energy-tariff-settings-en.png` and its French copy.
