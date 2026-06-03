# Spec 124 — Shadow mode

## Context

The shadow-instance playbook in `scripts/howto-shadow.md` (added alongside spec 123) describes how to test a candidate build against a copy of production state. The procedure works, but it has a dangerous gap: the production backup carries `enabled = 1` on every plugin / recipe instance / publisher row, so the shadow's _first restart after restore_ boots all of those subsystems and connects out — duplicating MQTT subscriptions, polling cloud APIs, rotating OAuth refresh tokens (silently kicking production off), and firing notifications and device orders.

Today the only way to avoid this is a manual SQL session between the restore and the restart. That step is easy to forget. Spec 124 turns it into a single env var, evaluated at boot, so the inert state is impossible to miss.

## Goals

- A single environment variable `SOWEL_SHADOW_MODE=1` makes a Sowel container safe to run against a copy of production data with zero risk of touching production.
- The shadow is fully usable as a UI: dashboard, energy page, equipments, history — everything that reads state still works.
- The mode is **discoverable** at every layer: in the logs at boot, on every UI page (sticky banner), and via the API (`GET /api/v1/system/mode`).

## Non-goals

- **Not a production-side feature.** Shadow mode is a dev / staging facility. It is not used on `sowelox`.
- **No SQLite mutation.** The flag gates **runtime** lifecycle calls; on-disk `enabled` values are left intact so removing the env var restores normal behaviour on the next boot. This is the inverse property of the manual SQL approach we're replacing.
- **No partial mode.** Either every outbound subsystem is off, or none is. Granular toggles (e.g. "shadow but allow Telegram") add complexity for no testing benefit.
- **No write protection on InfluxDB.** The shadow has its own InfluxDB (per the playbook); writes are still allowed because the history writer / energy aggregators are useful for UI testing.
- **No runtime opt-in.** Once a shadow is running, an admin clicking _Enable plugin_ in the UI will NOT boot the plugin. The runtime gate is enforced. This is the property that makes shadow mode trustworthy.

## Requirements

### R1 — Boot detection

`SOWEL_SHADOW_MODE` is read once at boot in `src/config.ts`. Truthy values: `1`, `true`, `yes` (case-insensitive). Everything else (unset, `0`, empty, garbage) means normal mode. The resolved boolean is added to `AppConfig.shadowMode` and propagated through dependencies.

### R2 — Lifecycle gates (the inert invariant)

When `shadowMode === true`, the following lifecycle calls in `src/index.ts` MUST be skipped:

| Call                                | What gets disabled                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pluginLoader.loadAll()`            | No integration plugin is instantiated or started. No MQTT connect, no cloud poll, no OAuth refresh, no incoming events. |
| `recipeLoader.loadAll()`            | No recipe package is loaded into the runtime.                                                                           |
| `recipeManager.init()`              | No recipe instance is restored or started.                                                                              |
| `mqttPublishService.init()`         | No outbound MQTT publisher connects to its broker.                                                                      |
| `notificationPublishService.init()` | No notification publisher subscribes to events.                                                                         |
| `versionChecker.start()`            | No hourly GitHub poll (less critical but consistent with "no outbound").                                                |

Skipping is done at the call site (one-liner `if (!shadowMode) ...`). The constructors still run so the dependencies are satisfied — this keeps the rest of the codebase unchanged.

### R3 — Runtime gate on plugin start

`PluginLoader` exposes a method that the API uses when the user toggles a plugin from the UI (`enable plugin`, `install plugin`, etc.). When `shadowMode === true`, this method MUST be a no-op that logs a warning and returns. The API route stays mounted (no 403) so the UI does not break; the user just sees the plugin stay disabled. This closes the in-UI footgun: an admin clicking _Enable_ on a plugin while in shadow mode does NOT cause a connection out.

Recipe instance start, MQTT publisher enable, and notification publisher enable get the same treatment, one runtime gate per manager.

### R4 — Boot-time log banner

When shadow mode is active, the boot sequence logs a single multi-line `warn` line with `module: "shadow-mode"` and structured context including:

- `hostname` (so the operator can verify they are not on sowelox)
- a short prose summary ("outbound subsystems disabled; restore-safe inert instance").

The line is meant to be visible in `docker logs sowel` even after rotation, and to trip log alerting if shadow mode were ever activated on production by accident.

### R5 — API surface

A new endpoint `GET /api/v1/system/mode` MUST return `{ shadowMode: boolean }`, accessible to any authenticated user. The UI calls it once on app mount.

### R6 — UI banner

When `shadowMode === true`, every page in the UI MUST render a sticky banner at the top with:

- An attention colour (warning amber, matching the existing `alarms.pill` palette so it does not look out of place)
- Localized text: `SHADOW MODE — outbound integrations and publishers are disabled. This instance does not affect production.` (EN) / `MODE SHADOW — les intégrations sortantes et les publishers sont désactivés. Cette instance n'a aucun effet sur la production.` (FR)
- No close button: this banner is informational, not dismissable, because dismissing it is exactly the thing we want to prevent.

