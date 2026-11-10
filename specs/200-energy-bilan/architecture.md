# Architecture — Spec 200

## Flow

```
/energy/bilan (UI)
  └─ GET /api/v1/energy/bilan?period&date
       ├─ loadEnergyPoints(range)           ← extracted from /energy/history (unchanged output)
       │    period points + totals (bill)
       ├─ loadEnergyPoints(reference range)  ← 7 previous days | same month y-1 | year y-1
       ├─ loadUsagePartition(range)          ← extracted from /energy/by-usage (unchanged output)
       ├─ arbiterGainStore.range(days) + arbiterGainMeter.pending()
       └─ computeBilan(...)                  ← pure, src/energy/bilan.ts

ArbiterGainMeter (every 60 s)
  capacityArbiter.getPublicState()  → granted loads' watts, availableSurplusW
  tariffClassifier.classify(Wh, start, dt) + prices → €
  in-memory (day, equipmentId) accumulators
  every 15 min / on stop → ArbiterGainStore.add(rows)  (one transaction)
```

The arbiter is not modified: the meter reads its public state, like the UI does. It never writes to it and never throws into it.

## Components

### New: `src/energy/bilan.ts` (pure)

```ts
export function splitPoint(p: EnergyPoint): {
  paidHp: number;
  paidHc: number;
  avoided: number;
  share: number;
  rate: number;
};
//  conso = hp + hc; share = conso > 0 ? min(1, autoconso / conso) : 0
//  rate  = conso > 0 ? cost_total * 1000 / conso : 0      (€/kWh)
//  paidHp = cost_hp * (1 - share); paidHc = cost_hc * (1 - share)
//  avoided = autoconso * rate / 1000 (capped at the point's cost)

export function billOf(points: EnergyPoint[]): number; // Σ paidHp + paidHc
export function dayComparison(
  prevDays: EnergyPoint[],
): { days: number; averageBill: number } | null;
export function monthComparison(
  bill,
  from,
  to,
  now,
  prevYearPoints,
): { projectedBill: number | null; previousYearBill: number | null };
export function yearComparison(
  points,
  prevYearPoints,
  to,
  now,
): { months: string[]; bill: number; previousYearBill: number } | null;
export function usageRows(partition, points): BilanUsageRow[]; // per point: wh × (1 − share) × rate, wh × share × rate
export function arbiterTile(rows, since, from, to): BilanArbiter;
export function computeBilan(input): EnergyBilanResponse;
```

All money rounded to 4 decimals at the end, like `round4` in spec 123.

### New: `src/energy/arbiter-gain-meter.ts`

```ts
export class ArbiterGainMeter {
  constructor(deps: {
    arbiter: Pick<CapacityArbiter, "getPublicState">;
    tariff: TariffClassifier;
    store: ArbiterGainStore;
    settings: SettingsManager;
    logger: Logger;
    now?: () => number;
  });
  start(): void; // 60 s sample timer + 15 min flush timer
  stop(): void; // clears timers, flushes
  sample(): void; // one tick, public for tests; never throws
  flush(): void; // never throws
  pending(fromDay: string, toDay: string): ArbiterGainRow[]; // unflushed rows
}
```

Sample: skip and forget the previous instant when `!enabled` or `availableSurplusW === null`. Otherwise `dt = min(now − last, 120 s)` (first sample books nothing), granted = `loads.filter(l => l.state === "granted" && (l.watts ?? 0) > 0)`, `D = Σ watts`, `I = max(0, −availableSurplusW)`, `S = max(0, D − I)`, each load `wh = S × w / D × dt / 3600`, `split = classify(wh, (now − dt)/1000, dt/1000)`, € = Wh × the HP/HC proportions of the window × the prices (the classifier rounds to whole Wh, so it is asked for proportions on a large nominal). Day key = local date of the sample start. `since` written once to `energy.arbiterGain.since` (local date) the first time a sample runs with the arbiter enabled.

### New: `src/energy/arbiter-gain-store.ts`

Same never-throw contract as `ArbiterMetricsStore`.

```ts
add(rows: ArbiterGainRow[]): void;   // one transaction, INSERT … ON CONFLICT(day, equipment_id) DO UPDATE SET solar_wh = solar_wh + excluded.solar_wh, avoided_eur = avoided_eur + excluded.avoided_eur
range(fromDay: string, toDay: string): ArbiterGainRow[];   // inclusive, local YYYY-MM-DD
```

### New migration `migrations/043_arbiter_daily_gain.sql`

