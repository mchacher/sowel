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

| #   | Title                                           | Status   | Summary                                                                                                                                                                                                           |
| --- | ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 049 | Externalize MCZ Maestro as Plugin               | ✅       | Shipped. See `specs/049-plugin-mcz-maestro/`.                                                                                                                                                                     |
| 050 | Externalize Panasonic CC as Plugin              | ✅       | Shipped. See `specs/050-plugin-panasonic-cc/`.                                                                                                                                                                    |
| 051 | Externalize LoRa2MQTT as Plugin                 | ✅       | Shipped. See `specs/051-plugin-lora2mqtt/`.                                                                                                                                                                       |
| 052 | Externalize Zigbee2MQTT as Plugin               | ✅       | Shipped. See `specs/052-plugin-zigbee2mqtt/`.                                                                                                                                                                     |
| 053 | PackageManager Extraction + Plugin Adaptation   | ✅       | Shipped. See `specs/053-package-manager/`.                                                                                                                                                                        |
| 054 | Recipe Packages                                 | ✅       | Shipped. See `specs/054-recipe-packages/`.                                                                                                                                                                        |
| 055 | Versioning 1.0.0, CI/CD & Docker                | ✅       | Shipped in v1.0.0. See `specs/055-versioning-cicd-docker/`.                                                                                                                                                       |
| 057 | Self-update UI                                  | 🔁 → 060 | Initial self-update via UI (had race condition).                                                                                                                                                                  |
| 058 | Backup completeness                             | ✅       | Auto-download missing plugins on startup; dynamic data file scan; FK-safe restore.                                                                                                                                |
| 059 | Remote registry + backup fix                    | ✅       | Remote `plugins/registry.json` fetch with cache + local fallback. InfluxDB ensureBuckets before restore.                                                                                                          |
| 060 | **Self-update helper + detection improvements** | ✅       | Current self-update architecture: `docker:25-cli` helper container, auto pre-update backup in `data/backups/`, version poll with WebSocket push, "Check for updates" button, `composeManaged` detection.          |
| 061 | **Timezone from home location**                 | ✅       | Derives `process.env.TZ` from `home.latitude`/`home.longitude` via `tz-lookup` at boot, adds `GET /system/timezone` + `POST /system/restart`, and shows TZ in Settings with `CurrentTimePill` and `RestartToast`. |
| 062 | Water valve equipment                           | ✅       | New `water_valve` equipment type with `water` widget family, zone aggregation, dashboard close-all widget and timed watering, foundation for the auto-watering recipe (spec 063).                                 |

## Order dispatch refactoring (progressive migration)

| #   | Title                                              | Status  | Summary                                                                                                                                          |
| --- | -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 063 | Auto-watering recipe plugin                        | ✅      | Shipped in v1.1.0. See `specs/063-auto-watering-recipe/`.                                                                                        |
| 064 | Weather computed rain data + cumulative bar charts | ✅      | Shipped in v1.1.0. See `specs/064-weather-computed-rain/`.                                                                                       |
| 065 | Freecooling recipe plugin                          | ✅      | Shipped in v1.1.2. See `specs/065-freecooling-recipe/`.                                                                                          |
| 066 | Registry independence from Sowel releases          | ✅      | Shipped in v1.2.0. See `specs/066-registry-independence/`.                                                                                       |
| 067 | Order dispatch — core + lora2mqtt                  | ✅      | New `executeOrder(device, orderKey, value)` signature with v1 retro-compat. First migration: lora2mqtt v2.0.0. Enum case-insensitive resolution. |
| 068 | Order dispatch — zigbee2mqtt                       | ✅      | Migrate z2m plugin to v2.0.0 (apiVersion 2). Composite payload support preserved.                                                                |
| 069 | Order dispatch — legrand-control                   | Planned | Migrate legrand-control (cloud API IDs stored in plugin memory).                                                                                 |
| 070 | Order dispatch — panasonic-cc                      | Planned | Migrate panasonic-cc (guid/param stored in plugin memory).                                                                                       |
| 071 | Order dispatch — mcz-maestro                       | Planned | Migrate mcz-maestro (commandId stored in plugin memory).                                                                                         |
| 072 | Order dispatch — netatmo-security                  | Planned | Migrate netatmo-security (single param: monitoring).                                                                                             |
| 073 | Order dispatch — smartthings                       | Planned | Migrate smartthings (command names stored in plugin memory).                                                                                     |
| 074 | Order dispatch — cleanup                           | Planned | Remove v1 retro-compat. Drop `dispatch_config` column from `device_orders`.                                                                      |

