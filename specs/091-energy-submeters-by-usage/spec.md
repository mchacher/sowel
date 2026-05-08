# Spec 091 — Power-only submeters & by-usage consumption chart

## Summary

Allow `energy_meter` (sub-meter) equipments to be backed by devices that
expose only instantaneous **power** (W) and not cumulative energy (Wh) —
typical of cheap zigbee meters like the Legrand GEM. Sowel integrates the
power signal locally into a Wh stream and writes it to InfluxDB on the
same per-minute cadence as the main meter, attributed to that submeter
equipment. A new toggle on the Energy page replaces the existing chart
with a "consumption by usage" stacked breakdown: one bar per submeter
plus an "Other" bar for the residual not captured by any submeter.

## Why

The user added zigbee Legrand GEM clamps on dedicated circuits (PAC, pool)
to break down the home's consumption. The clamps report only `power` (W),
which today's `energy_meter` device picker rejects (it requires the
`energy` data category). Even if bound, no by-usage chart exists: the
existing chart only shows total HP/HC/prod/autoconso/injection.

## Scope

In:

- DeviceSelector accepts `power` as an alternative to `energy` for type
  `energy_meter`.
- Sowel computes `energy` (Wh, monotonic cumulative) from `power` (W) by
  trapezoidal integration over the time deltas between samples, per
  submeter. The integrated value is written to InfluxDB every minute,
  same cadence as the main meter, on the submeter's `equipmentId`.
- Power-integrated submeters write only `category=energy`, not the raw
  `power` (which is already historized by `HistoryWriter` from the
  device-level binding).
- The integration state (running cumulative + last sample timestamp +
  last sample value) survives restart by being persisted to SQLite per
  submeter.
- Energy API exposes a new endpoint that returns per-submeter
  consumption time series for a given period, aligned to the same
  buckets as `/energy/history`.
- New UI mode on the Energy page: a toggle replaces the existing stacked
  bar chart with a "by usage" stacked bar chart — one stack per
  submeter, plus an "Other" stack for `total_consumption - Σ submeters`
  (clamped to ≥ 0 for safety, even though the user expects this never
  to underflow).
- Submeters use the same retention stack as the main meter:
  raw bucket → `sowel-energy-hourly` → `sowel-energy-daily` via the
  existing downsampling tasks. No new buckets, no new downsampling tasks.

Out:

- No HP/HC tariff classification on submeters. Only `total_consumption`
  per submeter is exposed in the by-usage view.
- No backfill of historical submeter values from before this feature
  ships. Series start at activation time.
- No retroactive deletion: a deleted submeter keeps its history in
  InfluxDB and continues appearing in the past view of the chart (the
  same way the main meter does today).
- No support for submeters with cumulative `energy` (Wh) in this spec —
  the integration path is power-only. Existing submeters already
  bound on a real `energy` device keep working unchanged via
  `HistoryWriter` (no integration applied to them).
- No live (real-time) breakdown view. The existing "Live" page is
  untouched.
- Support is for V2 plugins only — power-only submeters require the
  device's `power` data category to be reported reliably with sample
  cadence ≥ 1 every few minutes. We do not introduce a polling
  fallback.

## Acceptance criteria

- [x] DeviceSelector lists devices that expose `power` (W) as eligible
      for `energy_meter` even without an `energy` data point.
- [x] When the user binds a power-only device to an `energy_meter`,
      Sowel starts integrating its `power` into a cumulative Wh stream
      attributed to that submeter equipment.
- [x] Cumulative submeter energy is written to InfluxDB every minute,
      `category=energy`, `alias=energy`, with the submeter's
      `equipmentId` as tag — visible in the existing energy buckets and
      downsampled normally.
- [x] Integration state is persisted across restart: after a Sowel
      restart, the previous cumulative value resumes (no rollover, no
      backfill of the off-period).
- [x] New endpoint `GET /api/v1/energy/by-usage?period=<>&date=<>` returns
      per-equipment consumption series aligned to the same time buckets
      as `/api/v1/energy/history`.
- [x] Energy page exposes a toggle "Total / By usage". When "By usage"
      is selected, the chart renders stacked bars per submeter +
      "Other"; totals/HP/HC/prod widgets stay unchanged.
- [x] When no submeter is configured, the toggle is hidden.
- [x] Existing main-meter and production-meter behavior is unchanged.
      Self-consumption writer and current `/energy/history` endpoint
      are untouched.

## Edge cases

- A submeter with `power < 0` (clamp wired backwards): we integrate
  the absolute value to avoid Wh going negative. Logged once at WARN.
- A submeter with stale `power` (no update for > 10 minutes): we
  freeze its cumulative value (don't extrapolate) until next update,
  to avoid runaway integrations during device offline windows.
- A submeter recreated with the same name: gets a new `equipmentId`
  and starts a fresh cumulative — old history stays under the old id
  in Influx but is not stitched.
- "By usage" toggle with submeters but no main meter: chart still
  renders with submeter stacks; the "Other" bar is hidden because we
  don't know the total. (Pure breakdown of what we measure.)
