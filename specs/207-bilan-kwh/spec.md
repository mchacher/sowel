# Spec 207 — Consumption in kWh on the Bilan

## Context

The Bilan (Energy › Costs, spec 200; fee and price spans added by spec 205) speaks only in euros. Since spec 202
prices change over time, so a comparison in euros mixes two effects: how much was consumed and what each kWh
cost. The maintainer asked (2026-11-11, issue #1232) for the consumption in kWh on the same page, and validated a
mockup: https://claude.ai/artifact/FB9meshgVsd2XJ7mqNPi2u (boards `Main`, desktop month, and `Phone`).

## Goals

1. The bill card shows what is paid, in euros, on the left, and what is consumed, in kWh, on the right; no line
   mixes the two units.
2. Every comparison the card makes in euros has a kWh counterpart.
3. The average price paid per kWh bought from the grid is stated.

## Non-Goals

- The chart stays in euros (the Consumption page shows kWh); no euro / kWh switch.
- The by-usage table is unchanged (its kWh column exists; its header case is #1231).
- No change to how anything is measured or priced.

## Functional Requirements

### FR1 — Data

The Bilan response gains `energy`:

- `gridHpWh`, `gridHcWh`: kWh bought from the grid at peak and off-peak, the same figures as the
  `/energy/history` totals (`total_hp`, `total_hc`);
- `solarWh`: self-consumed solar, each point clamped to its consumption (`min(autoconso, hp + hc)`, so a meter
  skew never counts more solar than the house used);
- `consumedWh`: grid plus `solarWh`.

Each comparison kind gains its kWh counterpart, on grid kWh, the figure the euro comparison compares:

- `days`: `averageGridWh` (average per day over the same days as `averageBill`);
- `month`: `projectedGridWh` (same pace rule as `projectedBill`, null when it is null), `previousYearGridWh`
  (null when `previousYearBill` is) and `comparable` (both months have data on all days but two, the year view's
  rule; the kWh line carries a percent only then);
- `year`: `gridWh` and `previousYearGridWh` over the same comparable months as `bill` / `previousYearBill`.

### FR2 — Bill card, left (euros)

Unchanged from v1.85.0: the headline, the HP / HC split, the subscription and the total, the euro comparison and
« Comparaison sur la consommation seule. ».

**Amended after v1.86.0 (mirrored columns).** The euro column takes the shape of the kWh column: under the
headline, a thin bar split into peak and off-peak euros, the two amounts as label over value (the same short
labels and column count as the kWh parts), then the average price paid (moved from the kWh box, see FR3). From
`lg` the two columns share the card's seven rows (label, figure, bar, parts, sentence, subscription,
comparison) through a CSS subgrid, so each row starts at the same height on both sides, and the vertical rule
between them is straight (the columns are cards only below `lg`). Chosen from a to-scale mockup, option C:
https://claude.ai/artifact/GtvgJMkFYntXMVMZwhjLgK.

### FR3 — Bill card, right (kWh)

Replaces the « Électricité consommée, en euros » block and its paid / avoided bar:

- the label « Électricité consommée » with the period (« en octobre », « le 10 novembre », « en 2026 ») and the
  total `consumedWh` in display size;
- a thin bar in three parts, in the chart colours: peak from the grid, off-peak from the grid, solar consumed on
  site; below it one legend item per part with its kWh;
- « {grid} kWh achetés au réseau, {solar} kWh produits et consommés sur place ({share} %). »;
- a comparison box in kWh, built like the euro one: « Octobre 2025 : 1 036 kWh achetés (- 32 %). », the month's
  pace (« Au même rythme, novembre consommera environ 1 120 kWh achetés. »), the 7-day average, the year's
  comparable months;
- in the same box, « Prix moyen payé : 0,194 €/kWh, 0,223 €/kWh avec l'abonnement. » (bill / grid kWh, and
  bill + fee / grid kWh; the second part only when a fee is shown and no counted day lacks one; nothing without
  grid kWh). Amended after v1.86.0: this line moved to the euro column, under its parts (FR2); the kWh box keeps
  the comparison only.

Without production the solar part, its legend item and the second half of the sentence are left out: the bar
has the two grid parts and the total is the grid kWh.

### FR4 — Solar savings tile

Takes the sentence of the removed block: « Sans panneaux, la facture aurait été de 178,62 €. » (EN « Without
panels, the bill would have been … »). The kWh caption it had (« 214 kWh produits et consommés sur place ») moves
to the kWh column.

### FR5 — Phone

The bill card becomes two cards stacked, euros first, then kWh, as in the `Phone` board. From `lg` up they are
the two columns of one card, separated by a vertical rule.

## Acceptance Criteria

- [x] The response carries `energy` and the kWh counterparts; `gridHpWh + gridHcWh` equals the history totals.
- [x] October 2026 on the shadow: 920 kWh consumed, 446 / 260 / 214, 706 bought, - 32 % against 1 036 kWh, average
      0,194 and 0,223 €/kWh.
- [x] Day, month and year views each show the kWh comparison of their kind.
- [x] Without production: two-part bar, no solar wording.
- [x] The headline, the euro comparison, the chart and the by-usage figures are unchanged.

## Edge Cases

- A period with no grid kWh (all solar, or no data): no average price; the bar shows what there is.
- Rounding: kWh shown to the unit from 100 kWh, to one decimal below (`formatWh` as elsewhere on the page); the
  share rounded to the percent.
- The previous year had no data: no kWh comparison line, like the euro one.

## Docs Delta

| Page (EN and FR)                             | Change                                                       |
| -------------------------------------------- | ------------------------------------------------------------ |
| `docs/user/energy.md` + `.fr.md`             | Bilan: the kWh column, the kWh comparison, the average price |
| `docs/technical/api-reference.md` + `.fr.md` | `/energy/bilan`: `energy` and the kWh fields of `comparison` |

Screenshots: no doc screenshot shows the Bilan.
