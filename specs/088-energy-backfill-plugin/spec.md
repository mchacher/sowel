# Spec 088 — Iteration 4: Shelly plugin gap backfill (v2)

> See [spec 084 — overview](../084-shelly-energy-overview/spec.md) for the
> guiding principles and the full iteration plan.

> **Revised 2026-05-03.** The original version of this spec assumed the
> existence of an external `energydata-stack` (spec 087) as the source of
> backfill data. After verifying that the Shelly Pro 3EM stores at least
> 60 days of 1-minute records in its own flash and exposes them through
> `EM1Data.GetData`, that dependency was dropped. This spec now describes
> a self-contained extension of the Shelly plugin.

## Goal

Extend the existing `sowel-plugin-shelly-mqtt` to detect missing windows
in Sowel's internal hourly bucket and reconstruct them from the Shelly
device's own historical data. The user-visible result: after a Sowel
restart or downtime of any plausible duration (minutes to days), the
energy charts come back with the correct minute-by-minute distribution
and HP/HC classification — no flat zeros, no spike at restart.

## Why this iteration matters

Iteration 086 made the plugin synthesise a signed `energy` delta on each
`em1data:N` MQTT update. When Sowel is down for a long stretch, the
plugin's in-memory `lastCumul` baseline survives in SQLite (it is
persisted under the `energy_forward` / `energy_reverse` device-data
aliases), so on restart the next event emits the entire gap delta as a
single point at the restart timestamp. Consequences:

- **Daily kWh totals stay correct** (energy is conserved in the cumul
  delta).
- **Hourly granularity collapses**: a single spike at restart, flat
  zeros during the downtime.
- **HP/HC classification is wrong** if the downtime crossed an
  HP↔HC tariff boundary — the whole delta inherits the tariff at restart.
- **If SQLite itself is restored from a backup**, the persisted cumul is
  also stale and the gap delta reconstruction is wrong by the difference
  between the device counter and the restored snapshot.

This iteration fixes all three by replaying the Shelly's own per-minute
records over the exact source timestamps, exactly as if those events had
arrived live.

## Key design decisions

### Self-contained in the Shelly plugin

The backfill logic ships in `sowel-plugin-shelly-mqtt` v1.2.0. The
plugin already owns:

- The MQTT connection and per-channel routing.
- The `lastCumul` baseline state and its persistence in `device_data`.
- The mapping from Shelly channels to Sowel devices.

Adding HTTP-RPC access for the historical query is a small extension on
top of that foundation, not a new plugin. No change to Sowel core, no
change to existing equipment types, no schema migration.

### Query path: HTTP RPC, mDNS resolution

The plugin learns each Shelly device's identifier from its MQTT
announce. The host name `<device-id>.local` resolves over mDNS on the
LAN, and the plugin queries `http://<device-id>.local/rpc/EM1Data.*`
directly. HTTP is used rather than MQTT-RPC because:

- Pagination via `next_record_ts` is naturally request-response.
- Retries on transient errors are simpler to express.
- Backfill is a low-frequency operation (≤ once per hour); the slight
  HTTP overhead vs MQTT is irrelevant.

If `auth_en: true` on the device, the plugin reads
`shelly_mqtt.shelly_auth_user` / `shelly_mqtt.shelly_auth_password` from
its settings. Defaults: empty — matches the typical home-LAN install.

### Source of truth: same pipeline as live events

Each retrieved minute-record is fed through the **existing** plugin
emit path:

```
record { ts, total_act_energy, total_act_ret_energy, ... }
  → deviceManager.updateDeviceData(integrationId, sid, {
      energy_forward: ..., energy_reverse: ..., energy: fwd - rev
    }, { sourceTimestamp: ts })
```

The HistoryWriter, TariffClassifier and SelfConsumptionWriter all
operate on `sourceTimestamp` — they do not know whether the event is
live or historical. Backfilled minutes therefore land in the raw bucket
with the correct `_time` and are classified HP/HC against their actual
hour-of-day, not the time of replay.

**Channel interleaving is required**: SelfConsumptionWriter pairs a Grid
tick with a Solar tick within a 30-second window before computing
`autoconso` / `injection`. Replaying all of channel 0 first then all of
channel 1 would defeat that pairing — only the last 1-2 minutes would
align. The plugin therefore **emits one minute at a time across all
channels**, in chronological order: `(grid, T) → (solar, T) → (aux, T)
→ (grid, T+1) → (solar, T+1) → ...`.

The downsample task `sowel-energy-sum-hourly` then regenerates the
hourly bucket on its next 1h tick. The same mechanism was validated end
to end on 2026-05-03 by the `recompute-household-energy.ts` migration.

### Gap detection — driven by `device_data.lastUpdated`, no Influx access

Plugins do not have direct InfluxDB access, and giving them a query
contract would needlessly extend the plugin API for one consumer. The
plugin already reads persisted `device_data` values (the same path
`ensureBaseline` uses to hydrate baselines on cold start), and Sowel
records `lastUpdated` on every write — so the live freshness of any
channel is observable from the plugin without crossing into Sowel core.