---

## Pool equipments

| #   | Title                                               | Status | Summary                                                                               |
| --- | --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| 075 | Order Dispatch: Legrand Energy Migration            | ✅     | Shipped. See `specs/075-order-dispatch-legrand-energy/`.                              |
| 076 | Order Dispatch: Netatmo Weather Migration           | ✅     | Shipped in v1.2.12. See `specs/076-order-dispatch-netatmo-weather/`.                  |
| 077 | Order Categories                                    | ✅     | Shipped in v1.2.12. See `specs/077-order-category/`.                                  |
| 078 | Button Zone Orders & Zone-First Equipment Selection | ✅     | Shipped in v1.2.14. See `specs/078-button-zone-orders/`.                              |
| 079 | Device Data Enum Values                             | ✅     | Shipped in v1.2.14. See `specs/079-data-enum-values/`.                                |
| 080 | Tasmota Plugin Integration                          | ✅     | Shipped in v1.2.15. See `specs/080-tasmota-plugin/`.                                  |
| 081 | Pool equipments                                     | ✅     | `pool_pump`, `pool_cover` types with candidate-based binding for multi-channel relays |
| 082 | Pool pump schedule                                  | ✅     | Recipe plugin with 3 daily on/off slots                                               |
| 083 | Pool heat pump (Polytropic)                         | ✅     | `pool_heat_pump` type + Modbus integration plugin (Polytropic Master Inverter)        |

## Shelly energy refactor (multi-iteration)

| #   | Title                                 | Status   | Summary                                                                                                   |
| --- | ------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| 084 | Shelly energy — overview              | Planned  | Guiding principles for the 4-iteration migration from Legrand to Shelly Pro 3EM                           |
| 085 | Iteration 1 — shelly-em plugin (live) | Planned  | Sowel plugin: live `act_power` + counters per channel, side-by-side with Legrand                          |
| 086 | Iteration 2 — Shelly drives roles     | Planned  | Promote Shelly channels to `main_energy_meter` + `energy_production_meter`, retire Legrand                |
| 087 | Iteration 3 — energydata-stack        | Rejected | Replaced by hardware-native archive on Shelly Pro 3EM (60d in-device); see 088 for the actual fix         |
| 088 | Iteration 4 — Shelly gap backfill     | Planned  | Plugin queries `EM1Data.GetData` RPC on boot + hourly to replay missing minutes through the live pipeline |

## V1.5 — by-usage chart, MQTT toggles, state-trigger recipe

| #   | Title                                                        | Status | Summary                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 089 | Security hardening: plugin supply chain & backup path safety | ✅     | Shipped in v1.6.2. See `specs/089-security-hardening-supply-chain-backup/`.                                                                                                                                       |
| 090 | MQTT mapping enable/disable                                  | ✅     | Per-mapping `enabled` flag on MQTT publishers, complementing the publisher-level toggle, so a single mapping can be silenced without losing its configuration.                                                    |
| 091 | By-usage consumption chart                                   | ✅     | New `GET /energy/by-usage` endpoint and a Total / By usage toggle on the Energy page rendering a stacked breakdown per submeter `energy_meter` + an "Other" residual (`main meter - Σ submeters`).                |
| 092 | State-triggered light recipe                                 | ✅     | Recipe plugin `state-trigger-light`: lights on for a fixed duration when a watched equipment's `state` alias hits a target value, optional nightOnly; adds `crossZone` and `includeDescendants` slot constraints. |

