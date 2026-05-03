# Spec 088 — Implementation Plan

## Implementation order

Strict order — each step must compile + tests pass before moving to the
next:

1. **`shelly-rpc.ts`** + tests — typed RPC client, pure I/O, easy to
   mock.
2. **Plugin types/interfaces** — widen the local `DeviceManager`
   interface in `shelly-plugin.ts` to accept `sourceTimestamp` on
   `updateDeviceData`. Add `getKnownChannelGroups()` and
   `setLastCumul()` accessors on `ShellyEngine`. No behaviour change
   yet, ensures green build before adding orchestration.
3. **`backfill-manager.ts`** + tests — the orchestration logic; pure
   in-memory, mocks the RPC client and DeviceManager.
4. **Wire into `index.ts`** — settings schema additions, start/stop
   lifecycle integration. Tested manually + integration test.
5. **Bump `package.json`** to 1.2.0, README update.

## Tasks

- [ ] T1. Write `shelly-rpc.ts`:
  - [ ] `createShellyRpcClient(opts)` returns `ShellyRpcClient`
  - [ ] `getRecords(channelId)` → `DataBlock[]`
  - [ ] `getData(channelId, ts, endTs)` → `MinuteRecord[]` with
        pagination via `next_record_ts`
  - [ ] Timeout (10s), retry x3 with exponential backoff
  - [ ] Optional digest auth wrapper
  - [ ] Injectable `fetch` for tests
- [ ] T2. Write `shelly-rpc.test.ts` (use Vitest fetch mocks).
- [ ] T3. Update `shelly-plugin.ts`:
  - [ ] Widen `DeviceManager` local interface (4th param)
  - [ ] Add `getKnownChannelGroups(): ShellyChannelGroup[]`
  - [ ] Add `setLastCumul(sid, baseline)`
  - [ ] Track `shellyHostId` in the `known` set when discovered (extend
        the parser/dispatcher to capture the hostId from the `src`
        field on `events/rpc` topics)
- [ ] T4. Write `backfill-manager.ts`:
  - [ ] Constructor + `start({...opts})` schedules boot run + setInterval
  - [ ] `stop()` clears timers, awaits any in-flight run (best effort)
  - [ ] `runForDevice(channelGroup)` implements the algorithm in
        architecture.md
  - [ ] Cumul reconstruction logic
  - [ ] Channel-interleaved emission
  - [ ] All structured logging via the injected logger
- [ ] T5. Write `backfill-manager.test.ts`.
- [ ] T6. Wire into `index.ts`:
  - [ ] Add 2 new settings to schema (`backfill_enabled`,
        `backfill_hours`)
  - [ ] Optional setting `shelly_host_<sid>` documented but not
        validated in schema (free-form key)
  - [ ] Auth settings (`shelly_auth_user`, `shelly_auth_password`)
  - [ ] In `start()`: instantiate + start BackfillManager when enabled
  - [ ] In `stop()`: stop BackfillManager first
- [ ] T7. Bump version 1.1.0 → 1.2.0.
- [ ] T8. Update plugin README with the new settings + brief operation
      description.
- [ ] T9. Manual production validation:
  - [ ] Stop Sowel for ≥ 10 min with the plugin running before stop
  - [ ] Restart Sowel, watch logs for `backfill: gap detected (...) → fetched X records, wrote Y points`
  - [ ] Check Influx raw bucket for points at the exact gap timestamps
  - [ ] Trigger the hourly downsample task; verify charts fill in
- [ ] T10. Update `specs-index.md` status to `Active`.

## Test Plan

### Modules to test

- `shelly-rpc.ts` — RPC client with pagination, retries, timeouts.
- `backfill-manager.ts` — gap detection, scheduling, channel
  interleaving, cumul reconstruction.

No tests on `index.ts` — that's wiring only and is exercised by the
manual validation in T9.

### Scenarios

| Module             | Scenario                                                | Expected                                                                           |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shelly-rpc`       | `getRecords` happy path                                 | Returns `DataBlock[]` parsed from response                                         |
| `shelly-rpc`       | `getData` single page (no `next_record_ts`)             | Returns single batch, decoded by index from `keys`                                 |
| `shelly-rpc`       | `getData` paginated (3 pages)                           | Calls fetch 3 times, returns concatenated chronological list                       |
| `shelly-rpc`       | HTTP 500 on first call, success on retry                | Retries with backoff, returns success                                              |
| `shelly-rpc`       | HTTP 401 with auth provided                             | Re-issues with digest header                                                       |
| `shelly-rpc`       | HTTP 401 with no auth set                               | Throws auth error, no further retries                                              |
| `shelly-rpc`       | All 3 retries exhausted                                 | Throws after 3 attempts                                                            |
| `shelly-rpc`       | Timeout exceeds 10s                                     | AbortController fires, retry path                                                  |
| `backfill-manager` | No channels known yet                                   | `start()` is no-op, `stop()` is safe                                               |
| `backfill-manager` | `lastUpdated` < 5 min ago                               | No backfill, debug log only, RPC client never called                               |
| `backfill-manager` | `lastUpdated` 30 min ago, archive holds the full window | RPC `getRecords` + `getData` called, all 30 minutes emitted via `updateDeviceData` |
| `backfill-manager` | Gap is 24h, scan window is 24h                          | Full 24h × 60 records replayed                                                     |
| `backfill-manager` | Gap is 90d but `backfill_hours = 24` (default)          | Only the last 24h replayed (window clamped)                                        |
| `backfill-manager` | `data_blocks` has a hole within the requested window    | Skips the missing block, logs warn, replays the available blocks                   |
| `backfill-manager` | Channel-interleaved emission                            | Order is `(c0,T)→(c1,T)→(c2,T)→(c0,T+1)→…` not `(c0,T)→(c0,T+1)→…`                 |
| `backfill-manager` | Cumul reconstruction starts from `device_data` baseline | Emitted `energy_forward[i]` = baselineFwd + Σ deltas[0..i]                         |
| `backfill-manager` | After replay, `setLastCumul` is called with final cumul | The next live MQTT tick will not double-count                                      |
| `backfill-manager` | RPC throws on first device, second device still runs    | Per-device isolation; one failure does not poison the loop                         |
| `backfill-manager` | `stop()` mid-run                                        | Loop aborts at next iteration, does not crash                                      |
| `backfill-manager` | Periodic cron tick when no gap exists                   | No-op, no RPC calls                                                                |
| `backfill-manager` | `backfill_enabled` is false                             | `start()` does not schedule cron, no boot run                                      |

### Coverage gates

- All tests pass under `npx vitest run` in the plugin repo.
- `shelly-rpc.test.ts` covers the 8 scenarios above.
- `backfill-manager.test.ts` covers the 12 scenarios above.

## Out of test scope

- E2E test against a real Shelly: covered by T9 manual validation.
- React UI tests: no UI changes.
- Sowel core test changes: zero — Sowel doesn't know about backfill.
