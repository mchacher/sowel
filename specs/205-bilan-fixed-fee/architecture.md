# Architecture — Spec 205

## Types

```ts
// src/shared/types.ts
export interface BilanFee {
  /** € over the days counted (unrounded). */
  total: number;
  /** Local days counted, from the period start to min(period end, today). */
  days: number;
  /** Days among them whose version has no fee. */
  daysWithoutFee: number;
  /** Power of the version in force on the last day counted, null when unknown. */
  kva: number | null;
}

export interface BilanPriceSpan {
  /** First and last local day the version covers inside the period, "YYYY-MM-DD". */
  from: string;
  to: string;
  hp: number;
  hc: number;
  fixedFeeYear: number | null;
  kva: number | null;
}

export interface EnergyBilanResponse {
  // …existing fields
  /** Null on the day view, and when no counted day has a fee. */
  fee: BilanFee | null;
  /** Versions in force over the period, oldest first; one entry when nothing changes. */
  priceSpans: BilanPriceSpan[];
}
```

`prices` stays (the version on the last day), for compatibility.

## Pure functions

`src/energy/pricing.ts` (next to `versionOn`):

```ts
/** The versions covering [fromDay, toDay], each clamped to it (spec 205). */
export function priceSpans(versions: TariffVersion[], fromDay: string, toDay: string): BilanPriceSpan[];
/** The prorated fee of [fromDay, countUntilDay] (spec 205 FR1); null when nothing counted has a fee. */
export function periodFee(versions: TariffVersion[], fromDay: string, countUntilDay: string): BilanFee | null;
```

Days are iterated as local calendar strings (`YYYY-MM-DD` + 1 day through `Date` at noon), so DST never skips
or doubles a day. Year length: 366 when the year is a leap year.

## Route

`/api/v1/energy/bilan`: `fromDay`, `toDay` already computed for the arbiter; `countUntil = min(toDay, today)`;
`fee = period === "day" || fromDay > today ? null : periodFee(…)`; `priceSpans(versions, fromDay, toDay)`;
both passed through `computeBilan` into the response.

## UI

- `ui/src/types.ts`: the two types, the fields.
- `ui/src/components/energy/bilan-format.ts`: `feeLines(fee, …)` and `methodSpans(spans, …)` (pure, tested).
- `BilanPage.tsx`: the fee block in `BillCard`; `MethodText` lists the spans.
- `BilanChart.tsx`: a recharts `ReferenceLine` (dashed, `--color-text-tertiary`) at the bucket of each span
  start after the first; the bucket key is the day (month view) or the month (year view).
- Strings EN and FR.

## Files

| File                                               | Change                          |
| -------------------------------------------------- | ------------------------------- |
| `src/shared/types.ts`                              | `BilanFee`, `BilanPriceSpan`    |
| `src/energy/pricing.ts` (+ test)                   | `priceSpans`, `periodFee`       |
| `src/energy/bilan.ts` (+ test)                     | pass-through in `computeBilan`  |
| `src/api/routes/energy.ts` (+ test)                | the route                       |
| `ui/src/types.ts`                                  | types                           |
| `ui/src/components/energy/bilan-format.ts` (+ test) | `feeLines`, `methodSpans`      |
| `ui/src/components/energy/BilanPage.tsx` (+ test)  | fee block, method card          |
| `ui/src/components/energy/BilanChart.tsx`          | markers                         |
| `ui/src/i18n/locales/{en,fr}.json`                 | strings                         |