## V1.7 — WAN hardening & security

| #   | Title                                                          | Status | Summary                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 094 | UI Redesign (umbrella + Phase 0 palette swap)                  | ✅     | Shipped. See `specs/094-ui-redesign/`.                                                                                                                                                                            |
| 095 | Design System Phase 1: Typography Polish                       | ✅     | Shipped. See `specs/095-design-system-typography/`.                                                                                                                                                               |
| 096 | Design System Phase 2: Sidebar                                 | ✅     | Shipped. See `specs/096-design-system-sidebar/`.                                                                                                                                                                  |
| 097 | Design System Phase 3: Strip Pills (Zone Aggregation)          | ✅     | Shipped. See `specs/097-design-system-strip-pills/`.                                                                                                                                                              |
| 098 | Design System Phase 4: Dashboard Widgets                       | ✅     | Shipped. See `specs/098-design-system-dashboard/`.                                                                                                                                                                |
| 099 | Design System Phase 5: Equipment Row                           | ✅     | Shipped. See `specs/099-design-system-equipment-row/`.                                                                                                                                                            |
| 100 | Design System Phase 6: Zone View 2-Column Layout               | ✅     | Shipped. See `specs/100-design-system-comportements/`.                                                                                                                                                            |
| 101 | Activity Feed (Zone view right column)                         | ✅     | Shipped in v1.8.0. See `specs/101-design-system-activity-feed/`.                                                                                                                                                  |
| 102 | Design System Phase 8: Recipe Edit Modal + Surcharges par mode | ✅     | Shipped. See `specs/102-design-system-recipe-modal/`.                                                                                                                                                             |
| 104 | Self-update resilience                                         | ✅     | Shipped in v1.6.3. See `specs/104-self-update-resilience/`.                                                                                                                                                       |
| 105 | WAN hardening                                                  | ✅     | WAN hardening: `@fastify/helmet`, tightened CORS, mandatory WebSocket auth with `Origin` check, non-root container via gosu, opt-in `docker.sock` self-update, auth-by-default on `/api/v1/*`. Shipped in v1.7.0. |

## V1.11 — plugin runtime hardening

| #   | Title                                                           | Status | Summary                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 106 | Make the topbar "update available" pill actionable              | ✅     | Shipped in v1.9.0. See `specs/106-update-pill-actionable/`.                                                                                                                                                                 |
| 107 | Surface a changelog link per row in the UpdatesSheet            | ✅     | Shipped in v1.10.0. See `specs/107-update-row-changelog-link/`.                                                                                                                                                             |
| 108 | Block releases without release notes                            | ✅     | Shipped in v1.10.0. See `specs/108-release-notes-required/`.                                                                                                                                                                |
| 109 | Preserve bound device data/orders across partial re-discoveries | ✅     | Shipped in v1.10.1. See `specs/109-device-discovery-preserve-bound/`.                                                                                                                                                       |
| 110 | Category-first binding resolution across the codebase           | ✅     | Shipped in v1.10.3. See `specs/110-category-first-binding-resolution/`.                                                                                                                                                     |
| 111 | Plugin soft isolation                                           | ✅     | Scoped Proxies around each plugin's `PluginDeps` enforce settings scoped to `integration.<own-id>.*`, an event whitelist, device ownership by `integrationId` and lifecycle error confinement; unconditional since v1.11.0. |
| 112 | Process crash handlers                                          | ✅     | Global `uncaughtException` and `unhandledRejection` handlers log a structured `fatal` line before exit so Docker restarts with a usable trace (audit F03). Shipped in v1.11.1.                                              |
| 113 | Audit log                                                       | ✅     | Persistent `audit_log` SQLite table and `AuditLogger` service recording security-sensitive actions, with admin-only `GET /api/v1/audit` and 365-day retention (audit F13). Shipped in v1.11.1.                              |

## V1.13 — awning equipment + Somfy RTS bridge

