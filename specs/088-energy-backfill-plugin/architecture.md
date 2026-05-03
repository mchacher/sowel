# Spec 088 — Architecture

## Repository / version

- Repository: `sowel-plugin-shelly-mqtt` (existing).
- Version bump: `1.1.0` → `1.2.0`.
- No change to Sowel core.

## File layout (additions)

```
sowel-plugin-shelly-mqtt/
├── src/
│   ├── shelly-plugin.ts         (existing — wire backfill manager into start/stop)
│   ├── shelly-rpc.ts            (NEW — typed HTTP client over EM1Data RPC + mDNS resolution)
│   ├── shelly-rpc.test.ts       (NEW)
│   ├── backfill-manager.ts      (NEW — orchestrates gap detection + replay)
│   ├── backfill-manager.test.ts (NEW)
│   └── index.ts                 (existing — extend settings schema)
└── package.json                 (bump version, add no new runtime deps)
```

## Module responsibilities

### `shelly-rpc.ts`

Thin async client over the Shelly Pro 3EM `EM1Data.*` RPC subset. No
state, no caching — caller decides.

```ts
export interface ShellyRpcClient {
  getRecords(channelId: number): Promise<DataBlock[]>;
  getData(channelId: number, ts: number, endTs: number): Promise<MinuteRecord[]>;
}
export interface DataBlock {
  ts: number;
  period: number;
  records: number;
}
export interface MinuteRecord {
  ts: number;
  totalActEnergy: number; // Wh in that minute
  totalActRetEnergy: number; // Wh in that minute (reverse)
}

export function createShellyRpcClient(opts: {
  hostOverride?: string; // explicit IP / hostname
  sourceDeviceId: string; // used to derive `<sid>.local` if no override
  auth?: { user: string; password: string };
  fetch?: typeof fetch; // injectable for tests
  logger: Logger;
}): ShellyRpcClient;
```

- Pagination: `getData` follows `next_record_ts` until `end_ts` is
  reached or the response omits the field. Returns the flat list of
  `MinuteRecord`s.
- Timeouts: 10s per HTTP call.
- Retries: up to 3 with exponential backoff (250ms / 750ms / 2000ms).
  Beyond that, throw — the caller skips this run.
- HTTP digest auth: only if `auth` is provided AND the first
  unauthenticated call returns 401.

### `backfill-manager.ts`

Owns the lifecycle of the backfill loop. One instance per plugin start.

```ts
export class BackfillManager {
  start(opts: BackfillOptions): void; // schedules boot run + hourly cron
  stop(): void; // clears timers, stops in-flight runs
  // internal:
  private async runForDevice(device: ShellyChannelGroup): Promise<void>;
}

interface BackfillOptions {
  enabled: boolean;
  scanHours: number; // 1..168, validated at parse time
  gapThresholdSec: number; // const = 5*60, not configurable
  channels: ShellyChannelGroup[]; // discovered from `known` set
  rpcFor(deviceId: string): ShellyRpcClient;
  deviceManager: DeviceManager; // for getDeviceDataValue + lastUpdated
  emit: (sid: string, data: Record<string, unknown>, sourceTimestamp: number) => void;
  logger: Logger;
}

interface ShellyChannelGroup {
  sourceDeviceId: string; // Shelly device id, e.g. "shelly-pro3em_00-em0"
  shellyHostId: string; // base id for mDNS, e.g. "shellypro3em-2cbcbbb2cf48"
  channelId: number; // 0, 1, 2 — derived from sourceDeviceId suffix
}
```

Run loop per device (one Pro 3EM = up to 3 channels sharing a host):

1. Read `device_data.lastUpdated` for `energy_forward` of each channel.
   Take the **oldest** across the channels — that's our recovery
   anchor. Rationale: if any channel is stale, we want to refresh all
   of them on the same window (bookkeeping simpler, no skew).
2. If `now - oldest < gapThreshold` → no-op, log debug.
3. `windowStart = max(oldest, now - scanHours * 3600)`.
4. Query `EM1Data.GetRecords` for channel 0; pick `data_blocks` that
   intersect `[windowStart, now]`. Same query repeated per channel
   (channel 0/1/2 may have different blocks, but on a Pro 3EM they
   typically match — we still query each independently).
5. For each intersecting block, fetch records via `EM1Data.GetData`,
   per channel, with pagination.
6. Merge per-channel results into a chronological stream of
   `(channelId, MinuteRecord)` interleaved minute by minute:
   `(0, T) → (1, T) → (2, T) → (0, T+1) → ...`.
7. Update each channel's `lastCumul` baseline to the LAST record's
   `total_act_energy` / `total_act_ret_energy` so the live MQTT loop
   doesn't re-emit a duplicate delta on its next tick.
8. For each `(channelId, record)` in order, call `emit(...)` with:
   - `energy_forward = record.totalActEnergy + cumulativeBefore` — but
     we don't actually have this. So we emit the _delta_ mode: the
     plugin already converts cumul to delta in the live path. For
     replay we already have minute deltas → we emit them DIRECTLY as
     `energy = (fwd - rev)`, plus the absolute `energy_forward` /
     `energy_reverse` reconstructed by walking forward from the last
     known cumul before the window.
9. Log one info per device with `{ channelId, recordsWritten,
windowStart, windowEnd }`.

#### Cumul reconstruction

The Shelly archive returns _deltas per minute_, not cumuls. But the
plugin's contract with Sowel is:

