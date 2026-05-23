# Spec 115 — Somfy RTS bridge: awning equipment + plugin

## Context

A new bridge has reached production: `somfyrts2mqtt` (ESP32 + CC1101, [github.com/mchacher/somfyrts2mqtt](https://github.com/mchacher/somfyrts2mqtt)). It speaks a Tasmota-style MQTT subset and drives Somfy RTS shutters **and awnings** ("stores bannes"). The bridge already exposes a per-remote `invert` flag so that the raw RF Up/Down commands are swapped for awning-wired motors, and the position scale stays consistent: `100 = down position = deployed / closed`, `0 = up position = retracted / open`.

This spec covers **two coordinated work-streams**:

- **A — Sowel core** (this repo): a new `awning` equipment type, a dashboard family, UI cards, zone aggregation, and zone-level batch commands.
- **B — Companion plugin** (new repo `mchacher/sowel-plugin-somfy-rts`): an MQTT integration that auto-discovers paired remotes from the bridge and exposes them as Sowel `Device`s with `shutter_position` data + `shutter_move` / `set_shutter_position` orders.

The two pieces ship together (registry entry added to `plugins/registry.json` only when the plugin has its first release), but live in separate repos and PR cycles. The Sowel-side change is plugin-agnostic on purpose — any integration that emits `shutter_position` can bind to an `awning` equipment.

Today Sowel has a single `shutter` equipment type. Binding an awning to it works mechanically but is wrong semantically:

- The UI labels say "Open / Close" — wrong vocabulary; users want "Extend / Retract" (FR: "Déployer / Rétracter").
- The zone widget "all shutters close at sunset" recipe retracts awnings too, which is the opposite of the user intent (an awning closes at noon when the sun hits, retracts in the evening).
- The dashboard widget mixes shutters and awnings under the same icon and zone command set.

We need a sibling equipment type that reuses the position semantics but stays separated from `shutter` so recipes, zone commands, and the dashboard treat the two as distinct families.

## Goals

### Sowel core (work-stream A)

1. Introduce a new equipment type `awning` (sibling of `shutter`) in a new `awnings` widget family.
2. Reuse the existing `shutter_position` / `shutter_move` / `set_shutter_position` data + order categories — the data is semantically identical (0-100 % travel, Open / Close / Stop verbs at the RF layer).
3. Ship complete UI coverage to match the user request: **dashboard card** (family widget), **compact card** (zone row), **dedicated card** (equipment detail).
4. Adapt vocabulary: "Extend / Retract" instead of "Open / Close" everywhere user-facing (EN + FR).
5. Aggregate awnings at the zone level so dashboards can show "1/2 deployed" the same way they show "1/2 open" for shutters.
6. Keep awnings out of `allShuttersOpen/Stop/Close` zone commands — add a parallel `allAwningsExtend/Stop/Retract` triplet.

### Plugin `sowel-plugin-somfy-rts` (work-stream B)

7. Create a new plugin repo `mchacher/sowel-plugin-somfy-rts` following the spec-053+ plugin layout (manifest, `dist/index.js` entry, GitHub Actions release workflow, SHA256 published to the registry).
8. Connect to the user's MQTT broker (broker URL + credentials configured from Sowel Admin → Plugins → Somfy RTS).
9. Subscribe to `tele/<root>/SENSOR`, `tele/<root>/LWT`, and `stat/<root>/+` for one or more configured root prefixes (default `somfyrts2mqtt`).
10. Auto-discover paired remotes from the top-level keys of the `tele/<root>/SENSOR` JSON payload. Each remote becomes a Sowel `Device` named after the remote.
11. Push `shutter_position` data updates to Sowel on every SENSOR payload.
12. Translate Sowel `executeOrder(device, "shutter_move", "OPEN" | "STOP" | "CLOSE")` and `executeOrder(device, "set_shutter_position", 0..100)` into bridge `cmnd/<root>/<name>/{Open,Close,Stop,Position}` publishes.
13. Track bridge availability via the LWT topic and surface it as a `system.integration.{connected,disconnected}` event so the UI badge reflects reality.
14. Ship a manifest + README + minimal test suite + GitHub release pipeline matching the patterns of `sowel-plugin-tasmota`.
15. Add the registry entry to Sowel's `plugins/registry.json` once the first plugin release is tagged (separate PR after the plugin ships).

## Non-Goals

### Sowel core

- Wind-cutoff automation (deploy → wind alarm → auto-retract). That belongs in a future recipe (`sowel-recipe-awning-wind-cutoff` or similar), not in the equipment.
- Sun-based auto-deploy (cover the terrace when sun is over the deck). Recipe territory.
- A separate `awning_position` / `awning_move` data category. The data is byte-for-byte the same as a shutter; duplicating categories would force every plugin to emit twice. The semantic split lives at the equipment-type layer, not the category layer.
- Multi-segment awnings (e.g. an extension arm angle separate from the deployment %). The bridge gives us one 0-100 number; that is what we model.
- Awning-specific icon ramps (different SVG per level like `ShutterWidgetIcon` does). Single static `AwningIcon` is enough for v1; we can add level variants later if the UX asks for it.
- Touching the `shutter` type's behaviour, categories or aggregation. This spec is additive only — existing shutter equipments stay byte-for-byte identical.

### Plugin

- Pairing / un-pairing remotes from Sowel. That is bridge-side admin (web UI of the somfyrts2mqtt bridge); Sowel just consumes the result.
- Setting Open/Close calibration durations from Sowel. Bridge-side admin only — Sowel doesn't need to know the underlying motor timing.
- Reading the per-remote `invert` flag in Sowel. The bridge already inverts the RF layer; from Sowel's side every remote reports the same `Position` semantics (100 = down). The flag is bridge-internal.
- Discovering whether a paired remote is "really" an awning vs a shutter. The plugin emits one device per remote with shutter_position data; the user picks `shutter` or `awning` at equipment creation time. The plugin makes no assumption.
- OTA-pushing firmware to the bridge. That's done from the bridge's own admin UI (already shipped in `somfyrts2mqtt` v1.x).
- Supporting non-Tasmota-shutter MQTT bridges. The plugin is named, branded, and shaped for `somfyrts2mqtt`. If another similar bridge appears, a separate plugin or a generic refactor can happen later.

## Functional Requirements

### FR1 — New equipment type `awning`

- Add `"awning"` to the `EquipmentType` union in `src/shared/types.ts`.
- Add it to `VALID_EQUIPMENT_TYPES` in `src/equipments/equipment-manager.ts`.
- Register it in the i18n locale files (en + fr) with display name "Awning" / "Store banne".

### FR2 — New widget family `awnings`

- Add `"awnings"` to the `WidgetFamily` union in `src/shared/types.ts`.
- Add `awnings: ["awning"]` to `WIDGET_FAMILY_TYPES` in `src/shared/constants.ts`.
- Add `awnings` to the dashboard FAMILIES list (`ui/src/components/dashboard/AddWidgetModal.tsx` and `widget-utils.ts`) so users can create a per-zone "Awnings" widget the same way they create a "Shutters" widget.
- Keep `shutters` family unchanged — `awning` is **not** in the shutters family.

### FR3 — Reuse shutter data + order categories

The awning binds the same way as a shutter:

- `RELEVANT_DATA["awning"] = ["shutter_position"]` in `ui/src/components/equipments/bindingUtils.ts`.
- `RELEVANT_ORDERS["awning"] = ["position", "state", "target_position"]` (mirrors shutter).
- Add `awning` to `CANDIDATE_BASED_TYPES` so the DeviceSelector uses the same per-channel candidate flow as shutter (one candidate per shutter index on multi-shutter devices).
- The order category aliases (`shutter_move` → alias `state`, `set_shutter_position` → alias `position`) already exist and work for any equipment type — no change needed there.

Acceptance: selecting a `somfyrts2mqtt` remote (or any device exposing `shutter_position` + `shutter_move`) as source for an awning produces the same `position` data binding + `state` / `position` order bindings as a shutter would.

### FR4 — Custom `AwningIcon` component

- New component `ui/src/components/icons/AwningIcon.tsx`.
- Stroke 1.5, `currentColor`, 24×24 viewBox, rounded linecaps (consistent with `WaterValveIcon` from spec 062).
- Visual: a wall line at top, a slanted canopy (3 stripes) extended diagonally outward and downward, a support arm. No level variants (static icon).
- Props: `size`, `strokeWidth`, `className`, `title` (a11y).
- Used in: zone compact card, dashboard family widget, equipment detail card, and the `IconPicker`.

### FR5 — Icon picker integration

- Register `awning` as a custom icon in the existing `IconPicker` (alongside `water_valve`).
- Users creating any equipment can pick this icon.

### FR6 — Device filter for equipment creation

- In `DeviceSelector.tsx`, `awning` reuses the shutter filter logic — a device is a candidate if it exposes `shutter_position` data (same predicate as shutter). The user picks which equipment type ("Shutter" or "Awning") in the `EquipmentForm` type dropdown and the same devices show up.
- No need for an awning-specific predicate: the _type_ is what differs, the _signals_ are identical.
- The `EquipmentForm` type dropdown gains a new entry `{ value: "awning", labelKey: "equipments.type.awning" }`.

### FR7 — Compact card (zone row)

When an awning equipment is listed inside a zone view, render an awning-flavoured row:

- Slider + position pill + 3 buttons (extend / stop / retract) — same layout as `ShutterControl` in `compact` mode.
- Labels: `controls.extend` / `controls.stop` / `controls.retract` instead of `controls.open` / `controls.close`.
- Pill labels: `100` → "Deployed" (FR: "Déployé") in success colour; `0` → "Retracted" (FR: "Rétracté") in neutral colour; in-between → `<n>%`.
- Direction: vertical arrows (`ChevronUp` to retract, `ChevronDown` to extend) — same orientation as shutter. (Pool covers use horizontal because they slide; awnings deploy downward/outward, vertical reads correctly.)
- Implemented either as a small `AwningControl.tsx` component or as a typed branch inside `ShutterControl` (whichever is cleaner — see architecture.md for the call).

### FR8 — Dashboard family widget

A per-zone "Awnings" widget under the new `awnings` family, opened from the dashboard:

- Header: zone name + `AwningIcon` + count `<deployedCount>/<total>`.
- Primary metric: `avgPosition %` shown via `AwningIcon` with a small fill indicator (or `n/total` text — see architecture.md).
- Footer command buttons: **Extend all** / **Stop all** / **Retract all** — dispatches `allAwningsExtend` / `allAwningsStop` / `allAwningsRetract` zone commands.
- Pattern: mirrors `ZoneShutterWidget` in `ZoneWidget.tsx` line-for-line, with awning vocabulary.

### FR9 — Dedicated equipment card (detail view)

Full detail page shown when clicking an `awning` equipment in the equipments list:

- Header: `AwningIcon` (large) + name + zone + position pill.
- Position section: slider (0-100) + state badge ("Deployed" / "Retracted" / "<n>%") — bound to `set_shutter_position`.
- Command section: 3 big buttons "Extend / Stop / Retract" — bound to `shutter_move`.
- Layout reuses `ShutterControl` in non-compact mode, with the same `equipment.type === "awning"` branch swapping labels.
- No "Cycles" / "History" sections in v1 (out of scope — those exist for shutters too if at all).

### FR10 — Zone aggregation

Awnings aggregate independently from shutters:

- `awningsDeployed`: count of awning equipments in the zone (and descendants) whose `shutter_position` data > 0 (= partially or fully deployed).
- `awningsTotal`: total count of awning equipments in zone + descendants.
- Exposed in `ZoneAggregatedData` (`src/shared/types.ts`) and computed in `src/zones/zone-aggregator.ts`. The aggregator already iterates equipment bindings by category; we add a new branch that counts only when the parent equipment type is `awning` (so the same `shutter_position` data is counted in either `shuttersOpen` _or_ `awningsDeployed`, never both).

**Convention note**: for an awning, `position = 100` means **deployed** (closed mechanically, but extended visually). We count `position > 0` as "deployed" because users think of any extension as the awning being in use. For shutters, `position > 0` means "partially open" — same threshold logic, opposite vocabulary. Keeping the threshold consistent simplifies aggregation; only the labels differ.

### FR11 — Zone-level batch commands

Add a parallel triplet of zone commands in `equipment-manager.ts` `ZONE_COMMANDS`:

- `allAwningsExtend`: `{ types: ["awning"], orderCategory: "shutter_move", value: "CLOSE" }` — CLOSE on the RF layer = down = deployed.
- `allAwningsStop`: `{ types: ["awning"], orderCategory: "shutter_move", value: "STOP" }`.
- `allAwningsRetract`: `{ types: ["awning"], orderCategory: "shutter_move", value: "OPEN" }` — OPEN on the RF layer = up = retracted.
- Existing `allShuttersOpen/Stop/Close` stays unchanged and **does not** target awnings (its `types` filter is `["shutter"]`).

### FR12 — i18n strings (FR + EN)

In `ui/src/i18n/locales/{en,fr}.json`:

- `equipments.type.awning`: "Awning" / "Store banne".
- `families.awnings`: "Awnings" / "Stores bannes".
- `controls.extend`: "Extend" / "Déployer".
- `controls.retract`: "Retract" / "Rétracter".
- `controls.deployed`: "Deployed" / "Déployé".
- `controls.retracted`: "Retracted" / "Rétracté".
- `zones.commands.allAwningsExtend`: "Extend all awnings" / "Déployer tous les stores".
- `zones.commands.allAwningsStop`: "Stop all awnings" / "Arrêter tous les stores".
- `zones.commands.allAwningsRetract`: "Retract all awnings" / "Rétracter tous les stores".
- Reuse `controls.stop` (already exists).

### FR13a — Plugin: repo + manifest

- New GitHub repo `mchacher/sowel-plugin-somfy-rts` (public, GPL-3.0 to match the bridge firmware).
- Project skeleton mirrors `sowel-plugin-tasmota` (TypeScript, tsup build to `dist/index.js`, Vitest, ESLint).
- `manifest.json`:
  ```json
  {
    "id": "somfy-rts",
    "type": "integration",
    "name": "Somfy RTS Bridge",
    "description": "Somfy RTS shutters and awnings via a somfyrts2mqtt bridge (ESP32 + CC1101).",
    "icon": "Radio",
    "author": "mchacher",
    "repo": "mchacher/sowel-plugin-somfy-rts",
    "version": "1.0.0",
    "tags": ["somfy", "rts", "shutter", "awning", "mqtt", "rf"],
    "sowelVersion": ">=1.12.0"
  }
  ```
- `createPlugin(deps)` returns an `IntegrationPlugin` with the standard lifecycle (`start`, `stop`, `executeOrder`, `getStatus`).

### FR13b — Plugin: settings

The plugin's settings page (rendered from the manifest's `settingsSchema` or a custom React component, depending on what other plugins do) exposes:

| Setting         | Type   | Default                 | Notes                                                                             |
| --------------- | ------ | ----------------------- | --------------------------------------------------------------------------------- |
| `mqtt.url`      | string | `mqtt://localhost:1883` | Broker URL. Required.                                                             |
| `mqtt.username` | string | —                       | Optional broker auth.                                                             |
| `mqtt.password` | string | —                       | Optional broker auth. Stored as a secret (redacted in logs).                      |
| `bridges.roots` | string | `somfyrts2mqtt`         | Comma-separated list of bridge root topics. One per bridge if multi-bridge setup. |

Settings are stored in the standard `settings` table under `integration.somfy-rts.<key>`.

### FR13c — Plugin: MQTT subscriptions and discovery

On `start()`:

1. Connect to the broker (`mqtt.js` client, persistent session, auto-reconnect with exponential backoff).
2. For each root in `bridges.roots`, subscribe to:
   - `tele/<root>/SENSOR` (QoS 0, aggregated 1 Hz state)
   - `tele/<root>/LWT` (QoS 0, retained)
   - `stat/<root>/+` (QoS 0, per-cmnd ack)
3. On the first `tele/<root>/SENSOR` payload, parse the JSON and create one Sowel Device per top-level key (the remote name). Device ID pattern: `somfy-rts:<root>:<name>`. Display name: the remote name (the user named them in the bridge's UI already).
4. Each Device exposes:
   - **Data**: `shutter_position` (number, 0-100)
   - **Orders**: `shutter_move` (enum: `OPEN`, `STOP`, `CLOSE`), `set_shutter_position` (number, 0-100)
5. On subsequent SENSOR payloads, push `shutter_position` updates via `deviceManager.updateDeviceData()` per remote (only when the value changed — avoid bus storms).
6. On `tele/<root>/LWT` payload change, emit `system.integration.{connected|disconnected}` events keyed on this plugin ID. Disconnected state marks all devices for this root as offline.

### FR13d — Plugin: order dispatch

`executeOrder(device, orderKey, value)` translates as:

| Order key              | Sowel value                 | MQTT publish                                               |
| ---------------------- | --------------------------- | ---------------------------------------------------------- |
| `shutter_move`         | `"OPEN"` / `"open"`         | `cmnd/<root>/<name>/Open` with payload `""`                |
| `shutter_move`         | `"STOP"` / `"stop"`         | `cmnd/<root>/<name>/Stop` with payload `""`                |
| `shutter_move`         | `"CLOSE"` / `"close"`       | `cmnd/<root>/<name>/Close` with payload `""`               |
| `set_shutter_position` | `0..100` (number or string) | `cmnd/<root>/<name>/Position` with payload `String(value)` |

Any other `orderKey` → logged at `warn`, no-op. `<root>` is recovered from the device ID (`somfy-rts:<root>:<name>`).

### FR13e — Plugin: registry entry

Once the first plugin release is tagged (`v1.0.0`), a separate PR to Sowel adds:

```json
{
  "id": "somfy-rts",
  "type": "integration",
  "name": "Somfy RTS Bridge",
  "description": "Somfy RTS shutters and awnings via a somfyrts2mqtt bridge (ESP32 + CC1101).",
  "icon": "Radio",
  "author": "mchacher",
  "repo": "mchacher/sowel-plugin-somfy-rts",
  "version": "1.0.0",
  "tags": ["somfy", "rts", "shutter", "awning", "mqtt", "rf"],
  "sowelVersion": ">=1.12.0",
  "owner": "mchacher",
  "sha256": "<filled by scripts/backfill-registry-sha256.mjs>"
}
```

The `sha256` is populated by `node scripts/backfill-registry-sha256.mjs` per the supply-chain hardening rule (CLAUDE.md spec 089). This registry-update PR is the gating step that makes the plugin installable from Sowel UI — without it, the plugin exists on GitHub but no Sowel install can pull it.

### FR13 — Tests

#### Sowel core

- Unit test (`src/equipments/equipment-manager.test.ts`): `awning` is accepted by `create()`, rejected typos are not.
- Unit test (`src/equipments/equipment-manager.test.ts`): `allAwningsExtend/Stop/Retract` zone commands dispatch to awning equipments only, never to shutters.
- Unit test (`src/zones/zone-aggregator.test.ts`): a zone with 1 awning at position 50 + 1 shutter at position 50 reports `awningsDeployed=1, awningsTotal=1, shuttersOpen=1, shuttersTotal=1` (each counted in its own family).
- Unit test (`src/equipments/binding-candidates.test.ts`): `awning` + `shutter_position` device produces 1 candidate (same as shutter on the same device).
- Unit test (`ui/src/components/equipments/bindingUtils.test.ts`): auto-binding an awning to a `shutter_position` + `shutter_move` device produces aliases `position` + `state`.

#### Plugin

- Unit test (`src/sensor-parser.test.ts`): parsing the bridge `tele/<root>/SENSOR` payload returns the expected list of `{ remoteName, position }` items; missing or non-numeric `Position` is skipped silently with a `warn` log.
- Unit test (`src/order-dispatcher.test.ts`): given a Sowel order `(shutter_move, "OPEN")` for device `somfy-rts:somfyrts2mqtt:kitchen`, the dispatcher publishes `cmnd/somfyrts2mqtt/kitchen/Open` with payload `""`.
- Unit test (`src/order-dispatcher.test.ts`): given `(set_shutter_position, 50)`, publishes `cmnd/.../kitchen/Position` with `"50"`.
- Unit test (`src/order-dispatcher.test.ts`): unknown order key logs `warn` and returns false without throwing.
- Integration test (`src/plugin.test.ts`): boots a fake `mqtt.js` broker, publishes a SENSOR payload, asserts the plugin called `deviceManager.upsertFromDiscovery` once per remote and `deviceManager.updateDeviceData` once per position change.

## Acceptance Criteria

### Sowel core

- [ ] FR1: `awning` is a valid `EquipmentType` accepted by `equipment-manager.ts::create`.
- [ ] FR2: `awnings` is a valid `WidgetFamily` containing `awning`. Dashboard "Add widget" modal offers it.
- [ ] FR3: Selecting any `shutter_position`-exposing device when creating an `awning` produces the same data + order bindings as a shutter would.
- [ ] FR4: `AwningIcon` component renders correctly at sizes 14, 24, 48, 96 px in light + dark mode.
- [ ] FR5: `IconPicker` offers `awning` as a custom icon option.
- [ ] FR6: `EquipmentForm` type dropdown contains "Awning" / "Store banne".
- [ ] FR7: Awning compact row shows "Extend / Stop / Retract" buttons and "Deployed / Retracted / X%" pill.
- [ ] FR8: Dashboard "Awnings" widget per zone with Extend-all / Stop-all / Retract-all buttons.
- [ ] FR9: Awning equipment detail page shows slider + 3 buttons with awning vocabulary.
- [ ] FR10: Zone aggregation exposes `awningsDeployed` + `awningsTotal`. Shutters and awnings counted separately.
- [ ] FR11: `allAwningsExtend/Stop/Retract` zone commands dispatch to awnings only; `allShuttersOpen/Stop/Close` dispatch to shutters only.
- [ ] FR12: All new i18n strings present in `en.json` + `fr.json`.
- [ ] FR13 (core): All new core unit tests pass; pre-existing tests still pass.
- [ ] `npx tsc --noEmit` clean (backend + UI).
- [ ] `npx eslint src/ --ext .ts` clean.
- [ ] No backwards-compat shim: existing `shutter` equipments are untouched.

### Plugin

- [ ] FR13a: New repo `mchacher/sowel-plugin-somfy-rts` exists, GPL-3.0 licensed, with manifest + TypeScript scaffold.
- [ ] FR13b: Plugin settings page lets the user configure broker URL, credentials, and a comma-separated list of bridge roots.
- [ ] FR13c: After the first `tele/<root>/SENSOR` payload, every paired remote appears as a Sowel Device with `shutter_position` data + `shutter_move` + `set_shutter_position` orders.
- [ ] FR13c: Subsequent SENSOR payloads update the device data and propagate through the reactive pipeline to the UI.
- [ ] FR13c: LWT `Online`/`Offline` toggles emit `system.integration.connected/disconnected`.
- [ ] FR13d: Sowel-issued orders translate to the right `cmnd/<root>/<name>/...` topic+payload combinations.
- [ ] FR13d: Unknown order keys log a warn and return without throwing.
- [ ] FR13 (plugin): All plugin unit + integration tests pass; type-check + lint clean on the plugin repo.
- [ ] FR13e: Once plugin `v1.0.0` is tagged + released on GitHub, a Sowel PR adds the registry entry with the correct `sha256` (verified by `scripts/backfill-registry-sha256.mjs`).
- [ ] End-to-end: a user can install the plugin from Admin → Plugins, configure the broker, create an `awning` equipment bound to a discovered remote, and click "Extend" → the bridge moves the motor.

## Edge Cases

### Sowel core

- **User changes a shutter equipment's type to awning** (or the reverse) via the equipment edit form: data/order bindings stay valid (same categories). Aggregation re-computes on `equipment.updated`. Recipes referencing the equipment ID by alias keep working. Verified by an existing equipment-manager test pattern; we add a regression test.
- **Plugin emits a `shutter_position` but the user binds it to an awning equipment**: works exactly like binding a shutter — auto-bind produces the same aliases. The bridge's `invert` flag stays the bridge's concern; from Sowel's side, both equipment types see the same 0-100 number with the same semantics (100 = down position).
- **Awning device offline**: equipment status follows the device. Compact + detail render the position from last known value with a "stale" badge (existing pattern for any equipment, no awning-specific work).
- **Multiple awnings in a zone, mixed positions** (one at 0, one at 80): `awningsDeployed = 1`, `awningsTotal = 2`. Widget shows "1/2 deployed". "Retract all" sends RF Up to both.
- **Awning with only `shutter_move` bound, no `shutter_position`**: compact row hides the slider but still shows the 3 buttons. Detail card hides the position section. Same fallback as shutter today (no new code).
- **Zone command `allAwningsRetract` while one awning is mid-move**: each equipment's `executeOrder` is fire-and-forget. The bridge handles the STOP+OPEN sequence at the RF layer (same as shutter). No new error handling here.
- **i18n missing key fallback**: if a user-supplied locale is missing one of the new keys, react-i18next falls back to the key string (existing project convention). No special handling.

### Plugin

- **Bridge offline at plugin start**: MQTT client keeps reconnecting with exponential backoff (capped at 60 s). No discovery happens until the first SENSOR payload arrives. Plugin status: `disconnected` until then.
- **Bridge online, no remotes paired yet**: SENSOR payload is `{}`. No devices created. Subsequent payloads with new remotes trigger discovery on the fly.
- **Remote unpaired from the bridge**: the next SENSOR payload no longer contains that remote. The plugin does **not** delete the Sowel device automatically (could be a transient bridge bug; would orphan equipments). Instead, the device is marked stale after 5 minutes of no SENSOR mention. User can delete manually from Admin → Devices.
- **Two bridges with the same root** (misconfiguration): MQTT subscriptions collide; the second SENSOR payload overwrites the first. Surfaces as flickering positions. Out of plugin scope to detect — documented as a config caveat in the bridge's MQTT API doc already.
- **Order rejected by bridge** (e.g. uncalibrated remote, `stat/<root>/<name>` ack is `{"error": "not calibrated"}`): plugin logs `warn` with the error payload. Sowel UI shows no immediate feedback (would need a new event type for per-order rejection; out of scope for v1).
- **Broker auth failure**: plugin emits `system.integration.disconnected`, retries with backoff. Surface in the UI badge.
- **Spurious SENSOR payload with malformed JSON**: parser logs `warn` and drops the message. Plugin keeps running.
- **Plugin uninstalled while equipment is bound to one of its devices**: equipment becomes "device unavailable" via the existing plugin-soft-isolation pathway. No new code needed.

## Related

- Companion bridge firmware: [github.com/mchacher/somfyrts2mqtt](https://github.com/mchacher/somfyrts2mqtt). The MQTT contract spoken by the plugin is documented at [docs/mqtt-api.md](https://github.com/mchacher/somfyrts2mqtt/blob/main/docs/mqtt-api.md).
- Reference plugin layout: `mchacher/sowel-plugin-tasmota` — same shape (MQTT-based, settings page, manifest, GH Actions release).
- Reference for the equipment-type spec pattern: spec 062 (water_valve) — same shape: type + family + UI trinity + zone aggregation.
- The Sowel-side change is plugin-agnostic — any integration that exposes `shutter_position` can drive an `awning` equipment (Zigbee2MQTT covers wired as awnings, etc.).
- Prerequisite: none. Additive only.
- Supersedes: none.