| #   | Title                               | Status | Summary                                                                                                                                                                                                                                     |
| --- | ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 115 | Awning equipment + Somfy RTS bridge | ✅     | New `awning` equipment type (sibling of `shutter`, `awnings` widgets) reusing `shutter_position`/`shutter_move`/`set_shutter_position`, zone commands `allAwningsExtend/Stop/Retract`, plugin `sowel-plugin-somfy-rts`. Shipped in v1.13.0. |

## V1.14 — weather station UX

| #   | Title              | Status | Summary                                                                                                                                                                                                                  |
| --- | ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 114 | Weather station UX | ✅     | Weather station widget rework: outdoor module section, Netatmo outdoor module historized by default (`SENSOR_DATA_CATEGORIES`, `CATEGORY_DEFAULTS_ON`), label disambiguation in `humanBindingLabel`. Shipped in v1.12.0. |

## V1.15 — Analyse calendar navigator + live submeter breakdown

| #   | Title                       | Status   | Summary                                                                                                                                                                                                   |
| --- | --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 116 | Equipment availability      | 📝 Draft | Propagate equipment availability (offline / degraded / online) from device state to equipment level, with UI badges and aggregated zone status. Drafted 2026-05-24, ~1.5-2 days. Not started.             |
| 117 | Analyse calendar + submeter | ✅       | Calendar navigator (day/week/month/year) on the Analyse view replacing the TimeRange picker, a live submeter breakdown donut on the Energy page, and a mobile burger nav for Analyse. Shipped in v1.15.0. |
| 118 | Analyse chart improvements  | 📝 Draft | Min/max envelope on `1h`/`1d` line charts, bar charts for rain/energy selections (`isCumulativeBarChart`), correct daily rain total in the Netatmo backfill and backfill safeguards (`--only=<filter>`).  |

## V1.17 — V1.19 — Energy history API + supervised displays

| #   | Title                                 | Status | Summary                                                                                                                                                                                                                          |
| --- | ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 119 | Energy history per-period aggregation | ✅     | Energy history endpoints return calendar-aligned pre-aggregated buckets per period via one InfluxDB `aggregateWindow` in server TZ, keeping the HP/HC split and adding the `"1mo"` resolution. Shipped in v1.17.0.               |
| 120 | Display equipment type                | ✅     | New `display` equipment type for Sowel-supervised screens (sowel-energy-display firmware) with a DisplayPanel detail page, language and brightness controls, and a `displays` widget family. Shipped in v1.18.0.                 |
| 121 | Displays MQTT supervision plugin      | ✅     | Companion MQTT plugin `sowel-plugin-displays` discovering displays via a retained `state` payload with LWT availability, defining the `state` + `cmd/<key>` wire contract for the spec 120 equipment. Shipped alongside v1.18.0. |
| 122 | Display wake action                   | ✅     | Adds the `display_wake` no-value order (routed to `cmd/wake`) that restores the user's preferred brightness from NVS, so presence-driven sleep recipes need not know the level. Shipped in v1.19.0.                              |

## V1.20 — Cost valuation + shadow mode

| #   | Title                 | Status | Summary                                                                                                                                                                                                                        |
| --- | --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 123 | Energy cost valuation | ✅     | Wh/€ toggle on the Energy page pricing history, totals and by-usage breakdown in euros from the HP/HC tariff, computed at read time on `/energy/history` and `/energy/by-usage`. Shipped in v1.20.0.                           |
| 124 | Shadow mode           | ✅     | `SOWEL_SHADOW_MODE=1` makes a container safe against a production copy by gating off every outbound subsystem (plugins, recipes, publishers, GitHub polling), with `GET /api/v1/system/mode` and a banner. Shipped in v1.20.0. |

## V1.21 — V1.23 — Solar + recipe building blocks

| #   | Title                              | Status | Summary                                                                                                                                                                                                                |
| --- | ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 125 | Solar panel equipment + APsystems  | ✅     | Read-only `solar_panel` equipment (one per inverter channel) with DC metrics, widget and Solar dashboard group, plus the `temperature_device` category and the `sowel-plugin-apsystems` companion. Shipped in v1.21.0. |
| 126 | Recipe select slot + getSunlight() | ✅     | Recipe forms gain a `select` slot type and the `hiddenWhen` rule, and recipes gain `ctx.helpers.getSunlight()` (sunrise/sunset/isDaylight with spec 023 offsets). Shipped in v1.23.0.                                  |

