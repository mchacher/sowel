# Spec 119 — Architecture

## Type changes

### `src/shared/types.ts`

```ts
export interface EnergyHistoryResponse {
  period: string;
  from: string;
  to: string;
  resolution: "5min" | "1h" | "1d" | "1mo"; // ← add "1mo"
  points: EnergyPoint[];
  totals: EnergyTotals;
}
```

`EnergyPoint` itself is unchanged. `EnergyTotals` is unchanged.

### `src/api/routes/energy.ts`

The `computeRange()` local function returns the same shape, with the
resolution literal extended:

```ts
function computeRange(
  period,
  dateStr,
  baseBucket,
): {
  from: Date;
  to: Date;
  resolution: "5min" | "1h" | "1d" | "1mo"; // ← extend
  bucket: string;
};
```

### `ui/src/types.ts`

Mirror the resolution literal extension. UI code does not currently
read `resolution` for control flow, only stores it as a label.

## `computeRange()` behaviour change

The route handler already calls `computeRange(period, dateStr,
config.bucket)` to pick the InfluxDB bucket and target resolution.
After this spec:

| period | from / to                                | resolution | bucket                  |
| ------ | ---------------------------------------- | ---------- | ----------------------- |
| day    | local 00:00 → next 00:00                 | `"1h"`     | raw OR `-energy-hourly` |
| week   | local Monday 00:00 → next Monday 00:00   | `"1d"`     | `-energy-hourly`        |
| month  | local 1st 00:00 → next 1st 00:00         | `"1d"`     | `-energy-daily`         |
| year   | local Jan 1st 00:00 → next Jan 1st 00:00 | `"1mo"`    | `-energy-daily`         |

The `from`/`to` dates are constructed in **server TZ** (already the case
today via `new Date("…T00:00:00")` — that constructor uses the local
TZ of the Node process, which is `Europe/Paris` per the deployment
TZ env).

## Influx query changes

The four query helpers (`queryEnergyHpHcPoints`,
`queryEnergyLegacyPoints`, `queryProductionPoints`,
`querySubmeterPoints`) currently follow this template:

```ts
const needsAggregation = resolution === "1h" && !bucket.includes("-energy-");
const flux = needsAggregation
  ? `… |> aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start") |> sort(columns: ["_time"])`
  : `… |> sort(columns: ["_time"])`;
```

### Generalised template

```ts
// resolution → Flux duration string + always-aggregate-with-location
const EVERY: Record<Resolution, string> = {
  "5min": "5m",
  "1h": "1h",
  "1d": "1d",
  "1mo": "1mo",
};

const tzImport = `import "timezone"`;
const locationExpr = `timezone.location(name: "${getServerTz()}")`;

const flux = `${tzImport}
  from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => ${filterExpr})
  |> aggregateWindow(
       every: ${EVERY[resolution]},
       fn: sum,
       createEmpty: true,                    // ← was false
       location: ${locationExpr},            // ← new (TZ-aware bucketing)
       timeSrc: "_start"
     )
  |> sort(columns: ["_time"])`;
```

Two semantic changes:

1. `createEmpty: true` — buckets with no data return a row with
   `_value = null` (treated as 0 downstream). Required so the
   response always has N points.
2. `location: timezone.location(name: TZ)` — buckets align on the
   server's local-TZ midnight / month start, not UTC. Required for
   week / month / year correctness.

### Aggregation gating

Today's `needsAggregation = "1h" && !bucket.includes("-energy-")`
condition only triggered for the day-on-raw-bucket case. The new
template **always aggregates** (or rather, always calls
`aggregateWindow`). For buckets already pre-aggregated to the right
resolution (`-energy-hourly` queried at `1h`, `-energy-daily` queried
at `1d`), the call is a no-op pass-through — Flux is smart enough to
skip the aggregation when bucket granularity already matches.

For the `1mo` case on `-energy-daily`, Flux genuinely aggregates 30
daily rows into one monthly row.

## Server TZ resolution

```ts
function getServerTz(): string {
  return process.env.TZ ?? "Europe/Paris";
}
```

Logged once at startup (info level) from the energy route registration
so an operator can verify the TZ matches the household. A wrong TZ
shifts every bucket by ±1 day silently — worth surfacing.

## Empty-bucket post-processing

After Flux returns rows with `_value = null` for empty buckets, the
existing point-merge code in the route handler treats `null` as 0:

```ts
const hp = hpMap.get(time) ?? 0;
const hc = hcMap.get(time) ?? 0;
const prodData = prodMap.get(time);
const prod = prodData?.prod ?? 0;
// …
```

Already does the right thing. The new bit: we must **iterate the
expected bucket times** (computed from `from` / `to` / resolution)
rather than `new Set([...consumptionPoints.map(p => p.time), ...])`,
so that purely-empty periods (no consumption, no production) still
produce N rows.

```ts
function expectedBucketTimes(from: Date, to: Date, resolution: Resolution): string[] {
  // walk from `from` to `to` by resolution step, in local TZ,
  // return each step's UTC ISO string
}
```

The `if (hp + hc > 0 || prod > 0)` gate that currently drops empty
points is **removed**. Every expected bucket is pushed.

## File-by-file changes

| File                              | Change                                                      |
| --------------------------------- | ----------------------------------------------------------- |
| `src/shared/types.ts`             | extend `EnergyHistoryResponse.resolution` literal           |
| `ui/src/types.ts`                 | mirror the literal extension                                |
| `src/api/routes/energy.ts`        | `computeRange` per-period table + 4 query helpers + handler |
| `src/api/routes/energy.test.ts`   | **new** — bucket count, TZ alignment, HP/HC preservation    |
| `docs/technical/api-reference.md` | update the `/energy/history` + `/energy/by-usage` sections  |

## Backwards compatibility

| Consumer                                            | Pre-spec-119                      | Post-spec-119                                         |
| --------------------------------------------------- | --------------------------------- | ----------------------------------------------------- |
| Web UI `EnergyBarChart.tsx` aggregateDay            | sums 1 point per hour, 24 buckets | sums 1 point per hour, 24 buckets (same)              |
| Web UI aggregateWeek                                | sums 24h per day, 7 buckets       | sums 1 point per day, 7 buckets (no behaviour change) |
| Web UI aggregateMonth                               | sums 1 point per day              | sums 1 point per day (no change)                      |
| Web UI aggregateYear                                | sums ~30d per month, 12 buckets   | sums 1 point per month, 12 buckets                    |
| Firmware iter 024 (current today screen)            | reads `points[]` as hourly        | still reads as hourly (`?period=day` only)            |
| Firmware iter 034 (period switch — depends on this) | not shipped                       | reads N buckets per period directly                   |
| External integrations (if any)                      | accept sparse points              | now always N points (empties have hp=hc=…=0)          |

The "empties now returned" change is the only one observable by an
external integration: previously absent buckets show up with zeroes.
Any integration that filtered points by `hp + hc > 0` keeps doing
the right thing client-side; integrations that didn't will now see
clearly-empty rows instead of missing rows. Not a wire-format break.

## Event-bus / WebSocket impact

None. The energy history endpoints are pull-only REST. No event
bus subscribers consume `EnergyHistoryResponse`.