- `energy` = signed minute delta (Wh)
- `energy_forward` = monotonic cumulative Wh (forward)
- `energy_reverse` = monotonic cumulative Wh (reverse)

To stay consistent the backfill must reconstruct the cumuls. Algorithm
per channel:

1. Read `cumulFwdBefore = device_data["energy_forward"]` (last known
   value before the window — what the plugin itself last persisted).
2. Same for reverse.
3. Sort backfill records ascending. For each minute:
   - `cumulFwd_i = cumulFwdBefore + Σ totalActEnergy[0..i]`
   - `cumulRev_i = cumulRevBefore + Σ totalActRetEnergy[0..i]`
   - `energy_i  = totalActEnergy[i] - totalActRetEnergy[i]`
   - emit `{ energy_forward: cumulFwd_i, energy_reverse: cumulRev_i, energy: energy_i }`
     with `sourceTimestamp = ts_i`.
4. After the last record, `lastCumul` is updated in-memory to the final
   reconstructed cumul. The very next live MQTT tick will compute
   `delta = currentDeviceCumul - lastCumul` — which equals exactly the
   amount of energy consumed _between the last archive record and
   live_, typically a few seconds.

This keeps the cumul series monotonic and free of regressions, which
the EnergyAggregator and downsample tasks all assume.

### `index.ts` changes

- Add to `getSettingsSchema()`:
  - `{ key: "backfill_enabled", label: "Enable historical backfill", type: "boolean", required: false, defaultValue: "true" }`
  - `{ key: "backfill_hours", label: "Backfill window (hours)", type: "number", required: false, defaultValue: "24", min: 1, max: 168 }`
- In `start()` after `engine.start()`:
  - Read `backfill_enabled` (default `true`).
  - If enabled, instantiate `BackfillManager`, call `start()`.
- In `stop()`: call `backfillManager.stop()` first, then existing
  cleanup. Backfill must finish or abort cleanly before MQTT
  disconnect.

### `shelly-plugin.ts` changes

Minimal:

- Expose a `getKnownChannelGroups()` accessor so `BackfillManager` can
  iterate the Shelly channels currently known.
- Expose a `setLastCumul(sid, baseline)` so backfill can update the
  in-memory baseline after a replay (avoids the next live tick double-
  counting).
- Widen the local `DeviceManager` interface to accept the optional 4th
  `sourceTimestamp` parameter on `updateDeviceData` (Sowel core already
  supports it since v1.5.1, just not declared in the plugin's mirror).

## Event flow

```
Plugin start
  ├─ engine.start(topicFilter)              [existing]
  └─ backfillManager.start({...})
       └─ runForDevice(channelGroup)         [for each known device]
            ├─ read device_data.lastUpdated  [DeviceManager]
            ├─ if gap > 5min:
            │    ├─ rpc.getRecords(0,1,2)    [Shelly HTTP]
            │    ├─ rpc.getData(0/1/2,...)   [Shelly HTTP, paginated]
            │    ├─ for each interleaved minute:
            │    │   deviceManager.updateDeviceData(
            │    │     id, sid,
            │    │     { energy_forward, energy_reverse, energy },
            │    │     sourceTimestamp = ts )
            │    │       ↓ (Sowel pipeline, unchanged)
            │    │       device.data.updated → equipment.data.changed → HistoryWriter
            │    │                                                   → TariffClassifier
            │    │                                                   → SelfConsumptionWriter
            │    │                                                   → InfluxDB raw bucket
            │    └─ engine.setLastCumul(sid, finalBaseline)
            └─ schedule next run in 1h
```

## Persistence / state

- No new SQLite table, no new migration.
- `lastCumul` stays in plugin memory (already the case).
- `device_data` writes go through the existing `updateDeviceData` path
  → SQLite + Influx via HistoryWriter.

## Configuration discovery

The plugin learns Shelly devices via MQTT announces. The
`sourceDeviceId` for a Pro 3EM channel is `shelly-pro3em_00-em0`,
`shelly-pro3em_00-em1`, `shelly-pro3em_00-em2`. The Shelly host id is
the second token of the MQTT `src` field on `events/rpc` topics — e.g.
`shellypro3em-2cbcbbb2cf48`. We extract it on first sight and remember
it, mapped to the host (or override if set in settings).

## Failure modes

| Failure                      | Behaviour                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| mDNS resolution fails        | Log warn, skip this run, retry on next hourly tick.                                                                |
| HTTP RPC times out / 5xx     | Retry 3 times with backoff. Beyond that: skip.                                                                     |
| HTTP 401 (auth required)     | Read `shelly_auth_*`. If empty → log error and skip.                                                               |
| Window is empty in archive   | Treat as real gap (Shelly was off too). Log warn, no write.                                                        |
| Plugin stops mid-replay      | Abort the in-flight loop; partial state in Influx is OK because writes are idempotent on retry.                    |
| `lastCumul` is null at start | Fallback: skip backfill on first ever run; let `ensureBaseline` initialise from device_data on the next live tick. |

## What is NOT changed

- Live MQTT path (`handleEm1Status`, `handleEm1DataStatus`,
  `ensureBaseline`).
- Sowel core: HistoryWriter, TariffClassifier, SelfConsumptionWriter,
  EnergyAggregator. They all already accept `sourceTimestamp` and
  upsert by tag-set+timestamp.
- Plugin API contract — backfill consumes only what Sowel v1.5.1
  already exposes (`updateDeviceData(... sourceTimestamp)` and
  `getDeviceDataValue`).
