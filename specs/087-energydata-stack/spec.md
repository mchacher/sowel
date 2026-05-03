# Spec 087 — Iteration 3: `energydata-stack` (independent Docker stack)

> **Status: REJECTED (2026-05-03).** The Shelly Pro 3EM stores at least
> 60 days of 1-minute-resolution energy data natively in flash, queryable
> via the `EM1Data.GetData` RPC (HTTP or MQTT). That hardware archive
> survives device power-cycles and Sowel downtimes alike, which makes the
> independent stack proposed below redundant. The iteration's intent —
> "preserve raw data when Sowel is offline" — is fulfilled by the device
> itself; the gap-fill workflow originally relying on this stack has been
> reworked in [spec 088](../088-energy-backfill-plugin/spec.md) to query
> the Shelly directly. The original analysis is preserved below as a
> record of the alternative considered.

> See [spec 084 — overview](../084-shelly-energy-overview/spec.md) for the
> guiding principles and the full iteration plan.

## Goal

Deploy a separate Docker compose project, `/opt/energydata-stack`, that
collects and archives energy data **independently of Sowel's lifecycle**.
The stack contains:

- `mosquitto-client` — actually a parallel consumer of the existing host
  mosquitto (no separate broker; the systemd `mosquitto` already serves
  both Sowel and Telegraf).
- `telegraf` — subscribes to the same Shelly MQTT topics that the iteration
  1 plugin subscribes to. Parses the JSON status payloads, writes per-channel
  `act_power` / `aenergy.total` / `ret_aenergy.total` (and ancillary
  voltage/current/pf) to a dedicated InfluxDB.
- `influxdb-energy` — own InfluxDB instance (separate port, separate org,
  separate retention policy from Sowel's internal Influx). Source of truth
  for raw, long-term energy data.
- `grafana` — preconfigured dashboard with live "production / grid /
  self-consumption" view + historical breakdown.

When Sowel is stopped (`docker compose down` on `/opt/sowel`), this stack
keeps recording without interruption.

## Out of scope of this iteration

- Sowel reading from this Influx (no auto-backfill, no
  `ENERGY_INFLUX_URL` in Sowel — that is iteration 4 if at all).
- Migration of the existing Sowel-internal Influx data to this new
  Influx. The two are parallel; old Sowel history stays in Sowel's
  Influx.

## To detail later

- Telegraf MQTT input config (subscribe pattern, JSON parsing).
- Influx schema (measurement names, tags, field names).
- Influx tasks for downsampling raw → hourly → daily.
- Grafana dashboard JSON.
- Reverse-proxy and authentication for Grafana.
- Retention policy per bucket (raw 30d / hourly 2y / daily 10y like Sowel).
