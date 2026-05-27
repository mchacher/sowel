# Release notes

Sowel has been versioned and shipped through CI/CD since `v1.0.0` (April 2026, spec 055). Every release is published as:

- A signed GitHub release with a generated changelog — [github.com/mchacher/sowel/releases](https://github.com/mchacher/sowel/releases)
- A multi-arch Docker image tagged `ghcr.io/mchacher/sowel:<version>` and `:latest`

This page summarises every published version, newest first. For the full diff between two versions use `https://github.com/mchacher/sowel/compare/v<a>...v<b>`.

**Updating a running instance.** Sowel polls GitHub every hour and surfaces the available update in the topbar. Click the pill to open the updates sheet and apply the new version in one click (added in v1.9.0). On the command line: `cd /opt/sowel && docker compose pull && docker compose up -d`.

---

## 1.15.x — Live submeter breakdown

### v1.15.1 — 2026-05-27 { #v1-15-1 }

- Feature (API): new optional `?type=<EquipmentType>` query parameter on `GET /api/v1/equipments`. Returns only equipments of the requested type (e.g. `?type=energy_meter`). Unknown values return an empty list rather than a 400 so callers can safely forward user input. Lets memory-constrained clients (like the sowel-energy-display ESP32 firmware) drop a 100 KB payload to a few KB by asking only for the entries they need.

### v1.15.0 — 2026-05-27 { #v1-15-0 }

- Feature (Energy UI): a "Consumption breakdown" donut now sits below the Maison/Réseau/Solaire diagram on the Live page (spec 117). One segment per `energy_meter` submeter and an "Other" residual for what no clamp measures, sized by instantaneous power (W). Updates reactively from the existing equipments WebSocket stream, no new endpoint or DB change. Colors match the historical By-usage chart so a given clamp keeps the same color in both views. Offline submeters drop out of the donut but stay listed greyed in the legend.

## 1.14.x — Equipment availability

### v1.14.1 — 2026-05-26 { #v1-14-1 }

- Fix (UI): the "Total" label under the Production solar chart now equals the sum of the stacked bars (autoconsumption + grid injection). Previously the label was sourced from the raw inverter `energy` series while the bars summed the per-minute `autoconso` and `injection` series, and the two could drift by ~1 kWh per day because of cross-meter timing skew. Visual only, no data lost.

### v1.14.0 — 2026-05-26 { #v1-14-0 }

- Equipments: every equipment now exposes a derived `status` field (`online` / `degraded` / `offline`) computed in memory from the backing devices' `status` and the freshness of streaming bindings (spec 116). The UI ships ambre "Degraded" and red "Disconnected" badges on every surface where users see equipment values: compact zone rows (badge replaces controls when fully offline), equipment detail header, energy cumuls panel (with last-update caption), zone aggregation pills (`(N unavailable)` hint when an offline equipment was excluded from a metric). The Live Energy page gains a top banner that flags stale or disconnected meters explicitly. Triggered by a real bug: a Shelly Pro 3EM coupé au tableau kept the live energy graph displaying its last value as if it was live, with zero indication of staleness.
- Plugin contract: a new mandatory section in `plugin-development.md` documents that every plugin MUST keep `device.status` truthful via `updateDeviceStatus()`. A prod audit found 24 devices stuck at "online" with `lastSeen` between 1 hour and 49 days; those are upstream plugin bugs to fix (Z2M `availability` topic, MCZ Socket.IO disconnect, etc.), not Sowel core gaps. Sowel intentionally does not add a generic `device.lastSeen > timeout` watchdog because battery-powered Zigbee endpoints can stay silent for days without being offline.
- API: new `GET /api/v1/system/sunlight` endpoint exposing sunrise / sunset / isDaylight (#218). Also: `GET /equipments` and `GET /equipments/:id` payloads gain `status` + optional `statusReason`; `GET /zones/:id/aggregated` payload gains `unavailableEquipmentsByCategory`; WebSocket gains a new `equipment.status.changed` event broadcast on every transition.

## 1.13.x — Awning equipment

### v1.13.2 — 2026-05-24 { #v1-13-2 }

- Fix (zones): excluded `pool_cover` equipments from the shutter zone aggregates (`shuttersOpen` / `shuttersTotal` / `averageShutterPosition`). Pool covers share the `shutter_position` data category with shutters and were being counted, which surfaced phantom "all shutters" pills and bulk commands on Piscine zones (and their parent zones — e.g. an Outdoor → Pool subtree inherited them recursively). The `allShuttersOpen/Stop/Close` zone orders already targeted `type=shutter` only so executing the phantom command was a no-op — only the UI lied. The fix also makes awning and pool_cover exclusions uniform (positive `type === "shutter"` check).

### v1.13.1 — 2026-05-24 { #v1-13-1 }

- Fix (zones): dropped the `awningsDeployed` / `awningsTotal` zone aggregates that shipped by mistake with v1.13.0. Awnings reuse the `shutter_position` data category but are intentionally not aggregated at the zone level — the dashboard awning widgets compute their counts locally. The "Stores bannes X/Y" pill is removed from the zone view, and a regression assertion now guarantees awnings don't pollute the shutter aggregates either. Bulk zone commands (`allAwningsExtend/Stop/Retract`) are untouched.

### v1.13.0 — 2026-05-23 { #v1-13-0 }

- Equipments: new `awning` equipment type (spec 115), sibling of `shutter`. Same control surface (position 0–100 + OPEN/STOP/CLOSE), with awning-specific vocabulary throughout the UI: "Déployer / Rétracter" buttons, "Déployé / Rétracté" state pills, and a dedicated "Stores bannes" group in the zone view. The mapping is RF-up = retract (position 0), RF-down = deploy (position 100).
- UI: V3 awning illustration shipped across the dashboard (single-equipment widget, family widget, zone-family widget, mobile widget card, detail sheet slider) and the home view (compact card, hero icon, aggregation pills, group header). Open state = window + cassette + 10 trapezoidal scalloped stripes in Sowel primary blue / primary-light. Closed state = window + cassette + small retracted fringe. Two icon components: `AwningIcon` (24 viewBox, state-aware) for icon contexts, `AwningWidgetIcon` (56 viewBox, 120 px, gradient polish) for dashboard widgets.
- Fix: the awning detail page used to render an empty card — controls were gated on `isShutter` only, so `Extend/Stop/Retract` never showed. Same gate was missing on the single-equipment dashboard widget (showed only the position number, no icon). Both fixed.
- Plugin: new `somfy-rts` integration in the registry ([repo](https://github.com/mchacher/sowel-plugin-somfy-rts), v1.0.3). Bridges the open-source [somfyrts2mqtt](https://github.com/mchacher/somfyrts2mqtt) ESP32 + CC1101 hardware (v0.2.0+) into Sowel: auto-discovers Somfy RTS shutters and awnings from retained Tasmota SENSOR topics, parses position/direction/target, and dispatches OPEN/STOP/CLOSE + percentage to `cmnd/<root>/<remote>/...`.

## 1.12.x — Weather station UX

### v1.12.1 — 2026-05-20 { #v1-12-1 }

- Build: raised the PWA workbox precache cap to 5 MiB. The main UI bundle crossed the 2 MiB default after the spec 114 rework, which broke the v1.12.0 Docker build. No runtime change. A follow-up will split the bundle via `manualChunks` so the cap can come back down.

### v1.12.0 — 2026-05-20 { #v1-12-0 }

- UI: weather station rework (spec 114). The "Station Météo" widget now renders a clean 1×1 tile on both PC and mobile — outdoor temperature in big mono font + humidity below, nothing else — and a tap (or click on desktop) opens a drawer with the full reading. The drawer also surfaces the Sowel-computed `rain_24h` / `rain_1h` totals, so users whose Netatmo plugin only auto-bound the bare `rain` (mm/h) device-side still see the actual 24 h rainfall. The compact zone row now shows 4 values (temp / humidity / `mm/24h` rain / wind) with the same computed-data fallback. The equipment detail `WeatherPanel` injects the computed values into the rain module card too, and the wind module gained a small directional arrow + compass abbreviation derived from `wind_angle`.
- UI: history bar chart readability. On 7 d / 30 d ranges, raw hourly samples are now bucketed into daily totals (so a single rainy afternoon shows as one Thursday bar rather than two detached spikes labelled "jeu. 14" twice). Per-range tick cap (7 d → 7 labels, 30 d → 10), two-line X labels on 7 d (weekday + day), compact `DD/MM` on 30 d, responsive font size on mobile widths. Tooltip switches to "Thursday 14 May" on daily buckets.
- UI: PWA. Added the standard `mobile-web-app-capable` meta alongside the Apple-specific one to silence the Chrome deprecation warning in DevTools.

## 1.11.x — Plugin soft isolation

### v1.11.1 — 2026-05-19 { #v1-11-1 }

- Reliability: Sowel now installs process-wide handlers for `uncaughtException` and `unhandledRejection` (spec 112). When a throw escapes every other guard (a `setInterval` callback in the core, an unawaited promise in an MQTT publish, a native module surprise), the new handlers log a `fatal` entry with the full stack to stdout and to `data/logs/sowel.N.log`, then exit cleanly so Docker's restart policy reboots the container. Before, an uncaught crash left no trace and Docker just looped silently. After, every post-incident investigation has at minimum one log line to start from. No behavior change in the nominal path; the handlers are pure safety net.
- Security: new audit log persists every security-sensitive action in the new `audit_log` SQLite table (spec 113). Captured events cover authentication (login success/failure, logout, API token create/delete), user management (create/update/delete/password change), settings updates, mode activation/deactivation, backup export/restore, and plugin install/uninstall/update/enable/disable. Each entry records the actor (user id + username + token kind), source IP, action, target, and a JSON `meta` blob with redacted values for sensitive keys (`password`, `token`, `secret`, `apiKey`). A new admin-only endpoint `GET /api/v1/audit` exposes the trail with filters by actor, action prefix, and date range. Retention is 365 days, purged at boot.

### v1.11.0 — 2026-05-19 { #v1-11-0 }

- Security hardening: every integration plugin now runs with scoped Proxies on its `PluginDeps` (spec 111). Four invariants are enforced at the JS layer: a plugin can only read or write settings under its own `integration.<own-id>.` prefix (plus a small allowlist of globals like `home.latitude`), can only emit events from a `system.*` whitelist (no domain-event impersonation), can only mutate devices belonging to its own integration, and lifecycle method errors (`refresh`, `getStatus`, etc.) are confined with typed fallbacks instead of crashing the core. Validated locally against the 13 plugins of the registry with zero false positives. No breaking change for plugin authors: the `PluginDeps` shape and method signatures are bit-for-bit identical, so existing plugins keep working without modification. The isolation is unconditional in this release; there is no opt-out. Rollback is via Docker image downgrade.
- Audit: spec 089 (plugin supply-chain SHA256) plus spec 111 together close the dominant plugin threat vectors. Residual gaps (direct `better-sqlite3` access from a plugin, arbitrary `fetch`, infinite loops, `process.exit`) require hard isolation via worker threads and are documented as out of scope until the registry grows past trusted owners.
- Docs: new "Plugin scoping" section in `plugin-development.md` (EN+FR) explaining the four invariants for plugin authors, the explicit allowlists in `scoped-deps.ts`, and what the Proxy does not protect against.

## 1.10.x — Changelog at your fingertips

### v1.10.3 — 2026-05-17 { #v1-10-3 }

- Refactor: every binding resolution across the UI and the recipe engine now goes through a shared category-first resolver. Manually re-bound equipments (where the alias defaults to the device key) keep working everywhere: zone view, equipment detail, mobile dashboard sheet, mobile direct toggle, close-all-valves, and recipe-driven dispatch (motion-light, switch-light, presence-heater, state-trigger-light). Closes the latent bug class behind the v1.10.2 pool-cover incident. Spec 110.

### v1.10.2 — 2026-05-17 { #v1-10-2 }

- Fix: the pool pump's ON/OFF toggle no longer wraps to a second line under the icon in the compact zone view.
- Fix: pool cover (and any shutter) OPEN/STOP/CLOSE buttons reappear in the zone compact view, the mobile dashboard sheet, and the equipment detail page when the binding was created with the device key as alias (e.g. after a manual re-bind through the UI). The controls now resolve the move/position bindings by category, mirroring the dashboard widget's existing logic.

### v1.10.1 — 2026-05-17 { #v1-10-1 }

- Fix: a partial discovery announcement from an integration plugin no longer silently destroys equipment bindings. Before, if a Tasmota / Zigbee2MQTT / etc. device temporarily failed to advertise one of its keys on reconnect, the `device_data` / `device_orders` row was deleted and the FK CASCADE wiped any equipment binding to it. The pool cover lost its open/close command this way after the v1.10.0 restart. Bound rows are now preserved across partial re-discoveries; only truly orphaned rows are still cleaned up (spec 109).

### v1.10.0 — 2026-05-17 { #v1-10-0 }

- Each row of the topbar updates sheet now exposes a discreet changelog icon next to the Update button. Click it to open the matching release notes (this page for Sowel core, the plugin's GitHub release page for plugins) in a new tab. No more clicking blindly through versions (spec 107).
- Release Notes moved into the User Guide table of contents.
- CI now refuses to publish a release unless this page has an entry for the new version in both EN and FR (spec 108). Side effect: every in-app "View changes" link is guaranteed to land on a populated section.

---

## 1.9.x — Actionable updates pill

### v1.9.0 — 2026-05-17 { #v1-9-0 }

- Topbar updates pill now opens an `UpdatesSheet` listing Sowel core + outdated plugins, with a one-click `Update` button per row (spec 106). Replaces the old blind redirect to `/plugins`, which left core updates invisible.

---

## 1.8.x — Charts & activity feed

### v1.8.1 — 2026-05-17 { #v1-8-1 }

- Time-series charts now use a linear time scale on the X axis. Motion / contact / sparse weather data is no longer visually compressed when events are bunched in time.

### v1.8.0 — 2026-05-16 { #v1-8-0 }

- New activity feed in zone view (spec 101). Shows the last 24 h of events with a responsive cap (10 on mobile, 100 on desktop), filtered by binding category and scoped to the current zone.

---

## 1.7.x — WAN hardening

### v1.7.0 — 2026-05-15 { #v1-7-0 }

- WAN hardening (spec 105): CSP and WebSocket Origin check tightened for safe public exposure behind a Cloudflare tunnel. Google Fonts allow-listed for the Nunito heading font. Docker socket accessible to the non-root `sowel` user.
- CI: native ARM64 GitHub runner with parallel builds — multi-arch release time dropped from ~15 min to ~3 min.

---

## 1.6.x — Design system + plugin supply chain

### v1.6.6 — 2026-05-15 { #v1-6-6 }

- Setup wizard auto-triggers the restart after submit; unified decimal separator for latitude/longitude inputs.
- CI: GHCR retention policy — old container versions auto-pruned on each release.

### v1.6.5 — 2026-05-15 { #v1-6-5 }

- First-login Home setup wizard. Restart helper now passes `--force-recreate` so it actually restarts.

### v1.6.4 — 2026-05-15 { #v1-6-4 }

- Plugin install only refuses _escaping_ symlinks now; internal symlinks are allowed (spec 089 C1).

### v1.6.3 — 2026-05-14 { #v1-6-3 }

- Self-update normalises the compose file to `:latest`, force-recreates the container, and verifies the new version (spec 104).
- CI: GitHub Release creation gated behind successful ARM64 build.

### v1.6.2 — 2026-05-14 { #v1-6-2 }

- Plugin supply chain hardening (spec 089 C1+C2): SHA256 hashes pinned in the registry, community-namespace install confirmation, restore path confinement, extension whitelist, symlink refusal, size cap.

### v1.6.1 — 2026-05-14 { #v1-6-1 }

- Docker build fix — `design-system/` is now copied into the UI build stage.

### v1.6.0 — 2026-05-14 { #v1-6-0 }

- Major UI overhaul to design-system parity (specs 094–100):
  - New design-system palette and tokens
  - Sidebar refactored into reusable components
  - Zone view 2-column layout on desktop with cluster aggregation strip and variant pills
  - Icon-only zone command toolbar
  - Dashboard widget chrome unified
  - Typography polish (letter-spacing, H1 standardisation, tabular nums by default)
  - Equipment row chrome refactor and light-on glow
  - Strict mock alignment on zone panels, mobile parity with mockup
- One-command installer (`install.sh`) added.

---

## 1.5.x — Energy & recipes expansion

### v1.5.10 — 2026-05-10 { #v1-5-10 }

- Internal docs revert.

### v1.5.9 — 2026-05-09 { #v1-5-9 }

- Recipe picker rewritten as a compact popover (side-positioned on desktop, bottom sheet on mobile). Pastel palette + rounded corners on the by-usage energy chart.

### v1.5.8 — 2026-05-08 { #v1-5-8 }

- New `state-trigger-light` recipe (spec 092). Recipe slots gain `crossZone` and `includeDescendants` constraints, plus a zone-first picker for single-equipment slots.

### v1.5.7 — 2026-05-08 { #v1-5-7 }

- Power-only submeters and a by-usage energy breakdown chart (spec 091). Submeter cumulative Wh exposed as computed equipment data.

### v1.5.6 — 2026-05-03 { #v1-5-6 }

- Per-mapping enable/disable toggle on MQTT publishers (spec 090).

### v1.5.5 — 2026-05-03 { #v1-5-5 }

- Plugin hot-load: transitive imports cache-busted.

### v1.5.4 — 2026-05-03 { #v1-5-4 }

- Plugin API: `getDeviceDataLastUpdated` getter exposed; `shelly_mqtt` registry bump.

### v1.5.3 — 2026-05-03 { #v1-5-3 }

- Energy production query falls back to the hourly bucket when raw is missing. Consumption tooltip splits HP/HC into grid-only + autoconsumption.

### v1.5.2 — 2026-05-03 { #v1-5-2 }

- Compact header pills replace the alarm banner and integration warning. Live-energy status splits by which source dominates the supply. Plugin unload always calls `stop()`.

### v1.5.1 — 2026-05-03 { #v1-5-1 }

- Self-consumption writer (spec 086 steps E+F), plus aggregator/history bug fixes. New `getDeviceDataValue` getter for plugin baseline hydration.

### v1.5.0 — 2026-05-02 { #v1-5-0 }

- Live power-flow page (`/energy/live`) with auto-detection of sources. Shelly MQTT plugin added to the registry. History migration tool for orphaned equipments.

---

## 1.4.x — Pool heat pump

### v1.4.2 — 2026-05-01 { #v1-4-2 }

- Mobile dashboard renders pool heat pump like a thermostat. Disabled integrations stay visible on the Integrations page. Enable/disable toggle surfaced directly on the row.

### v1.4.1 — 2026-05-01 { #v1-4-1 }

- Persistent Disable/Enable toggle on the integration drawer. Old `ghcr.io/mchacher/sowel` images auto-pruned after self-update.

### v1.4.0 — 2026-05-01 { #v1-4-0 }

- New `pool_heat_pump` equipment type plus the Modbus plugin scaffolding it relies on.

---

## 1.3.x — Pool equipments

### v1.3.2 — 2026-04-19 { #v1-3-2 }

- Alarm reminder logic moved into the Telegram notification publisher (spec 083). Theme-aware fills for the pool pump icon (dark mode). Open/Closed pill in compact shutter and pool cover cards.

### v1.3.1 — 2026-04-19 { #v1-3-1 }

- Recipe slot layout: equal-width columns for homogeneous pairs.

### v1.3.0 — 2026-04-19 { #v1-3-0 }

- New `pool_pump` and `pool_cover` equipment types (spec 081), with inline controls in the compact zone view and a dedicated channel picker on the device side. Multi-channel devices can now back multiple equipments. Plugin registry can be reloaded on demand from the UI.

---

## 1.2.x — Equipment dispatch v2 + domain categories

### v1.2.15 — 2026-04-19 { #v1-2-15 }

- Tasmota plugin registered v1.0.0 (spec 080). Plugin `install()` redirects to `update()` on reinstall.

### v1.2.14 — 2026-04-18 { #v1-2-14 }

- Devices store enum values; UI surfaces dynamic action values (spec 079). New `zone_order` button effect type with zone-first equipment selection (spec 078).

### v1.2.13 — 2026-04-18 { #v1-2-13 }

- Refactor: `dispatchConfig`, `apiVersion`, brute-force fallback removed (spec 074). v2 dispatch is now the only path.

### v1.2.12 — 2026-04-18 { #v1-2-12 }

- Order categories for zone-order resolution (spec 077). New outdoor temperature/humidity categories and updated `netatmo-weather` plugin (spec 076).

### v1.2.11 — 2026-04-18 { #v1-2-11 }

- New domain categories for `media_player`, `appliance`, and `thermostat` (spec 073).

### v1.2.10 — 2026-04-18 { #v1-2-10 }

- Thermostat zone order resolves through the setpoint category (spec 070).

### v1.2.9 — 2026-04-18 { #v1-2-9 }

- Zone orders resolve aliases by category instead of hardcoded names (spec 069).

### v1.2.8 — 2026-04-18 { #v1-2-8 }

- Order dispatch v2 — plugins receive `orderKey` directly instead of a `dispatchConfig` blob (spec 067).

### v1.2.7 — 2026-04-15 { #v1-2-7 }

- Shutter zone orders use the OPEN/CLOSE state instead of a position.

### v1.2.6 — 2026-04-12 { #v1-2-6 }

- New `onChangeOnly` option on MQTT publishers.

### v1.2.5 — 2026-04-12 { #v1-2-5 }

- Restore snapshot on every reconnect — reverts the v1.2.4 change after side effects.

### v1.2.4 — 2026-04-12 { #v1-2-4 }

- MQTT publishers no longer loop on snapshot when the broker reconnects; re-publish on mapping change.

### v1.2.3 — 2026-04-12 { #v1-2-3 }

- Removed the PID file lock — it caused a Docker crash loop on container restart.

### v1.2.2 — 2026-04-12 { #v1-2-2 }

- Internal cleanup.

### v1.2.1 — 2026-04-12 { #v1-2-1 }

- Self-update helper container preserves the host compose `working_dir`.

### v1.2.0 — 2026-04-12 { #v1-2-0 }

- Plugin registry decoupled from the Sowel release cadence + `sowelVersion` compatibility field (spec 066).

---

## 1.1.x — Water + freecooling

### v1.1.7 — 2026-04-12 { #v1-1-7 }

- Update badges and buttons now use red instead of amber.

### v1.1.6 — 2026-04-12 { #v1-1-6 }

- Internal cleanup.

### v1.1.5 — 2026-04-12 { #v1-1-5 }

- Self-update helper container keeps `AutoRemove` off temporarily for debugging.

### v1.1.4 — 2026-04-12 { #v1-1-4 }

- Internal cleanup.

### v1.1.3 — 2026-04-12 { #v1-1-3 }

- Self-update pulls by version tag instead of `:latest` (avoids racing with concurrent releases).

### v1.1.2 — 2026-04-12 { #v1-1-2 }

- New freecooling recipe — closes shutters before sunrise (spec 065).

### v1.1.1 — 2026-04-12 { #v1-1-1 }

- Recipe packages can hot-install and hot-update without engine restart.

### v1.1.0 — 2026-04-12 { #v1-1-0 }

- New `water_valve` equipment type (spec 062) and auto-watering recipe (spec 063).
- Computed weather data: rain-1h / rain-24h plus cumulative bar charts (spec 064).
- Timezone is now auto-derived from the home location (spec 061), with a safe fallback when the settings table is missing on a fresh install.
- Recipe UX polish, clock seconds, plugin auto-start after install/update.

---

## 1.0.x — First versioned releases

### v1.0.8 — 2026-04-11 { #v1-0-8 }

- Internal cleanup.

### v1.0.7 — 2026-04-11 { #v1-0-7 }

- Self-update helper container pattern + detection improvements (spec 060).

### v1.0.6 — 2026-04-11 { #v1-0-6 }

- Internal cleanup.

### v1.0.5 — 2026-04-06 { #v1-0-5 }

- Remote plugin registry, fetched at runtime with local fallback (spec 059).
- Docker base image switched to Debian Trixie for Python 3.13+ (Panasonic Comfort Cloud bridge compatibility).
- CI builds `amd64` only at this stage (~5 min vs ~15 min), with ARM64 added back later.
- Semver-aware comparison for plugin updates.

### v1.0.4 — 2026-04-06 { #v1-0-4 }

- Internal cleanup.

### v1.0.3 — 2026-04-06 { #v1-0-3 }

- Backup line-protocol export handles non-string InfluxDB values. Restore clears `recipe_log` to avoid orphan FK refs. Docker runtime keeps `python3` for the Panasonic Comfort Cloud plugin bridge.

### v1.0.2 — 2026-04-06 { #v1-0-2 }

- Backup now includes `refresh_tokens` so a restored instance keeps users logged in.

### v1.0.1 — 2026-04-06 { #v1-0-1 }

- Backup `PRAGMA foreign_keys` moved outside the SQLite transaction (it had no effect inside).

### v1.0.0 — 2026-04-06 { #v1-0-0 }

- First versioned release. Adds `package.json` versioning, the Dockerfile, the GitHub Actions release pipeline, and the reference `docker-compose.yml` (spec 055). Everything before this point lives in pre-release git history only.