```sql
CREATE TABLE IF NOT EXISTS arbiter_daily_gain (
  day          TEXT NOT NULL,     -- local YYYY-MM-DD
  equipment_id TEXT NOT NULL,     -- no FK: a removed load keeps its history
  solar_wh     REAL NOT NULL,
  avoided_eur  REAL NOT NULL,
  PRIMARY KEY (day, equipment_id)
);
```

No retention purge: about five rows a day. Added to `BACKUP_TABLES` (no FK, any position).

### Changed: `src/api/routes/energy.ts`

- The body of `/energy/history` that builds `points` from a range is extracted into `loadEnergyPoints(ctx, from, to, resolution, buckets)`; the route calls it. Output unchanged (existing tests guard it).
- The partition part of `/energy/by-usage` (submeters minus children, "other") is extracted into `loadUsagePartition(ctx, from, to, resolution, buckets)`; the route calls it. Output unchanged.
- New route `GET /api/v1/energy/bilan`. Ranges: the period from `computeRange`; day reference = the 7 local days before `date`, 1 d resolution on the hourly energy bucket; month reference = same month y−1 on the daily bucket; year reference = year y−1 at 1 mo.
- `EnergyDeps` gains `arbiterGainStore` and `arbiterGainMeter` (optional, like `arbiterMetricsStore`).

### Changed: `src/index.ts`

Build the store and the meter next to the arbiter metrics, `start()` after the arbiter, `stop()` in graceful shutdown before the DB closes.

### Changed: `src/backup/backup-manager.ts`

`"arbiter_daily_gain"` in `BACKUP_TABLES`.

## Types (`src/shared/types.ts`, mirrored in `ui/src/types.ts`)

```ts
export type BilanPeriod = "day" | "month" | "year";

export interface BilanPoint {
  time: string;
  paidHp: number;
  paidHc: number;
  avoided: number;
  previousYearBill?: number | null;
}

export type BilanComparison =
  | { kind: "days"; days: number; averageBill: number }
  | { kind: "month"; projectedBill: number | null; previousYearBill: number | null }
  | { kind: "year"; months: string[]; bill: number; previousYearBill: number }; // months: "YYYY-MM"

export interface BilanUsageRow {
  id: string | null;
  name: string;
  colorIndex: number | null;
  wh: number;
  paid: number;
  avoided: number;
}

export interface BilanArbiter {
  enabled: boolean;
  since: string | null; // local YYYY-MM-DD
  measured: "none" | "partial" | "full";
  solarWh: number;
  avoided: number;
  loads: Array<{ equipmentId: string; name: string | null; solarWh: number; avoided: number }>; // sorted by avoided desc
}

export interface EnergyBilanResponse {
  period: BilanPeriod;
  from: string;
  to: string;
  resolution: "1h" | "1d" | "1mo";
  tariffConfigured: boolean;
  hasProduction: boolean;
  bill: { total: number; hp: number; hc: number };
  avoided: number;
  selfConsumedWh: number;
  points: BilanPoint[];
  comparison: BilanComparison | null;
  usage: BilanUsageRow[]; // [] without sub-meters
  arbiter: BilanArbiter;
}
```

## UI

| File                                                                           | Change                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `ui/src/components/energy/BilanPage.tsx` (new)                                 | Page: header + selector, bill card, tiles, chart, usage, method                |
| `ui/src/components/energy/BilanChart.tsx` (new)                                | Recharts stacked bars + previous-year ticks (Scatter with a dashed-line shape) |
| `ui/src/components/energy/bilan-format.ts` (new)                               | Labels and sentences of FR2/FR3/FR5 from the response (pure, tested)           |
| `ui/src/components/PeriodSelector.tsx`                                         | Optional `periods` prop (defaults to the four)                                 |
| `ui/src/components/energy/PeriodSelector.tsx`                                  | Passes `periods` through                                                       |
| `ui/src/App.tsx`                                                               | Route `/energy/bilan`                                                          |
| `ui/src/components/layout/Sidebar.tsx`, `EnergyMobileNav.tsx`, `AppLayout.tsx` | Entry after En direct (Lucide `Wallet`), page title                            |
| `ui/src/api.ts`, `ui/src/types.ts`                                             | `getEnergyBilan(period, date)`, types                                          |
| `ui/src/i18n/locales/{en,fr}.json`                                             | `nav.energy.bilan`, `energy.bilan.*`                                           |

Tokens: cards `card`, bill `text-value`, tiles `text-display`, solar figures `text-solar-ink`, chart fills from the energy CSS variables, previous-year tick `text-tertiary` dashed. Phone: tiles two up, usage as rows, method card folded (`<details>`).
