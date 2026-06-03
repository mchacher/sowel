# Spec 124 — Implementation plan

## Tasks (in strict order)

### Backend — config

1. [x] Extend `AppConfig` in `src/shared/types.ts` with `shadowMode: boolean`.
2. [x] Add `envBool` helper in `src/config.ts` and read `SOWEL_SHADOW_MODE`. Return it in `loadConfig()`.
3. [x] Cover the env-var resolution in `src/config.test.ts` (truth table).

### Backend — boot gates

4. [x] In `src/index.ts`, very early after `loadConfig()`, emit the `warn` banner when `config.shadowMode === true` (include `os.hostname()`, version).
5. [x] Gate `pluginLoader.loadAll()`.
6. [x] Gate `recipeLoader.loadAll()`.
7. [x] Gate `recipeManager.init()`.
8. [x] Gate `mqttPublishService.init()`.
9. [x] Gate `notificationPublishService.init()`.
10. [x] Gate `versionChecker.start()`.

### Backend — runtime gates

11. [x] `PluginLoader` constructor takes `shadowMode: boolean`. `start(pluginId)` early-returns with a warn log when shadow mode is on.
12. [x] Same for `RecipeManager.startInstance` (or its public start entrypoint).
13. [x] Same for `MqttPublisherManager.start`.
14. [x] Same for `NotificationPublisherManager.start`.

### Backend — API

15. [x] `GET /api/v1/system/mode` in `src/api/routes/system.ts`, returning `{ shadowMode: boolean }`. Auth required.
16. [x] Pass `config` (or `config.shadowMode`) into `registerSystemRoutes` deps.
17. [x] Add the route to `src/api/routes/system.test.ts`.

### Tests

18. [x] Cover `PluginLoader.start` runtime gate with a small unit test (constructor with `shadowMode: true` ⇒ `start()` is a no-op + warn log).
19. [x] Add a smoke test that booting `loadConfig()` with `SOWEL_SHADOW_MODE=1` produces `config.shadowMode === true` and `=garbage` produces `false`.

### Frontend

20. [x] `getSystemMode()` in `ui/src/api.ts`.
21. [x] `useShadowMode` Zustand store in `ui/src/store/useShadowMode.ts`.
22. [x] `<ShadowBanner />` component in `ui/src/components/layout/ShadowBanner.tsx`.
23. [x] Mount the banner once in `AppShell.tsx`, call `useShadowMode.fetch()` on mount.
24. [x] FR + EN i18n keys for `shadow.banner`.

### Docs & release

25. [x] Rewrite step 4 of `scripts/howto-shadow.md` ("Lock the shadow into an inert state") so the inert state is now `-e SOWEL_SHADOW_MODE=1`. Keep the SQL fallback as a recovery section labelled "If you have to use an older image".
26. [x] Add a "What shadow mode does NOT prevent" section in the playbook (Influx pollution, MQTT broker pointed at prod, etc.).
27. [x] Add the `GET /api/v1/system/mode` row to `docs/technical/api-reference.{md,fr.md}`.
28. [x] Add a release-notes entry under v1.X.Y in `docs/release-notes.{md,fr.md}` (spec 108 enforcement).
29. [x] Mark acceptance criteria `[x]` in `spec.md`, tasks `[x]` in this file.

### Validate

30. [x] `npx tsc --noEmit` — zero errors.
31. [x] `cd ui && npx tsc -b --noEmit` — zero errors.
32. [x] `npx vitest run` — all tests pass.
33. [x] `npx eslint src/ --ext .ts` — zero errors.

---

## Test Plan

### Modules to test

- `src/config.ts` — env-var resolution.
- `src/plugins/plugin-loader.ts` — runtime gate.
- `src/api/routes/system.ts` — new endpoint.

### §1 — `config.test.ts` (extends existing file)

| Scenario                                  | Expected               |
| ----------------------------------------- | ---------------------- |
| `SOWEL_SHADOW_MODE` unset                 | `shadowMode === false` |
| `SOWEL_SHADOW_MODE=""`                    | `shadowMode === false` |
| `SOWEL_SHADOW_MODE=0`                     | `shadowMode === false` |
| `SOWEL_SHADOW_MODE=1`                     | `shadowMode === true`  |
| `SOWEL_SHADOW_MODE=true` (lowercase)      | `shadowMode === true`  |
| `SOWEL_SHADOW_MODE=TRUE` (uppercase)      | `shadowMode === true`  |
| `SOWEL_SHADOW_MODE=yes`                   | `shadowMode === true`  |
| `SOWEL_SHADOW_MODE=garbage`               | `shadowMode === false` |
| `SOWEL_SHADOW_MODE=  TRUE  ` (whitespace) | `shadowMode === true`  |

### §2 — `plugin-loader.test.ts` (new or extends)

| Scenario                                                    | Expected                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `shadowMode = true`, `start("foo")` called                  | Returns without invoking the underlying plugin start; emits warn log    |
| `shadowMode = false`, `start("foo")` called                 | Existing behaviour (delegates to the plugin's start)                    |
| `shadowMode = true`, `start("foo")` called on an unknown id | Still returns without throwing (early-return short-circuits the lookup) |

### §3 — `system.test.ts` (extends existing file)

| Scenario                                                            | Expected                    |
| ------------------------------------------------------------------- | --------------------------- |
| `GET /api/v1/system/mode` unauthenticated                           | 401                         |
| `GET /api/v1/system/mode` with `shadowMode === false` in app config | `200 { shadowMode: false }` |
| `GET /api/v1/system/mode` with `shadowMode === true` in app config  | `200 { shadowMode: true }`  |

### §4 — Retro-compat

| Module                      | Scenario                                       | Expected                                                                         |
| --------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `loadConfig`                | No `SOWEL_SHADOW_MODE` in env                  | Resolved config equals pre-spec-124 byte for byte except new `shadowMode: false` |
| `PluginLoader.start`        | Existing call sites with no `shadowMode` value | Default to `false`; behaviour unchanged                                          |
| `RecipeManager`, MQTT, etc. | Same                                           | Same                                                                             |

### §5 — Manual verification before merge

- Boot Sowel locally with `SOWEL_SHADOW_MODE=1`. Verify:
  - `warn` banner present in stdout with module `shadow-mode` and the hostname.
  - HTTP server up, login works.
  - No plugin in the _Integrations_ page shows as connected.
  - `curl http://localhost:3000/api/v1/system/mode` returns `{ shadowMode: true }`.
  - UI displays the amber banner on the dashboard and every other page.
  - Enabling a plugin via the UI: row persists, plugin stays inert, banner stays.
- Boot Sowel locally without the env var. Verify behaviour unchanged.
- Boot with `SOWEL_SHADOW_MODE=garbage`. Verify shadowMode is off (defensive).
- Use the updated playbook to spin up a shadow against a sowelox backup. Confirm prod sees no MQTT reconnect storm, no OAuth refresh, no notification duplication.
