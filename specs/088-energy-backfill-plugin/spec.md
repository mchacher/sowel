# Spec 088 — Iteration 4: `sowel-plugin-energy-backfill`

> See [spec 084 — overview](../084-shelly-energy-overview/spec.md) for the
> guiding principles and the full iteration plan.

## Goal

Sowel-side plugin that, on boot and periodically thereafter, fills any
gaps in Sowel's internal `sowel-energy-hourly` / `sowel-energy-daily`
buckets by querying the `energydata-stack` Influx (spec 087). The user
result: the energy page in Sowel shows continuous charts even after a
multi-hour Sowel downtime — there is no visible gap because the gap is
backfilled from the always-on archive.

This plugin is opt-in. It requires `energydata-stack` to be deployed and
reachable.

## Key design decisions

- The plugin does not write to InfluxDB directly via `HistoryWriter`. It
  uses the same code path as the `EnergyAggregator` so the math
  (forward/reverse, HP/HC classification, daily boundaries) is identical
  to what Sowel would have produced during normal operation.
- Idempotent: re-running the backfill on an already complete period is a
  no-op.
- Gap detection: scan Sowel's hourly bucket for missing time slots over a
  configurable window (default 30 days).
- Refresh trigger: at boot, plus a scheduled task (e.g. once per hour) to
  catch short MQTT disconnects as well.

## Out of scope of this iteration

- Backfilling raw `power` data (only energy aggregates).
- Detecting and replaying gaps caused by MQTT broker downtime that
  affected `energydata-stack` itself.

## To detail later

- Configuration: Influx URL / token / org / bucket.
- Detection algorithm: gap query in Flux, mapping back to forward/reverse
  delta values.
- Conflict resolution if both Sowel and `energydata-stack` recorded the
  same period.
- Sowel UI: log/notify when a backfill fills a > 1 hour gap.
- Performance: limit the backfill window scanned at each tick.
