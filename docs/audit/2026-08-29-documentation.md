# Documentation audit — 2026-08-29 (state: v1.62.0)

Full review of `docs/` against `src/`, `ui/src/`, `migrations/`, `plugins/registry.json`,
`scripts/`, `.github/workflows/` and `git log`. Nothing was changed: this is the work list.

**This file is the brief for the remediation work.** It is written to be picked up by a
session that has no memory of the review, so every finding carries the doc location, the
contradicting source location, and what the truth is.

`docs/audit/` is in `mkdocs.yml`'s `exclude_docs`, so this page is not published.

---

## How to read the confidence markers

| Marker  | Meaning                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[V]** | Verified by hand during the review session. Act on it directly.                                                                                      |
| **[R]** | Reported by the review agent with a cited source line, not independently re-checked. Re-verify the specific claim before editing, it costs one grep. |
| **[?]** | Flagged as suspicious but explicitly unconfirmed (usually a measurement). Needs a decision, not a grep.                                              |

Do not skip re-verification on **[R]** items. The agent was accurate on everything spot-checked,
but the whole point of this exercise is that confidently-wrong documentation is the expensive
kind, and replacing one wrong statement with another wrong statement is the worst outcome.

---

## Ordering: do these in this order

| #   | PR                                         | Size | Why here                                                |
| --- | ------------------------------------------ | ---- | ------------------------------------------------------- |
| 1   | Stop publishing the legacy tree            | XS   | Free, and stops serving wrong content immediately       |
| 2   | Correct the plugin author contract         | L    | **Highest value.** Widest blast radius, outside readers |
| 3   | Activity feed is persistent                | S    | Tiny, corrects a user-facing falsehood                  |
| 4   | Resolve the French data model              | M    | Removes a phantom product                               |
| 5   | Correct `architecture.md` against the code | M    |                                                         |
| 6   | API + data-model reference                 | L    |                                                         |
| 7   | User guide catches up with v1.53–v1.62     | L    | Splittable                                              |

PRs 2, 5 and 6 touch disjoint files and can run in parallel. Screenshots are **not** in any
PR: see the last section.

---

## PR 1 — `fix(docs): stop publishing the legacy tree` (XS)

**[V]** `mkdocs.yml:68-70` `exclude_docs` lists only `audit/` and `planning/`. So
`docs/_legacy/` (8 files), `docs/sowel-spec.md`, `docs/fixtures/` and `docs/mockups/` are
built, indexed and in `sitemap.xml` under `https://docs.sowel.org/_legacy/…`.

**[R]** Measured on the built site: 429 of 1981 search-index entries (22 %) come from
`_legacy/` and `sowel-spec.md`. Someone searching "plugin development", "equipment types" or
"data model" can land on the superseded page. Only `sowel-spec.md` carries a "LEGACY
DOCUMENT" banner; none of the eight `_legacy/*.md` files does.

Do:

1. Add `_legacy/`, `mockups/`, `fixtures/` to `exclude_docs`.
2. Add a `validation:` block promoting `links.anchors` and `links.not_found` to `warn`, so
   `mkdocs build --strict` fails on them instead of printing INFO. **[V]** Today the build
   passes with two broken anchors precisely because there is no `validation:` block.
3. Fix the two known anchors:
   - **[V]** `technical/deployment.md` → `architecture.md#timezone-handling`. The heading is
     `## Timezone handling (spec 061)`, so the slug is `timezone-handling-spec-061`. Give the
     heading an explicit `{ #timezone-handling }` rather than changing the link.
   - **[V]** `technical/data-model/recipes.md` → `../data-model.md#3-plugin`. FR only: EN
     section 3 is "Plugin", the FR monolith's section 3 is "Zone". PR 4 fixes this properly;
     point at the EN hub in the meantime.

**[R]** Independent check over the rendered HTML of all 89 pages found **exactly these two**
link/anchor problems and no others. No missing images.

---

## PR 2 — `fix(docs): correct the plugin author contract` (L) ← do this one if only one gets done

Single file: `docs/technical/plugin-development.md` (and `.fr.md` where the section exists).

A plugin author who follows this guide end to end ships a plugin that installs, connects,
discovers devices, and then **silently fails to actuate anything**. It is also the document
most likely to be read by someone outside the project.

### 2a. `executeOrder`'s signature is wrong in six places **[V]**

```
doc  (:354, :533, :638, :898, :908, :1247)
  executeOrder(device: Device, dispatchConfig: Record<string, unknown>, value: unknown)

code (src/integrations/integration-registry.ts:41, call site :269)
  executeOrder(device: Device, orderKey: string, value: unknown)
```

Confirmed against a real shipped plugin: `sowel-plugin-smartthings/dist/index.js:444` is
`async executeOrder(device, orderKey, value)`.

The doc's worked example at `:913` does `const action = dispatchConfig.action as string` on a
value that is now a plain string, falls to `default:`, and logs "Unknown order action".

