# Sowel Specs Index

This file is a navigation aid over `specs/`. Every spec under `specs/XXX-name/` typically contains three files: `spec.md` (requirements + acceptance criteria), `architecture.md` (technical design), `plan.md` (implementation steps).

**Use this index to quickly recover context**: scan descriptions, find the relevant spec, then read the full folder for details.

Specs are grouped by theme and annotated with status:

- ✅ **active** — implemented and in production
- 🔁 **superseded** — replaced by a later spec (follow the arrow)
- 🟡 **partial** — implemented, but scope has evolved

---

## Foundations (V0.x) — core engine

| #   | Title                                  | Status                    | Summary                                                                        |
| --- | -------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| 001 | V0.1 MQTT devices                      | ✅                        | First integration with Zigbee2MQTT bridge. Raw device auto-discovery via MQTT. |
| 002 | V0.1 UI scaffolding devices            | ✅                        | Initial React frontend with device list.                                       |
| 003 | V0.2 Zones                             | ✅                        | Hierarchical nestable zones. Parent-child tree structure.                      |
| 004 | V0.3 Equipments                        | ✅                        | User-facing equipments that bind to devices via data keys.                     |
| 005 | V0.5 UI restructuring                  | ✅                        | Navigation overhaul (home, zones, equipments, devices, admin).                 |
| 006 | V0.6 Sensor equipments                 | ✅                        | Temperature, humidity, motion, luminance sensor types.                         |
| 007 | V0.7 Zone aggregation                  | ✅                        | Auto-compute zone metrics from equipment data (motion=OR, temp=AVG, etc.).     |
| 008 | Shutter equipments                     | ✅                        | Position + state + cover orders (open/close/stop).                             |
| 009 | V0.8 Recipes                           | ✅                        | Automation engine with typed slots. First built-in recipes.                    |
| 010 | V0.9 Modes                             | ✅                        | Named zone-level states (Day/Night/Away) with impacts.                         |
| 011 | V0.10a Integration plugin architecture | 🔁 superseded by 040, 053 | Initial plugin interface for integrations.                                     |

## V0.10 — built-in integrations (most are now 🔁 externalized as plugins)

| #   | Title                          | Status                | Summary                                                                      |
| --- | ------------------------------ | --------------------- | ---------------------------------------------------------------------------- |
| 012 | V0.10b Panasonic Comfort Cloud | 🔁 → 050              | Panasonic AC cloud API polling (now a plugin).                               |
| 013 | V0.10c MCZ Maestro             | 🔁 → 049              | MCZ pellet stove Socket.IO integration (now a plugin).                       |
| 014 | V0.10d Netatmo Home+Control    | 🔁 → 048a, 048b, 048c | Netatmo HC integration (now split into 3 plugins: weather, control, energy). |

## V0.11 — logging, backup, shutters UX

| #   | Title                           | Status             | Summary                                                              |
| --- | ------------------------------- | ------------------ | -------------------------------------------------------------------- |
| 015 | V0.11 Logging system            | ✅                 | Pino structured logging, ring buffer, module tagging, UI log viewer. |
| 016 | V0.8b Motion Light enhancements | ✅                 | Motion-light recipe refinements (time slots, override, fallback).    |
| 017 | V0.11b Backup hardening         | 🔁 → 046, 058, 060 | First backup system (export/import).                                 |
| 018 | Recipes roadmap                 | ✅ (meta)          | Roadmap document for planned recipes.                                |
| 019 | V0.8c Switch light              | ✅                 | Switch-light recipe (toggle on button press).                        |
| 020 | V0.8e Presence thermostat       | ✅                 | Presence-based thermostat setpoint logic with cocoon.                |
| 021 | V0.8f Zone commands             | ✅                 | Zone-level order batching (allShuttersOpen/Close, allLightsOn/Off).  |

## UX & dashboard

