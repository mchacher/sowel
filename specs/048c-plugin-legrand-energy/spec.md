# 048c — Externalize Legrand Energy as Plugin

## Summary

Extract the energy monitoring from the built-in `netatmo_hc` integration into an external plugin `sowel-plugin-legrand-energy`. This is the last piece — after this, `src/integrations/netatmo-hc/` is deleted entirely.

The plugin discovers NLPC meters via homesdata, polls power status via homestatus, and fetches 30-min energy windows via getMeasure (bridge-level queries). Production device is configured via a setting (no EquipmentManager dependency).

## Current State

- Location: `src/integrations/netatmo-hc/` (index.ts, netatmo-poller.ts, netatmo-bridge.ts, netatmo-types.ts, energy-backfill.ts, energy-backfill-today.ts)
- Integration ID: `netatmo_hc`
- Devices: 4 NLPC meters (Total, PAC, Piscine, Solaire)
- Equipment bindings: Energie Totale (main_energy_meter → Total), Energie Solaire (energy_production_meter → Solaire)
- Energy backfill scripts: `scripts/energy/` (standalone, stay in Sowel core)

## Acceptance Criteria

- [x] New repo `mchacher/sowel-plugin-legrand-energy`
- [x] Discovers NLPC meters via homesdata + captures bridgeId
- [x] Polls power status via homestatus
- [x] Polls bridge-level energy via getMeasure (30-min windows, 6h lookback)
- [x] Consumption written to main meter device (first NLPC with bridge)
- [x] Production written to device configured via `production_device_name` setting
- [x] No dependency on EquipmentManager or InfluxClient
- [x] OAuth authentication with token rotation (separate credentials)
- [x] Integration ID: `legrand_energy`
- [x] Settings prefix: `integration.legrand_energy.*`
- [x] Token file: `data/legrand-energy-tokens.json`
- [x] Pre-built tarball release via GitHub Actions
- [x] Added to `plugins/registry.json`
- [x] Device migration: 4 NLPC devices from `netatmo_hc` to `legrand_energy` (preserves UUIDs, bindings, history)
- [x] Built-in `src/integrations/netatmo-hc/` entirely removed
- [x] Built-in registration removed from `src/index.ts`
- [x] No user-facing regression on energy data (consumption + production + InfluxDB history intact)

## Plugin Settings

| Key                      | Label                      | Type     | Required | Default | Notes                                                                                                                       |
| ------------------------ | -------------------------- | -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `client_id`              | Client ID                  | text     | yes      | —       | From dev.netatmo.com                                                                                                        |
| `client_secret`          | Client Secret              | password | yes      | —       |                                                                                                                             |
| `refresh_token`          | Refresh Token              | password | yes      | —       | With energy scopes                                                                                                          |
| `polling_interval`       | Polling interval (seconds) | number   | no       | 300     | Min 60                                                                                                                      |
| `production_device_name` | Production device name     | text     | no       | —       | Friendly name of the NLPC device that receives production data (e.g. "Solaire"). If empty, production tracking is disabled. |

## Energy Data Flow

```
getMeasure(bridgeId, bridgeId, energy_types, "5min", windowStart, windowEnd)
  → sum per 30-min window:
    consumption = buy_from_grid$1 + buy_from_grid$2 + self_consumption
    production  = self_consumption + resell_to_grid
    autoconso   = self_consumption
    injection   = resell_to_grid

  → deviceManager.updateDeviceData("legrand_energy", mainMeterName, { energy: consumption }, windowStart)
  → deviceManager.updateDeviceData("legrand_energy", productionDeviceName, { energy: production, autoconso, injection }, windowStart)
  → deviceManager.updateDeviceData("legrand_energy", mainMeterName, { demand_30min: consumption * 2 })  // instantaneous power
```

The `sourceTimestamp` parameter on `updateDeviceData` ensures HistoryWriter writes at the aligned 30-min boundary for correct InfluxDB aggregation.

## Scope

### In Scope

- NLPC meter discovery (homesdata)
- Bridge ID capture for getMeasure
- Power status polling (homestatus)
- 30-min energy window polling (getMeasure)
- Consumption + production data distribution
- Device migration from netatmo_hc by model (NLPC)
- Complete removal of `src/integrations/netatmo-hc/`

### Out of Scope

- Energy backfill (scripts in `scripts/energy/` — stay in Sowel core)
- `energy-backfill-today.ts` (standalone script — stays in Sowel core)
- PluginDeps extension (not needed)
- New equipment types

## Edge Cases

- No NLPC meters found → plugin stays connected but no energy data
- Bridge ID not found → skip energy polling (log warning)
- `production_device_name` not set → only consumption tracked
- `production_device_name` set but device doesn't exist → upsertFromDiscovery will create it, but getMeasure data only goes to mainMeter
- API rate limit (429) → handled by bridge retry logic