### 2b. `dispatchConfig` does not exist **[V]**

`grep -rn dispatchConfig src ui/src` → **0 hits**. Same grep on the doc → **12 hits**.
`migrations/004_drop_dispatch_config.sql:1` says verbatim: "Legacy columns dispatch_config,
mqtt_set_topic, payload_key are no longer used."

Remove it from the `DiscoveredDevice.orders[]` shape at `:804`, and delete the MQTT
best-practice block at `:934` that is built on it (`topicSuffix`, "use `dispatchConfig.topic`
as a fallback").

### 2c. The field that actually routes orders is undocumented **[R]**

`DiscoveredDevice.orders[].category` (`src/devices/device-manager.ts:64`, persisted `:297`/`:312`,
column from `migrations/003_device_order_category.sql`) is absent from the shape at `:800-811`.
`specs/110-category-first-binding-resolution/spec.md` states the contract: callers resolve
bindings by category, alias is cosmetic.

### 2d. The manifest table omits a required field **[R]**

`:98-107` lists 8 fields then asserts at `:109`: "Fields that do NOT exist in the manifest:
`entry`, `integrationId`, `license`, `repository`." But `src/shared/types.ts:1565` declares
`repo: string` and `package-manager.ts:1179` throws `"Package manifest missing 'repo'"`. The
near-miss with `repository` reads as confirmation that no repo field exists. Both full example
manifests (`:75-93`, `:719-743`) omit it. `type` and `category` (spec 137) also missing.

### 2e. The install flow does three things it does not do **[R]**

`:1044`, `:1055-1064`, `:1074` claim Sowel falls back to the GitHub source tarball, runs
`npm install --production`, and attempts `npx tsc`. In `src/packages/package-manager.ts` the
only `execFile` in the whole file is `:1087` `execFile("tar", …)`. No npm, no tsc. `:1005-1009`
**throws** when no `sowel-*.tar.gz` asset exists, there is no fallback. Combined with `:1031`'s
instruction to exclude `node_modules/`, an author with runtime dependencies ships an artifact
that fails at dynamic import.

### 2f. Plugins are not imported from `dist/index.js` **[R]**

`:35`, `:59`. `src/plugins/plugin-loader.ts:311-313` copies `dist/` to
`plugins/<id>/.hot/<Date.now()>/` on **every** load and imports from there. A plugin resolving
sibling files via `import.meta.url` lands in a directory that gets pruned. Explain why
`deps.pluginDir` exists, and warn that `.hot/` appears inside the plugin's own directory.

### 2g. Smaller corrections in the same file **[R]**

- `:854-858`, `:488-492` — `updateDeviceData` has a 4th param `sourceTimestamp?`
  (`scoped-deps.ts:189-198`).
- `:779`, `:658`, `:302` — `source` documented as a free string "typically your plugin ID";
  `device-manager.ts:181` takes `DeviceSource`, a closed 9-literal union. `:302` tells a
  non-Zigbee plugin to claim `"zigbee2mqtt"`.
- `:343-377`, `:523-540` — `IntegrationPlugin` omits `getOAuthUrl?` and `handleOAuthCallback?`
  (`integration-registry.ts:60,67`), the methods that make the OAuth button appear.
- `:843` — "Stale data/order entries … cleaned up automatically" is false;
  `device-manager.ts:~266` deliberately keeps rows currently bound to an equipment.

### 2h. Additions this file needs

- **Spec 141 is not mentioned anywhere, and `getPollingInfo()` became safety-critical.** `:377`
  still marks it optional and cosmetic. `src/equipments/order-confirmation-tracker.ts:339-341`
  uses it to widen `CONFIRMATION_TIMEOUT_MS = 30_000` to `2 × intervalMs`. **A polling plugin
  that omits it raises a system alarm and pushes a phone notification ~30 s after every order
  it executes**, because the mirror binding cannot move before the next poll. Also: since spec
  141, `executeOrder` can be re-invoked spontaneously on device reconnect
  (`order-confirmation-tracker.ts:566,613`), so plugins must be idempotent. Undocumented.
- **Spec 111 gaps** — the existing section `:259-334` is good and was verified accurate. What is
  missing: `setMany` **throws** if any key in the batch is foreign (`scoped-deps.ts:75-86`) while
  the table at `:180` lists it with no caveat; `getMqttConfig`/`getZ2mConfig` throw for every
  plugin except the hard-coded id `"zigbee2mqtt"` (`:98-112`); `markRemoved` /
  `removeStaleDevices` / `migrateIntegrationId` are ownership-gated (`:208-234`) and
  `removeStaleDevices` is never introduced; `SLOW_CALL_MS = 1000` floods logs with "Slow plugin
  call" (`:46,286`); `wrapPluginMethods` returns a **new 14-key literal** (`:305-334`),
  discarding extra methods and class identity, which makes `:261`'s "bit-for-bit identical"
  true for the interface and false for everything else. Omitting any of the six
  unconditionally-bound methods kills load with an opaque `Cannot read properties of undefined
(reading 'bind')` — belongs in Troubleshooting.
- **Spec 089 gaps** — `:1119-1147` covers sha256, the registry loop, the backfill script and
  `OFFICIAL_OWNERS`. Missing: `RegistryEntryInvalidError` (a _missing_ hash fails before
  download, a different path from a mismatch); `SymlinkInTarballError`
  (`registry-types.ts:123-133`); the `sowel-*.tar.gz` asset-name filter is **enforced**
  (`package-manager.ts:1002-1004`), not a convention as `:1209` implies; the `sowelVersion`
  compatibility gate (`package-manager.ts:215,232`); and
  `CommunityPluginConfirmationRequiredError` — `:1145` frames the community tier as "a modal",
  but the API path throws (`package-manager.ts:350-353`), which every non-`mchacher` author
  hits on their first install.
- **Spec 137 plugin categories** — zero author-facing documentation anywhere. Not in the
  manifest table, the registry entry table (`:1105-1117`), or `recipe-development.md:31`.
  `RECIPE_CATEGORIES` is a closed enum (`src/packages/registry-types.ts:19-26`);
  `PluginManifest.category` (`types.ts:1568`) exists so personal-source recipes can
  self-declare. All 16 registry recipes carry one. Without it an author lands in "Other" at the
  bottom of the store, with no error to diagnose.
- **Spec 150 inbound normalization** — the doc covers outbound `valueOn`/`valueOff` at `:815`
  but never states what the core coerces on the way in. That is the exact question of an author
  debugging `"ON"` vs `true`.

---

## PR 3 — `fix(docs): the activity feed is persistent since spec 147` (S)

**[V]** `src/activity/activity-store.ts:16` `ACTIVITY_RETENTION_DAYS = 7`.
`src/activity/activity-buffer.ts:62-70` reloads from SQLite on boot. Table is `activity_log`
(`migrations/019_activity_arbiter_history.sql:8`). Retention is **7 days** and the feed
**survives a restart**. Only the 2000-item cap is still correct.

Three files say otherwise:

- **[V]** `technical/architecture.md:570` "keeps the last **24 hours** … in a single in-memory
  ring buffer"; `:585` "Buffer is lost on container restart, same as the logs ring buffer."
- **[R]** `user/zones.md:136` "last 24 hours … in memory … reset when the container restarts."
- **[R]** `technical/api-reference.md:475` "in-memory ring buffer (24h retention … reset on
  restart)."