## V1.24 — V1.26 — Notifications

| #   | Title                        | Status | Summary                                                                                                                                                                                                |
| --- | ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 127 | Web Push notifications (PWA) | ✅     | Native Web Push notifications on the installed PWA, enabled per device and mappable as a publisher on any equipment/zone/recipe value, with VAPID keys and per-user subscriptions. Shipped in v1.24.0. |
| 128 | Notification re-notify       | ✅     | Notification mappings gain a re-notify option (None / Indefinitely / Limited to N) that re-sends while a mapped value stays active, distinct from the anti-spam throttle. Shipped in v1.26.0.          |

## V1.27 — V1.30 — Metering, watering, RBAC, three-phase

| #   | Title                           | Status | Summary                                                                                                                                                                                                                    |
| --- | ------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 129 | Metering-aware switch           | ✅     | A Switch / Plug shows live power and energy when its device reports them, feeding the energy dashboard, HP/HC and the live submeter breakdown; plain relays unchanged. Shipped in v1.27.0.                                 |
| 130 | Auto-watering per-slot weekdays | ✅     | Each watering slot can be limited to chosen weekdays (empty = every day), e.g. 07:30 on school days and 09:00 on weekends. Powered by a new multi-select recipe option rendered as toggle chips. Shipped in v1.28.0.       |
| 131 | RBAC: config admin-only         | ✅     | The Standard role is limited to viewing and actuating, configuration is admin-only (server-side 403, hidden in UI); amended by issue #912 so a standard user may activate, deactivate and apply modes. Shipped in v1.29.0. |
| 132 | Per-phase power on Energy Live  | ✅     | Per-phase power bars under the Energy Live flow diagram when the main meter carries `power_l1/l2/l3` bindings, a convention any integration can adopt. Shipped in v1.30.0.                                                 |

## V1.31 — V1.34 — Camera, weather min/max, water heater

| #   | Title                  | Status | Summary                                                                                                                                                                                      |
| --- | ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 133 | Camera equipment type  | ✅     | Vendor-agnostic `camera` equipment with refreshed snapshot, on-demand HLS live view and optional monitoring/light/siren controls, all media proxied through the backend. Shipped in v1.31.0. |
| 134 | Weather daily min/max  | ✅     | Weather station equipments show today's measured min/max temperature, tracked by Sowel from received samples, reset at local midnight and persisted across restarts. Shipped in v1.32.0.     |
| 135 | Water heater equipment | ✅     | New `water_heater` equipment: ON/OFF via the standard relay channel, optional water temperature under its own alias, power/energy on metering relays. Shipped in v1.34.0.                    |

## V1.35 — Personal plugin sources