| #   | Title                              | Status   | Summary                                                                                                                                                                                      |
| --- | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 022 | Dark mode                          | ✅       | Tailwind class-based dark mode with user preference.                                                                                                                                         |
| 023 | Sunrise / sunset                   | ✅       | SunCalc-based sunlight manager with offset settings.                                                                                                                                         |
| 024 | Motion light split                 | ✅       | Split motion-light into basic + dimmable variants.                                                                                                                                           |
| 025 | V0.13 History (InfluxDB)           | ✅       | Time-series history for numeric device data.                                                                                                                                                 |
| 026 | V0.8 Cocoon thermostat             | ✅       | Bedtime cocoon logic for presence thermostat.                                                                                                                                                |
| 027 | V0.8 Presence heater               | ✅       | Presence-based heater recipe (eco/comfort).                                                                                                                                                  |
| 028 | MQTT publishers                    | ✅       | Outbound MQTT publisher manager (mappings from events to topics). v1.2.6: `onChangeOnly` option — publish only on value change to avoid flooding external displays with periodic heartbeats. |
| 029 | MQTT brokers                       | ✅       | Multi-broker support for MQTT publishers.                                                                                                                                                    |
| 030 | Logging audit                      | ✅       | Consolidated log level strategy and module taxonomy.                                                                                                                                         |
| 031 | Notification publishers            | ✅       | Telegram / webhook / FCM / ntfy notification channels.                                                                                                                                       |
| 032 | State watch recipe                 | ✅       | Generic data-key watch with alarm recipe.                                                                                                                                                    |
| 033 | Dashboard widgets                  | ✅       | Customizable zone widgets on dashboard.                                                                                                                                                      |
| 034 | Progressive Web App                | ✅       | PWA manifest, service worker (`NetworkOnly` for /api/), offline banner.                                                                                                                      |
| 035 | Energy dashboard                   | ✅       | Day/week/month/year energy breakdown with HP/HC classification.                                                                                                                              |
| 036 | Order dispatch error handling      | ✅       | Graceful fallback when order publish fails.                                                                                                                                                  |
| 037 | Panasonic CC connection resilience | 🔁 → 050 | Reconnect logic for Panasonic Comfort Cloud.                                                                                                                                                 |
| 038 | MCZ connection resilience          | 🔁 → 049 | Reconnect logic for MCZ Maestro.                                                                                                                                                             |
| 039 | Integrations page redesign         | ✅       | Unified integrations page (list, configure, status).                                                                                                                                         |

## Plugin system V2 (crucial — current architecture)

| #   | Title                      | Status               | Summary                                                       |
| --- | -------------------------- | -------------------- | ------------------------------------------------------------- |
| 040 | Plugin engine              | 🟡 superseded by 053 | First generation plugin engine (install from local zip).      |
| 041 | Weather forecast plugin    | ✅                   | Open-Meteo-based weather forecast plugin (reference example). |
| 042 | Weather forecast equipment | ✅                   | Equipment type for forecast data display.                     |
| 043 | Plugin update              | ✅                   | In-place plugin update from GitHub release.                   |
| 044 | Plugin SmartThings         | ✅                   | Samsung SmartThings plugin (polling + orders).                |
| 045 | Plugin SmartThings OAuth   | ✅                   | OAuth2 flow for SmartThings authentication.                   |
| 046 | Backup v2                  | 🔁 → 058, 060        | Revised backup format (includes InfluxDB line protocol).      |
| 047 | Prebuilt plugins           | ✅                   | Plugin distribution via GitHub releases (tarball).            |

## V1.0 — externalizing all integrations as plugins

| #    | Title                       | Status | Summary                                                                                                                                             |
| ---- | --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 048a | Plugin Netatmo Weather      | ✅     | Externalized Netatmo Weather Station integration.                                                                                                   |
| 048b | Plugin Legrand Control      | ✅     | Externalized Legrand Home+Control (lights/shutters/plugs).                                                                                          |
| 048c | Plugin Legrand Energy       | ✅     | Externalized Legrand energy monitoring (NLPC meters).                                                                                               |
| 049  | Plugin MCZ Maestro          | ✅     | Externalized MCZ Maestro integration.                                                                                                               |
| 050  | Plugin Panasonic CC         | ✅     | Externalized Panasonic Comfort Cloud integration.                                                                                                   |
| 051  | Plugin LoRa2MQTT            | ✅     | LoRa2MQTT bridge as plugin.                                                                                                                         |
| 052  | Plugin Zigbee2MQTT          | ✅     | Zigbee2MQTT as plugin (last built-in to be externalized).                                                                                           |
| 053  | **Package manager**         | ✅     | **Major refactor**: `PackageManager` service manages all packages (integrations + recipes). GitHub-based distribution with `plugins/registry.json`. |
| 054  | Recipe packages             | ✅     | Recipes externalized as packages (same distribution model as plugins).                                                                              |
| 055  | Versioning + CI/CD + Docker | ✅     | GitHub Actions release workflow, `scripts/release.sh`, ghcr.io image, semver tags. Introduced v1.0.0.                                               |