A user told "reset on restart" will not think to look for yesterday's evidence. Small,
self-contained, high value per line changed.

---

## PR 4 — `fix(docs): resolve the French data model` (M)

**[V]** `docs/technical/data-model.fr.md` is not a stale translation, it documents a different
product. The EN page was rewritten and split into five sub-pages on 2026-05-10 (`62160621`);
the FR page is still the 2026-02-19 monolith (831 lines vs EN's 359).

Phantom content confirmed:

- **[V]** `:158-223` a whole `## 4. Equipment Group` section with a TS interface and a
  `CREATE TABLE equipment_groups`. `grep -rn "equipment_group\|EquipmentGroup" src migrations`
  → **0 hits** (the FR doc has 5).
- **[R]** `:792-800` four `/api/v1/zones/:zoneId/groups` + `/api/v1/groups/:id` routes and
  `:823` `POST /api/v1/groups/:id/orders/:orderKey`. No `/groups` path is registered anywhere.
- **[R]** `:444-489` `## 9. Computed Data (V0.5)` and the `computed_data` / `internal_rules`
  tables at `:572-780` — none exist.
- **[R]** `:572-780` presents itself as the complete schema with 17 tables; the real schema has 46. Missing: `modes`, `plugins`, `plugin_sources`, `audit_log`, `activity_log`,
  `dashboard_widgets`, `calendar_*`, `arbiter_*`, `pv_*`, `user_mfa_*`, `mqtt_*`,
  `notification_*`.
- **[R]** `:824-831` closes with a `## 14. Roadmap d'implémentation` mapping entities to
  V0.1/V0.2/V0.3/V0.5.

**Decision needed, and the recommendation is to delete.** `git rm docs/technical/data-model.fr.md`
and let the i18n fallback serve the correct EN hub. Deleting is a net improvement on day one: it
removes a phantom entity, a phantom table, six phantom routes and a V0.x roadmap, and it fixes
the `#3-plugin` anchor from PR 1. Translating the five sub-pages can follow separately if wanted.

Same PR: `docs/specs-index.fr.md` stops at spec **136**; specs 137–166 are missing. Either bring
it current or replace it with a pointer to the EN index.

---

## PR 5 — `fix(docs): correct architecture.md against the code` (M)

### Project structure tree **[R]**, verified partially **[V]** with `ls src/`

| Line       | Claim                                                        | Truth                                                                                            |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `:128`     | `src/ai/` LLM integration                                    | does not exist                                                                                   |
| `:130`     | `src/users/`                                                 | does not exist; it is `src/auth/user-manager.ts`                                                 |
| `:143`     | root `recipes/` built-in JSON templates                      | does not exist; recipes are code packages                                                        |
| `:115`     | `src/integrations/` "plugins (zigbee2mqtt, panasonic-cc, …)" | contains only `integration-registry.ts` + test. Contradicts `:155` "Nothing is built-in anymore" |
| `:139-140` | UI `scenarios/` dir and a Scenarios page                     | neither exists; the real dir is `ui/src/components/recipes/`                                     |

Missing from the tree: `src/packages/` (referenced by the same file at `:161`), `src/activity/`,
`src/backup/`, `src/weather/`, `src/test-helpers/`.

**[R]** `:49-50` elevates **Scenario** to a first-class domain concept. There is no `Scenario`
type, route, page or component.

**`CLAUDE.md` repeats several of these** and must be fixed in the same PR: `src/users/` at
`:84`, "React 18" at `:56` (real: `^19.2.8`), and the design tokens below.

### Facts that are wrong **[R]**

| Line       | Claim                                                                 | Truth                                                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:546-552` | `scripts/release.sh` bumps versions, runs `npm run validate`, commits | `release.sh:12` says the opposite, `:57-62` asserts versions already match and exits 1 otherwise, `:84-85` only tags and pushes. No `validate` in the file                                                                                                        |
| `:542`     | "Docker build is amd64-only"                                          | `release.yml:174` `docker-arm64` job, `:225` `platforms: linux/arm64`, `:236-241` `promote-manifest`. Dual-arch, and the doc even rationalises the reversed decision                                                                                              |
| `:93`      | `equipment.data.changed \| equipmentId, key, value`                   | field is `alias` (`types.ts:1329`); WS dedup uses `event.alias` (`websocket.ts:193`)                                                                                                                                                                              |
| `:95`      | `zone.data.changed \| zoneId, key, value`                             | `{ zoneId, aggregatedData }` (`types.ts:1321`); no per-key zone event exists                                                                                                                                                                                      |
| `:102`     | `recipe.state_changed`                                                | no such member; it is `recipe.instance.state.changed` (`types.ts:1374`)                                                                                                                                                                                           |
| `:686`     | `CORS_ORIGINS` default `*`                                            | `config.ts:114` default is `http://localhost:3000,http://localhost:5173`. **`:402` of the same file states it correctly** — self-contradiction. Also in `contributing.md:242`                                                                                     |
| `:688`     | `INFLUX_TOKEN` auto-generated, persisted to `data/.influx-token`      | `config.ts:75-91` a hardcoded `DEFAULT_INFLUX_TOKEN` matching `docker-compose.yml:62`; the file is read if present, never written. (`JWT_SECRET` at `:682` _is_ generated — that row is fine)                                                                     |
| `:38`      | PM2 as production process manager                                     | no `pm2` anywhere; `CMD ["node","dist/index.js"]` under `gosu`, Docker restart policy is the supervisor                                                                                                                                                           |
| `:518`     | self-update helper uses `AutoRemove: true`                            | `update-manager.ts:416-419` `AutoRemove: false`, deliberately, so `docker logs sowel-updater` survives                                                                                                                                                            |
| `:658`     | restart runs `docker compose up -d sowel`                             | `update-manager.ts:461` needs `--force-recreate`; the code comment at `:435-440` explains the doc's command silently no-ops                                                                                                                                       |
| `:284`     | "InfluxDB is mandatory"                                               | `src/index.ts:336-345` catches and warns; the engine boots without it, only history/energy degrade                                                                                                                                                                |
| `:203`     | `startAll()` starts plugins "sequentially with small delays"          | `integration-registry.ts:272-293` awaits back-to-back with no delay; the 10 s `STAGGER_MS` is a `pollOffset` passed to pollers                                                                                                                                    |
| `:229`     | `netatmo-security \| mchacher/sowel-plugin-netatmo-security`          | not in `plugins/registry.json`; the camera integration is `netatmo_camera` owned by `alpitux`. The table lists 17 packages, the registry has 33 including third-party owners, so "official plugin ecosystem" no longer describes it. Regenerate from the registry |

### Design system and stack **[R]**

`:434-437` and `CLAUDE.md:254-255`: accent `#D4963F` hover `#BB8232`, primary hover `#13405A` /
light `#E6F0F6`, radii 6/10/14. Real values: `design-system/tokens.css:13,16`
(`--p-600:#144159`, `--p-50:#EEF5F8`, `--a-500:#F2C035`, `--a-600:#D4A41C`) and
`ui/src/index.css:56-58` (`6px / 8px / 12px`). Only the primary base `#1A4F6E`, the fonts and
the 28 px data size survive.

`:26-30` "React 18+", Vite, Tailwind. Real (`ui/package.json`): React `^19.2.8`, Vite `^8.2.2`,
Tailwind `^4.2.0` — **v4 means there is no `tailwind.config.js` at all**, which no doc mentions.

### Fold in `contributing.md` **[R]**

- `:141` "Roles: admin > standard > viewer" — `types.ts:1172` `UserRole = "admin" | "standard"`,
  two roles.
- `:143-147` an "Expression Engine" section describing `expr-eval` and
  `OR/AND/NOT/AVG/MIN/MAX/SUM/IF/THRESHOLD`. No `src/expressions/`, `expr-eval` not in
  `package.json`. It is an unbuilt design note sitting in "Coding Conventions" — delete it.
- `:27` "`npm run dev` is ts-node + nodemon" → `tsx watch`.
- `:63` `npm test -- --grep` is a Mocha flag; vitest uses `-t`.
- `:119` cites `033_plugins.sql`; migrations stop at `028`.
- Missing: `npm run validate` (the real gate) and the `.husky/pre-commit` gitleaks scan that
  will block a first-time contributor's commit. Env table omits `SOWEL_SHADOW_MODE` (which
  makes `loadPlugin` a no-op for every path, `plugin-loader.ts:258-264`, i.e. "why do no
  plugins load"), `SOWEL_TAKEOVER` and `TZ`.
- `:136-141` Authentication predates MFA (151), admin-only RBAC (131) and the audit log (113).

### `deep-dives/surplus-arbiter.md` **[R]**

`:26` "A load with no power measurement stays solid green: Sowel does not display what it does
not know." Spec 166 (`345d46a1`, #746) added `claim.reportNeed()`: a never-measured load with
`need = false` now renders `granted-idle`. `:54`'s feature-history line still reads "specs 140,
148, 158" though the article already describes 164 and 165.

---

## PR 6 — `docs(api): bring the API and data-model reference current` (L)

### Six documented routes return 404 **[R]** (`docs/technical/data-model.md`)

| Line          | Documented                            | Real                                               |
| ------------- | ------------------------------------- | -------------------------------------------------- |
| `:338`        | `PUT /modes/:id/zones/:zoneId/impact` | `PUT /modes/:id/impacts/:zoneId`                   |
| `:340`        | `POST /recipes/:recipeId/instances`   | `POST /recipe-instances`                           |
| `:341`        | `GET /recipes/instances/:id`          | shape does not exist; `/recipe-instances/*`        |
| `:345`,`:346` | `GET\|POST /button-actions`           | `GET\|POST /equipments/:id/action-bindings`        |
| `:327`        | `DELETE /plugins/:id`                 | `POST /plugins/:id/uninstall` (`plugins.ts:322`)   |
| `:328`        | `GET /history`                        | no bare route; `/history/:equipmentId/:alias` etc. |

### Arbiter read model documents the deprecated half **[R]**

`api-reference.md:325` documents `ArbiterPublicState` as
`{ enabled, state, availableSurplusW, productionDetected, grants, pending, suspensions, journal, surplusSeries }`.
`types.ts:950-1024` additionally has `loads: ArbiterLoadInfo[]`, `dormant`, `engageMarginW`,
`idle`, `priority` — and `:983-993` marks `grants`/`pending`/`suspensions` `@deprecated …
superseded by loads`. The `ArbiterLoadState` union
(`granted | granted-idle | pending | unmanaged | suspended | idle`, `types.ts:900`) appears in
no doc at all.

### Missing event union members **[R]**

`data-model.md:206-286` omits 8: `equipment.status.changed` (`types.ts:1362`),
`equipment.order.unconfirmed` (`:1352`, spec 141), `activity.added` (`:1440`),
`energy.capacity.granted|revoked|denied|released` (`:1443-1462`), `energy.arbiter.status`
(`:1464`).

### Enum and schema drift **[R]**

- `data-model/equipments.md:14-39` — `EquipmentType` missing `solar_panel`, `display`, `camera`
  (`types.ts:297,305,307`). `api-reference.md:185` documents `camera`, so the two pages
  contradict each other.
- `data-model/devices.md:94-154` — `DataCategory` missing `temperature_device`, `solar_state`,
  five `camera_*`, three `ups_*`, the spec-120 display categories. `OrderCategory` missing
  `solar_toggle`, three camera orders, three display orders.
- `data-model/equipments.md:41-52,86-97` — missing `requireConfirmation` (`migrations/018`),
  `invertDirection` (`migrations/024`), `solarProfile` (`migrations/026`).
- `data-model/equipments.md:159-166` — `data_bindings` missing `category_override`
  (`migrations/023`).
- `data-model/devices.md:182-194` — `device_data` missing `value_on` / `value_off`
  (`migrations/028`, the newest migration).
- `data-model/recipes.md:18` — slot `type` union missing `"select"`, plus `options` and
  `hiddenWhen` (`types.ts:507-527`).
- `api-reference.md:467` — button effect types missing `zone_order` (`types.ts:1132`);
  `data-model/modes.md:80` lists it, so the two disagree.
- `api-reference.md:153` — `PUT /equipments/:id` body omits `energyProfile`,
  `requireConfirmation`, `invertDirection`, `solarProfile` (`equipments.ts:216-229`) — the only
  way to configure arbitration, shutter inversion and PV forecast.
- `api-reference.md:566` — WS topic list missing `energy` (`websocket.ts:80,92`); no mention
  that `mqtt-publishers` and `logs` are silently dropped for non-admins (`websocket.ts:104`).
- `api-reference.md:593` — "Each push is a single event (not batched)" for `activity` is false;
  it goes through the 200 ms batch flush (`websocket.ts:250-257`). Only `log.entry` is sent
  individually (`:271`).
- `api-reference.md:140` — `GET /devices/suggest` "suggest compatible devices for an equipment
  type": `devices.ts:74-119` has a single `if (eqType === "gate")` branch, every other type
  returns `[]`.
- `api-reference.md:150` — `?type=energy_meter` is not a plain type filter
  (`equipments.ts:142-160` takes a submeter-eligibility branch); the undocumented `?role=submeter`
  shares it.
- `data-model.md:190` — "Notification Publishers → Telegram/**webhook**"; `channelType` is
  `telegram | web-push`.
- `data-model/equipments.md:283-288` — "Current providers in the codebase" lists 4; there are 7
  (`WeatherTempExtremesTracker`, `VmcSpeedTracker`, `PvForecaster`, `WeatherAggregator`).

### A promise the schema forbids **[R]**

`data-model/equipments.md:198-206`: "An Equipment can have multiple OrderBindings sharing the
same alias but pointing to different Devices." `migrations/001_initial.sql:91` still declares
`UNIQUE(equipment_id, alias)` and no later migration relaxes it. The manager loops over N rows
(`equipment-manager.ts:848-890`) so the capability exists in code but is unreachable through the
DB. The page flags this in an **HTML comment** at `:208`, invisible in the rendered page where
only the false claim shows.

### Undocumented route surface **[R]**

All of `/api/v1/system/*` (8 routes), `GET /api/v1/audit`, `/backup/local` +
`/backup/restore-local`, `GET /energy/arbiter/timeline` (spec 148), the four PV endpoints
(160/161/162), and `/plugins/:id/oauth/url|callback`.

### `recipe-development.md` **[R]**

- `:215-222` points authors at `equipmentManager.executeOrder`, but
  `src/recipes/engine/recipe.ts:27-35` says: "Prefer this over `equipmentManager.executeOrder`
  to populate the Activity feed". No `dispatchOrder` row, no `logger` row, and no mention of the
  `{ success, error }` return that is a recipe's only way to learn an order failed.
- Recipe actions (`RecipeActionDef` / `onAction`, `types.ts:556-561,591,603`), the mode-impact
  hook, are absent end to end.
- `:90` slot union missing `"text" | "data-key" | "select"`, while the same page's table at
  `:151` documents a `select` row and `:153` a paragraph on it.
- `:166` uses `override readonly i18n: … = {` — class-member syntax inside an object-literal
  `createRecipe()`. A syntax error as written.

### `docs/specs-index.md` **[R]**

Missing 34 rows: `063-066, 075-080, 089, 094-102, 104, 106-110, 146, 147, 148, 149, 151, 152,
154, 155`. Several are cited by number elsewhere (`architecture.md:184` "specs 089 + 136",
`:568` "spec 101", `api-reference.md:381` "spec 089") so the index's own promise fails.
Separately it still marks specs **139–166 as "Unreleased"** although they shipped through
v1.62.0.

### `dependency-management.md` **[R]**

`:43-47` "Linters, formatters and the TypeScript compiler ship as individual PRs".
`.github/dependabot.yml:50` (`backend-toolchain`) and `:84` (`ui-toolchain`) group them. The
doc's list at `:40-41` names three groups; there are five. `:184-187` reasons about
`better-sqlite3 11.10.0` prebuilds and Node 23 ABI; `package.json` is on `^13.0.3` and
`.nvmrc`/`Dockerfile` on Node 24.

---

## PR 7 — `docs(user): cover what shipped in v1.53–v1.62` (L, splittable)

The systematic asymmetry: recent equipment and safety features land in
`data-model/equipments.md` and never reach `user/equipments.md`. The technical layer is
maintained, the user layer is not.

Ordered by how likely someone is to be stuck.

1. **Shutter and gate invert direction (specs 154, 155) — zero hits in the whole docs tree**
   **[R]** (`grep -rni "invert" docs/` returns only "inverter"). This is the fix for "my awning
   commands are backwards" (#614) and "my garage relay triggers on OFF" (#627).
   `user/equipments.md:57-64` still asserts the fixed convention ("RF-up = retract = position
   0") as unchangeable, and `:78-87` tells gate owners to "configure the pulse behavior on the
   device itself" — exactly the advice spec 155 replaced. A user with reversed hardware
   concludes Sowel cannot drive their motor.
2. **PV production forecast (160), backfill (161), new Production page (163)** — no user
   documentation. Only coverage is one sentence in `deep-dives/pv-health.md:27`, i.e. the
   feature is documented as a prerequisite of another feature. No mention of the
   `weather-forecast` ≥ 2.3.0 requirement, the 45-day window, or why "Relearn from my history"
   is manual.
3. **`user/energy.md` describes a Production page that was replaced.** `:86-90` lists the
   sidebar and `:140-152` describes Production as a two-colour history chart with a totals row.
   Spec 163 (#721) made it the PV monitoring home (`ProductionPage.tsx` renders the
   forecast/accuracy and health panels). The page was last touched 2026-08-20, before that
   shipped. **`deep-dives/energy-tour.md:30-36` describes the new page correctly, so the "In
   Depth" article is more accurate than the User Guide — backwards.**
4. **UPS (156) and VMC (153) absent from the user equipment catalogue** while
   `user/equipments.md:47` bills it as "closed … Every equipment in your home is one of these".
   Both are fully documented technically, so this is user-guide-only. Spec 157's rebuilt
   three-card UPS panel is undocumented everywhere.
5. **Order delivery confirmation (141), user side** — zero hits. The alarm and push a user
   receives when an order's effect is not observed has nowhere to be looked up.
6. **Low battery alerts (143)**, **gate action confirmation (146)**, **spec 166's need/gap
   columns** (#809, the newest user-visible change; `user/energy.md:181` still lists three
   parts), **weather multi-model confidence (159)** (the pill is on screen, unexplained),
   **RBAC roles (131)** (zero hits while `getting-started.md:82` invites you to add users).
7. `user/index.md` + `.fr.md` "Guide sections" grid lists 8 of the 11 pages: **Devices**,
   **Recipes** and **Plugins** are missing though all three are in the nav.
   `technical/index.md:29-35` likewise omits **Dependency Management**.
8. `user/recipes.md` missing 6 recipes (Schedule On/Off, Smart Cooling, VMC Humidity, Water
   Heater on Solar, Runtime Guard, Presence Display).
9. **`user/modes.md` duplicate heading** `### Calendar scheduling` (`:85`) and
   `## Calendar scheduling` (`:89`) → `#calendar-scheduling` and `#calendar-scheduling_1`. Any
   external link to the section is a coin flip.
10. **`user/remote-access.md` is a developer page in the user guide**, and the oldest page in
    the tree (2026-03-22). `:144-157` tells the reader to `cd ui && npm run build && cp -r dist
../ui-dist`; for the documented Docker deployment `ui-dist/` is baked into the image
    (`Dockerfile:55`) and the command does nothing. `:161-165` presents `localhost:5173` as a
    normal usage mode. `:167-175` recommends Cloudflare Access "for an additional layer of
    authentication" without mentioning Sowel has shipped TOTP MFA since v1.51.0.
11. **`deep-dives/pv-health.md`** never mentions the reference build-up state added by
    `297c44b1` (v1.58.1).

---

## EN/FR divergence (fold into the PRs above)

All gaps are EN-only; there are no FR-only pages.

**Untranslated pages** (the FR site silently serves English via i18n fallback):

| Page                                                                        | Verdict                                                                                                                                                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user/devices.md` (133 l.), `user/recipes.md` (129 l.)                      | Oversight. Every other `user/` page has a `.fr.md`, and `nav_translations` already maps `Recipes: Recettes`, so the FR nav promises a French page and serves English                   |
| `technical/data-model/{devices,equipments,zones,modes,recipes}.md` (930 l.) | Oversight. The 2026-05-10 split never reached French. `equipments.md` carries the UPS section, so **UPS is documented nowhere in French**                                              |
| `technical/dependency-management.md` (241 l.)                               | Plausibly deliberate: the only nav entry with no `nav_translations` mapping. But `contributing.fr.md` lacks the link line `contributing.md:83` has, so a French reader hits a dead end |

**Diverged pairs, worst first** **[R]**:

1. `data-model.md` ↔ `.fr.md` — two different products. See PR 4.
2. `api-reference.md` ↔ `.fr.md` (622/43 vs 514/38) — five surfaces absent in FR: MFA (`:56`),
   Roles & authorization (`:78`), Equipment status spec 116 (`:157`), Camera media proxy
   (`:183`), Web Push (`:447`). FR has zero hits for `mfa|totp|viewer`, and its `## Energy` has
   no claims endpoints.
3. `recipe-development.md` ↔ `.fr.md` — the entire capacity-claim helper is absent. EN
   `:261-322` documents `energy` / `claimCapacity`; FR has **no occurrence** of `energy`,
   `claim`, `surplus`, `arbiter` or `arbitre`. A French recipe author cannot discover the API.
4. `architecture.md` ↔ `.fr.md` — EN-only: `## Energy Capacity Arbiter (spec 140)` +
   `### Daily metrics (spec 158)` (~62 lines) and four auth subsections. Worse, FR is
   _behaviourally_ stale: it says the auth middleware "tente d'abord le décodage JWT, puis le
   lookup de token d'API" where EN correctly describes the spec-105 auth-by-default `onRequest`
   hook and `PUBLIC_ROUTES`.
5. `specs-index.fr.md` — highest row 136; ~30 specs and 15 releases behind.
6. `plugin-development.md` ↔ `.fr.md` — EN-only `## Device availability contract (spec 116)`
   (`:215-258`) and `#### Security: SHA256 integrity & community plugins (spec 089)` (`:1119`).
7. `deployment.md` ↔ `.fr.md` — EN-only `### Container user (spec 105)` (`:80-84`): the non-root
   `sowel` uid 1000, the `gosu` drop, and the volume-ownership consequence of overriding
   `user:`. This bites a French operator doing a manual upgrade.
8. `user/equipments.md` ↔ `.fr.md` — EN `:163-170` documents the metering plug; FR `:251` says
   only "Simple interrupteur on/off ou prise connectée". Structurally FR is _richer_ elsewhere
   (per-type `####` headings vs EN tables) — style divergence, not an error.
9. `user/energy.md` ↔ `.fr.md` — EN `:166` documents the per-equipment **Shutdown delay (min)**
   arbiter field; FR's list has no délai d'arrêt.

**In sync, verified:** `release-notes.md` / `.fr.md` — 158 version anchors, identical in both,
`v1-0-0` through `v1-62-0`, no diff. The `verify-release-notes` CI gate is doing its job. Also
in sync: all three `deep-dives/*`, `user/host-setup`, `user/plugins`, `user/dashboard`,
`user/getting-started`, `user/index`, `user/modes`, `user/remote-access`, `user/zones`,
`technical/index`, `technical/contributing`, both `index.md`.

---

## Screenshots — a separate session, not a PR

Needs a seeded local instance and the fixture pipeline
(see the `sowel-docs` skill and `reference_screenshot_workflow` in memory: anonymized FR/EN via
`build-fixtures.py`, shot on a **local** docker instance, never prod).

- **Definitively stale** (May 15–16, ~25 UI commits since): all 12 `energy-*.png`, all 18
  `getting-started-*.png`, plus `activity-*`, `calendar-*`, `dashboard-*`, `devices-*`,
  `equipments-*`, `modes-*`. Worst is `energy-production-day-{en,fr}.png` — it shows the page
  spec 163 replaced. `energy-live-*.png` predates spec 132's three-phase breakdown and the whole
  arbiter surface rebuild.
- **Nearly current but already behind:** `arbiter-live-*.png`, `arbiter-settings-*.png`,
  `arbiter-energy-profile-*.png` predate `074bbb11` (#809, 2026-08-29) which added the need and
  gap columns to the exact table they show.
- **Freshest:** `pv-*.png`, `energy-tour-*.png`.
- **`user/plugins.md` has no screenshots at all** — the page was rewritten 2026-08-29 for the
  v1.62.0 list rebuild, so this is a gap rather than a stale image.
- **Ten orphan images** on disk from 2026-03-23, referenced by nothing:
  `manual-equipments-{diagram,full,hero,ui-preview}.png`, `manual-sidebar.png`,
  `sidebar-{admin-expanded,autocollapse,current,maison-expanded,modes-expanded}.png`.

---

## Areas checked and found accurate

Recorded so no effort is spent re-reviewing them: the SQLite section; the whole InfluxDB
pipeline (bucket names, retentions, task names, flux ranges); the Energy Capacity Arbiter and
spec-158 metrics sections of `architecture.md`; the auth / MFA / WebSocket-auth /
security-headers sections; trust tiers and personal sources (spec 136, the strongest section in
the repo); Backup & Restore; Logging; Timezone; self-update detection; the spec-116 availability
contract; the documented half of the spec-111 isolation section; `api-reference.md`'s Roles &
authorization allowlist (matches `STANDARD_WRITE_ALLOWLIST` entry for entry); camera proxy
semantics; the arbiter metrics payload; ~120 REST endpoints verified at the documented path and
method; `deep-dives/pv-health.md` against `specs/162-pv-health/spec.md` line by line.

---

## Working rules for the remediation session

- Branch per PR, `docs/<slug>`, never commit to `main`. PR and wait for approval before merging.
- Every claim written into the docs must be checked against the source **at the time of
  writing**, not against this file. This file is a work list, not a source of truth, and it
  ages from the moment it was written (2026-08-29, v1.62.0).
- Re-run `mkdocs build --strict` after each PR. **Never** `mkdocs serve` — the maintainer owns
  the dev server on port 8000.
- Keep EN and FR in step for anything touched, or note explicitly why not.
- No em-dashes or en-dashes in user-facing copy, EN or FR.
- `npm run validate` does not cover `docs/`, but `npx prettier --check "docs/**/*.md"` does, and
  two files (`docs/sowel-spec.md`, `docs/specs-index.md`) are already unformatted on `main` —
  do not reformat them as a side effect.