| #   | Title                   | Status | Summary                                                                                                                                                                                                                           |
| --- | ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 136 | Personal plugin sources | ✅     | Personal plugin sources, a third trust tier beside spec 089: admins add their own GitHub repos with a TOFU pinned SHA256, via `plugin_sources`, `PersonalSourceManager` and `/api/v1/plugins/sources` (#367). Shipped in v1.35.0. |

## V1.36 — Plugin categories, search, energy live metering

| #   | Title                            | Status | Summary                                                                                                                                                                                                               |
| --- | -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 137 | Plugins page categories + search | ✅     | Plugins page groups recipes under a closed `category` enum (registry + manifests) and adds a shared localized, diacritics-insensitive search; `getStore()` passes registry `i18n`/`tags` through. Shipped in v1.36.0. |

## V1.37 — Recipe tariff helper, zone-qualified pickers (upcoming)

| #   | Title                                          | Status | Summary                                                                                                                                                                                                                           |
| --- | ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 138 | Recipe tariff helper                           | ✅     | `ctx.helpers.getTariff()` gives recipes a read-only copy of the HP/HC schedule from the `TariffClassifier` (spec 126 pattern), without prices; `slotRanges()`/`isWithinSlot()` extracted (#379). Shipped in v1.37.0.              |
| 139 | Zone-qualified recipe pickers                  | ✅     | Recipe pickers label zones with the shortest ancestor suffix that separates homonyms, via `ui/src/lib/zone-path.ts` and shared picker components; UI-only (issue #385). Shipped in v1.37.1.                                       |
| 141 | Order delivery confirmation                    | ✅     | `OrderConfirmationTracker` checks each confirmable order is reflected in equipment data, else emits `equipment.order.unconfirmed`, raises a warning alarm and retries once on reconnect (issue #398). Shipped in v1.39.0.         |
| 142 | Zone paths in the equipments list              | ✅     | Administration › Équipements groups equipments by zone id with full-path headings in tree order (`groupEquipmentsByZone` in spec 139's `zone-path.ts`), so homonym zones no longer merge; UI-only. Shipped in v1.37.1.            |
| 143 | Low battery alerts                             | ✅     | New `BatteryMonitor` raises a system alarm when a battery device (`Device.powerSource`) runs low, weekly reminder, `sendSystemAlarm` to every publisher (spec 116, #348); `GET /devices/battery-alerts`. Shipped in v1.43.0.      |
| 144 | States and measurements on one Analyse chart   | ✅     | Analyse charts mix actuator states (`light_state`, `cover_state`…, now the `states` family) with measurements on a right-hand `[0, 1]` step axis; `familiesCompatible()` relaxes spec 118's F7 lock; UI-only. Shipped in v1.42.0. |
| 145 | Series colours and Y axes on the Analyse chart | ✅     | Analyse charts get persisted series colours (`SavedChartSeriesConfig.color`), a fit-to-data Y axis toggle (`SavedChartConfig.yAxisFit`) and a split left/right axis by unit for two quantities; UI-only. Shipped in v1.43.0.      |

| 146 | Confirmation before a sensitive gate action | ✅ | Shipped. See `specs/146-gate-action-confirmation/`. |
| 147 | Persist the activity feed and the arbiter decision journal | ✅ | Shipped. See `specs/147-persist-activity-arbiter-history/`. |
| 148 | Energy arbiter UI polish (design-system + redesigned timeline) | ✅ | Shipped. See `specs/148-arbiter-ui-polish/`. |
| 149 | Dashboard presentation resolver (phase 1) | ✅ | Shipped. See `specs/149-dashboard-presentation-resolver/`. |
| 150 | Typed value normalization + unified binding candidates | ✅ | One coercion authority (`shared/value-normalization.ts`) normalizes values at ingestion to the declared type, `computeBindingCandidates` becomes one shared module (`shared/binding-candidates.ts`) and `gate` binds any on/off relay. Shipped in v1.48.0. |
| 151 | Two-Factor Authentication (TOTP + Backup Codes) | ✅ | Shipped. See `specs/151-mfa-totp/`. |
| 152 | Equipment solar command channel | ✅ | Shipped in v1.52.0. See `specs/152-equipment-solar-command/`. |
| 153 | VMC (2-speed ventilation) equipment type | ✅ | New `vmc` equipment type (OFF / V1 / V2) binding relays under aliases `low` and `high`, with break-before-make speed orders in `src/equipments/vmc-controller.ts` and a full UI surface. Shipped in v1.52.0. |
| 154 | Per-equipment invert direction for shutter-family equipments | ✅ | Shipped in v1.52.5. See `specs/154-shutter-invert/`. |
| 155 | Invert Direction for Boolean Gate Triggers (issue #627) | ✅ | Shipped. See `specs/155-gate-invert-direction/`. |
| 156 | UPS (uninterruptible power supply) equipment type | ✅ | New read-only `ups` equipment type (`ups_status`, `battery_runtime`, `ups_load`), no orders, plugin declares `powerSource: "mains"` (specs 120, 143); companion plugin `sowel-plugin-nut`. Shipped in v1.53.0. |
| 157 | Shared FlowDiagram, UPS panel rebuilt on it | ✅ | Extracts the spec 148 Energy · Live power-routing diagram into a shared `FlowDiagram` (`ui/src/components/flow/`) and rebuilds the spec 156 UPS panel on it as three cards. Shipped in v1.54.0. |

## Spec 140 — Energy capacity arbiter (upcoming)

| #   | Title                                                                   | Status | Summary                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 140 | Energy capacity arbiter                                                 | ✅     | Core arbiter sharing solar surplus between flexible loads (reservations, priority list, `ctx.helpers.energy.claimCapacity()` recipe API, arbitration surface on Energy → Live); default off, phase 1 issues no orders. Shipped in v1.39.0.    |
| 158 | Arbiter baseline metrics                                                | ✅     | Daily baseline metrics for the spec 140 arbiter (short cycles, granted time, missed surplus) without touching `capacity-arbiter.ts`, via `GET /api/v1/energy/arbiter/metrics` and `scripts/energy/arbiter-metrics.ts`. Shipped in v1.55.0.    |
| 159 | Weather forecast: multi-model and ensemble confidence                   | ✅     | The weather forecast plugin averages several Open-Meteo models per variable and derives a high/moderate/low confidence pill and rain probability from the ensemble API (plugin 2.0.0/2.1.0). Shipped in v1.56.0.                              |
| 160 | PV production forecast                                                  | ✅     | Hourly PV production forecast to J+5 for declared roof planes, learned nightly from the installation's own history, with forecast points persisted for scoring; requires weather-forecast plugin 2.2.0. Shipped in v1.57.0.                   |
| 161 | Fit the PV model from existing history                                  | ✅     | Explicit action fitting the spec 160 PV model immediately from recorded production and past irradiance, bounded by an optional "unchanged since" date; requires weather-forecast plugin 2.3.0. Shipped in v1.57.0.                            |
| 162 | PV health: tell the household when the panels stop performing           | ✅     | Daily PV health check on the spec 160 forecaster: clear-midday performance ratio against a high-centile reference, persisted alert when the panels underperform (fault size, not which panel). Shipped in v1.58.0.                            |
| 163 | PV UI reorg: monitoring on the Production page, declaration in Settings | ✅     | Moves the specs 160/161/162 PV forecast and health panels to Energy → Production and the array declaration and backfill to Settings → Energy, with a `?tab=` deep link; no backend change. Shipped in v1.58.0.                                |
| 164 | Granted-but-idle on the arbiter timeline                                | ✅     | Arbiter timeline gains a `granted-idle` state from each granted load's own power, journaling `draw-stopped` / `draw-started` (#732, #631, #733); observation only, spec 158 metrics unchanged. Shipped in v1.59.0.                            |
| 165 | One load-state model for the arbitration surface                        | ✅     | One `ArbiterLoadState` model from `getPublicState()` feeds the arbiter roster and the spec 164 ribbon, one `arbiter.loadState.*` i18n root (spec 158, #732, #577); read-model and presentation only. Shipped in v1.59.0.                      |
| 166 | Claimant-declared need for a granted load                               | ✅     | `CapacityClaimHandle` gains `reportNeed(boolean)` so a claimant recipe declares whether its granted load needs power when it has no own meter; a fresh measurement always wins (amends spec 164, #732). Shipped in v1.60.0.                   |
| 167 | Documentation currency gates                                            | ✅     | Shipped. See `specs/167-documentation-currency/`.                                                                                                                                                                                             |
| 168 | Forecast widget: five-day strip and detail panel                        | ✅     | Shipped. See `specs/168-forecast-widget-five-days/`.                                                                                                                                                                                          |
| 169 | Dashboard tile for a recipe instance                                    | ✅     | Shipped. See `specs/169-dashboard-recipe-widget/`.                                                                                                                                                                                            |
| 170 | A zone sums the power its submeters measure                             | ✅     | Shipped. See `specs/170-zone-power-aggregate/`.                                                                                                                                                                                               |
| 171 | A click on a recipe tile fires its control                              | ✅     | A recipe tile (spec 169) with exactly one control fires it from the whole card (spec 098 pattern), confirmation decided by `tile.confirmFrom` (spec 146 `requireConfirmation`), `confirmParam` or `tile.confirm`. Shipped.                    |
| 172 | The updates panel can finish a personal update                          | ✅     | Shipped. See `specs/172-updates-sheet-personal-confirm/`.                                                                                                                                                                                     |
| 173 | A meter that sits inside another one                                    | ✅     | Shipped. See `specs/173-nested-submeters/`.                                                                                                                                                                                                   |
| 174 | A timed action on an actuable equipment                                 | ✅     | Phases 1 and 2: one persisted engine-owned revert per equipment (act now, revert after N minutes) via `executeOrder`, replacing clocks in `motion-light`, `state-trigger-light`, `delivery-gate` (specs 141, 150, 154, 149, #325).            |
| 175 | A power reading is judged on its own cadence                            | ✅     | Power freshness is derived from each source's observed or declared cadence and carried on the binding as `freshnessBudgetMs`, shared by all live surfaces; removes the `demand_5min` alias. Spec 116 status windows unchanged.                |
| 176 | A thermostat's run state has its own alias                              | ✅     | A submetered thermostat's on/off boolean binds under `state` (`appliance_state`, spec 152) instead of colliding with the spec 077 `power` wattage, fixing the never-settling toggle (#901, panasonic-cc 2.3.2).                               |
| 177 | What a thermostat is; extras rendered as extras                         | ✅     | Declares the thermostat core once in `src/shared/thermostat-contract.ts` (builds on spec 176), detects it by `setpoint` category, adds `operation_mode` and renders vendor extras generically; #919 part 1, #922 part 2.                      |
| 178 | Pressing again asks for longer, then gives up                           | ✅     | Amends spec 174: an equipment may declare a ladder of window lengths (`durationStepsMs`); each press climbs a rung (persisted in `timed_actions.step_index`) and a press past the top gives up the deadline without reverting.                |
| 179 | A meter fed by a separate supply                                        | ✅     | `Equipment.separateSupply` marks a meter fed by another utility supply; breakdown and the spec 117 live donut show it apart, kWh only, never priced (specs 123, 170), never a spec 173 parent (#523).                                         |
| 181 | Shared access: let someone open a gate, for a while                     | ✅     | Implemented on `feat/shared-access`, awaiting review on PR #970: opt-in core feature letting a non-user open a gate during set periods with a code or link, via a public page and a plugin API; supersedes #969.                              |
| 182 | EV charger equipment type                                               | ✅     | New `ev_charger` EquipmentType declared in `src/shared/ev-charger-contract.ts` (spec 177 pattern) with `ev_vehicle_state`, `ev_charge_current`, `ev_session_energy` and `set_ev_charge_current` categories; first device `sowel-plugin-tuya`. |
| 183 | Electric vehicle equipment type                                         | ✅     | New `electric_vehicle` EquipmentType declared by a contract module, with battery, range, plug, charge state and `wake`/`charge_start` orders and eleven `ev_*` categories; never a submeter; first plugin `sowel-plugin-renault`.             |
| 184 | Electric vehicle `refresh` order                                        | ✅     | Amends spec 183: optional momentary `refresh` order (category `ev_refresh`) asking the plugin to re-read the car's latest report without waking it.                                                                                           |
| 185 | Modulating capacity claim                                               | ✅     | Amends spec 140: a capacity claim may declare a range (`minW`, `maxW`, `stepW`) and receives a surplus-following budget via `onBudget`; first consumer is the EV charging recipe.                                                             |
| 186 | Rain gauge tile                                                         | ✅     | A rain-only `weather` equipment shows today's and 24 h rain on its tile, with 7/30-day totals and a histogram in its sheet; phase 2 keeps hourly rain a year in `sowel-rain-hourly`. Shipped in v1.74.0.                                      |

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