Implementation: a `<ShadowBanner />` component rendered above the routing outlet in `AppShell.tsx` (or whichever top-level layout component owns the page chrome).

### R7 — Update playbook

After this spec ships:

- `scripts/howto-shadow.md` is rewritten so that step 4 ("Lock the shadow into an inert state") becomes a single line: `-e SOWEL_SHADOW_MODE=1`. The SQL fallback stays documented as a recovery path in case someone runs an older image without the flag.
- A new section "What shadow mode does NOT prevent" lists the residual risks (e.g. an InfluxDB pointed at prod would still write — the playbook still mandates a separate Influx).

## Acceptance criteria

- [x] `SOWEL_SHADOW_MODE=1` on a normally configured Sowel boots the HTTP server, mounts the routes, but never:
  - connects an integration plugin to anything,
  - connects an MQTT publisher,
  - subscribes a notification publisher,
  - polls GitHub for updates,
  - starts a recipe instance.
- [x] The boot log includes one `warn` line `module: "shadow-mode"` with the hostname.
- [x] `GET /api/v1/system/mode` returns `{ shadowMode: true }` when the env var is set, `{ shadowMode: false }` otherwise.
- [x] Toggling a plugin to `enabled = 1` via the API while in shadow mode does NOT start the plugin; the API returns 200 and persists the row, but the plugin stays inert.
- [x] The UI shows a sticky amber banner on every page when shadow mode is active.
- [x] Removing the env var on the next boot restores normal behaviour with no SQLite migration / fixup needed.
- [x] `SOWEL_SHADOW_MODE` accepts `1`, `true`, `yes` (case-insensitive). Any other value is treated as off.
- [x] All existing tests still pass. New tests cover the boot-config resolution and the runtime gate on `pluginLoader.start()`.
- [x] Release notes entry added for the version that ships this.

## Edge cases

| Case                                                    | Expected                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SOWEL_SHADOW_MODE` unset                               | Normal mode, no banner, no log line                                           |
| `SOWEL_SHADOW_MODE=0`                                   | Normal mode                                                                   |
| `SOWEL_SHADOW_MODE=true`                                | Shadow mode active                                                            |
| `SOWEL_SHADOW_MODE=garbage`                             | Normal mode (defensive: only known truthy values trip it)                     |
| Shadow boots over a backup with `plugins.enabled = 1`   | Plugins stay inert; UI shows them as enabled but disconnected; banner visible |
| Admin clicks "Enable plugin X" in shadow UI             | API persists `enabled = 1`, plugin does NOT start, banner stays               |
| Admin clicks "Update Sowel" in shadow UI                | Stays on the same image; version checker is off so no "update available" pill |
| Backup / restore inside the shadow                      | Works normally (BackupManager is independent of plugin lifecycle)             |
| WebSocket connection to shadow                          | Works, but never delivers integration events (no plugin emits them)           |
| User forgets to use a dedicated Influx (points at prod) | Shadow mode does NOT protect against this — documented in the playbook        |

## Stakeholders

- Sowel maintainer (the user): the operator running shadow tests.
- Future AI agents: shadow mode is the primary mechanism to validate a change against real data before release; agents should propose it whenever a change benefits from prod-data validation.