## V1.0+ — self-update & deployment

| #   | Title                                           | Status   | Summary                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 057 | Self-update UI                                  | 🔁 → 060 | Initial self-update via UI (had race condition).                                                                                                                                                                                                                                                                                |
| 058 | Backup completeness                             | ✅       | Auto-download missing plugins on startup; dynamic data file scan; FK-safe restore.                                                                                                                                                                                                                                              |
| 059 | Remote registry + backup fix                    | ✅       | Remote `plugins/registry.json` fetch with cache + local fallback. InfluxDB ensureBuckets before restore.                                                                                                                                                                                                                        |
| 060 | **Self-update helper + detection improvements** | ✅       | **Current self-update architecture**: helper container pattern (spawn `docker:25-cli` that survives sowel death), auto pre-update backup in `data/backups/` (rotate keep 3), 1h version poll, WebSocket push of update.available, "Check for updates" button, `composeManaged` detection.                                       |
| 061 | **Timezone from home location**                 | ✅       | Auto-derive `process.env.TZ` from `home.latitude`/`home.longitude` via `tz-lookup` at boot (runs before `createLogger()` to avoid V8 TZ caching). Endpoints `GET /system/timezone` + `POST /system/restart` (helper container). UI: TZ in Settings, `CurrentTimePill` in header, `RestartToast` on location change.             |
| 062 | Water valve equipment                           | ✅       | New `water_valve` equipment type with custom valve icon, `water` widget family, zone aggregation (open/total + flow sum), zone pill, dashboard widget (close-all), and detail card with toggle + timed watering. Targets SONOFF SWV and similar smart irrigation valves. Foundation for future auto-watering recipe (spec 063). |

## Order dispatch refactoring (progressive migration)

| #   | Title                             | Status  | Summary                                                                                                 |
| --- | --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| 067 | Order dispatch — core + lora2mqtt | 🟡 next | New `executeOrder(device, orderKey, value)` signature with v1 retro-compat. First migration: lora2mqtt. |
| 068 | Order dispatch — zigbee2mqtt      | Planned | Migrate z2m plugin to new signature.                                                                    |
| 069 | Order dispatch — legrand-control  | Planned | Migrate legrand-control (cloud API IDs stored in plugin memory).                                        |
| 070 | Order dispatch — panasonic-cc     | Planned | Migrate panasonic-cc (guid/param stored in plugin memory).                                              |
| 071 | Order dispatch — mcz-maestro      | Planned | Migrate mcz-maestro (commandId stored in plugin memory).                                                |
| 072 | Order dispatch — netatmo-security | Planned | Migrate netatmo-security (single param: monitoring).                                                    |
| 073 | Order dispatch — smartthings      | Planned | Migrate smartthings (command names stored in plugin memory).                                            |
| 074 | Order dispatch — cleanup          | Planned | Remove v1 retro-compat. Drop `dispatch_config` column from `device_orders`.                             |

---

## How to use this index after context loss

1. **Find the theme** you need via section headers above
2. **Open `specs/XXX-name/spec.md`** for requirements and acceptance criteria
3. **Open `specs/XXX-name/architecture.md`** for technical design, data model changes, file-level impact
4. **Open `specs/XXX-name/plan.md`** for implementation steps

For the current plugin-based architecture, start with **spec 053** (PackageManager) — it's the root of everything plugin-related.

For self-update, start with **spec 060** — it supersedes spec 057 and is the current design.

For the full system overview, see [technical/architecture.md](technical/architecture.md).

For production operations (deploy, backup, self-update, logs), see [technical/deployment.md](technical/deployment.md).