Algorithm (per channel):

1. At plugin start (after the existing baseline hydration) and on every
   hourly cron tick, read the `device_data.lastUpdated` for
   `energy_forward` of channel `id=N`.
2. Compute `gap = now - lastUpdated`.
3. If `gap > GAP_THRESHOLD_S` (default 5 min), schedule a backfill for
   the window `[max(lastUpdated, now - backfill_hours * 3600), now]`.
4. Otherwise, no-op.

The 5-min threshold is conservative: a normal MQTT heartbeat is every
~60s, so even with a noisy network we expect ticks within 2-3 min.
Anything past 5 min is a real gap.

Hours fully outside Shelly's own ~60-day retention are skipped silently
with a warn log — nothing can recover them.

To detect the recovery boundary the plugin calls
`EM1Data.GetRecords?id=N` first; the response lists the available
`data_blocks`. The actual fetch range is intersected with `[gap window]`
to avoid asking for data the device does not hold.

### Run cadence

Two triggers:

1. **At plugin start** (after the existing baseline hydration), once
   per channel.
2. **Hourly cron** while the plugin is connected, scanning the
   configurable window each tick.

Both go through the same `runBackfillWindow()` entry point, idempotent
by design — InfluxDB upserts on `(measurement, tag set, ts)` mean
re-running on an already-correct hour is a no-op.

### Configuration

Added to the plugin's existing settings schema:

| Key                    | Type     | Default | Range    | Purpose                                                                                                                  |
| ---------------------- | -------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `backfill_enabled`     | boolean  | `true`  | —        | Master toggle.                                                                                                           |
| `backfill_hours`       | int      | `24`    | `1..168` | Scan window. 168h = 7d. Above that the use case is exotic and we don't encourage it.                                     |
| `shelly_host_<sid>`    | string   | `""`    | —        | Optional per-device override (IP or hostname). Empty → fall back to `<sid>.local` mDNS. Free-form key, validated lazily. |
| `shelly_auth_user`     | string   | `""`    | —        | Optional, only used if device requires auth.                                                                             |
| `shelly_auth_password` | password | `""`    | —        | Same.                                                                                                                    |

Note: there is no setting for "backfill on boot" vs "periodic" — both
are always on when the master toggle is on. They share the same logic.

## Acceptance criteria

- [ ] After stopping Sowel for ≥ 1h and restarting, the energy chart
      for the affected window fills in within 1h (or immediately if the
      hourly downsample task is triggered manually).
- [ ] HP/HC classification on backfilled hours matches the tariff in
      effect at the original timestamp, not the time of replay.
- [ ] Re-running the backfill on a fully-populated window writes no new
      points to the raw bucket (idempotent).
- [ ] If the gap exceeds Shelly's retention (> 60 days), the gap is
      logged as a structured warn and skipped — Sowel does not crash
      or silently wedge the live pipeline.
- [ ] Backfill never blocks live event processing — the live MQTT
      handler stays responsive even mid-replay.
- [ ] Unit tests cover: full-gap recovery, no-gap (no-op), partial
      gap, retention-exceeded, RPC failure with retry.

## Out of scope

- **Backfilling raw `power` data.** Only energy aggregates are
  reconstructed. The 1Hz `act_power` stream is live-only and any UI
  feature relying on it (Live page) accepts gaps.
- **Cross-device gap detection.** Each Shelly is queried for its own
  channels. Other integrations (Z2M power plugs, etc.) are not in
  scope.
- **MQTT-RPC transport.** Only HTTP-RPC is implemented. If LAN-only
  HTTP becomes a problem later, MQTT-RPC can be added without changing
  the public surface.
- **A "backfill on demand" UI.** Reload via service restart for now.
  A button in the integrations page is a future ergonomic improvement,
  not a correctness requirement.

## Risks and mitigations

| Risk                                                                         | Mitigation                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mDNS resolution flaky on some networks                                       | Setting `shelly_mqtt.shelly_host` (optional override per device) — out-of-scope for v1 but room reserved in the schema.                                                                     |
| Shelly RPC throttles under load                                              | Backfill paginates 27 records / call (Shelly's natural page size); inserts a 100ms delay between pages. Worst case 24h × 60min / 27 ≈ 53 calls × 3 channels ≈ 16s of wall time. Negligible. |
| The plugin's existing `lastCumul` and a backfill of the same minute conflict | The plugin emits via the same code path; same minute = same `(equipmentId, alias, ts)` key in Influx ⇒ upsert. Last write wins, no duplication.                                             |
| 60-day retention exceeded for a long-stopped instance                        | Document explicitly in the plugin README. Anything older than 60 days is not recoverable from any source.                                                                                   |

## To detail at implementation time

- Exact Flux query for gap detection (count + threshold).
- Retry policy on RPC failure (3 retries, exponential backoff).
- Log structure: one info per backfill run with `{ channelId, gapsDetected, recordsWritten }`, one warn per skipped gap.
- README update in the plugin repo to document the new settings.
