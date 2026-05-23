# Plan — Spec 115 — Somfy RTS bridge: awning equipment + plugin

This spec covers two coordinated work-streams. They can ship in parallel branches but the registry-entry PR (R3) must wait until the plugin has a tagged release.

---

## Work-stream A — Sowel core (this repo)

Branch: `feat/awning-equipment` (one PR).

### A1. Types and constants (foundation)

- [ ] `src/shared/types.ts`: add `"awning"` to `EquipmentType`, `"awnings"` to `WidgetFamily`, `awningsDeployed` + `awningsTotal` to `ZoneAggregatedData`.
- [ ] `src/shared/constants.ts`: add `awnings: ["awning"]` to `WIDGET_FAMILY_TYPES`.

### A2. Backend — equipment manager

- [ ] `src/equipments/equipment-manager.ts`: add `"awning"` to `VALID_EQUIPMENT_TYPES`.
- [ ] `src/equipments/equipment-manager.ts`: add `allAwningsExtend / allAwningsStop / allAwningsRetract` entries to `ZONE_COMMANDS` with `types: ["awning"]`.
- [ ] `src/equipments/binding-candidates.ts`: copy the `case "shutter"` block and add `case "awning"` with identical logic.

### A3. Backend — zone aggregation

- [ ] `src/zones/zone-aggregator.ts`: add `awningsDeployed` + `awningsTotal` to the accumulator, init to 0, merge in the combiner.
- [ ] `src/zones/zone-aggregator.ts`: in the `case "shutter_position"`, branch by `equipment.type` — increment awning counters when `awning`, shutter counters otherwise.
- [ ] `src/zones/zone-aggregator.ts`: update `aggregatedDataEqual` + public projection to include the two new fields.

### A4. Backend tests

- [ ] `src/equipments/equipment-manager.test.ts`: test create({ type: "awning" }) succeeds; create({ type: "awningg" }) throws.
- [ ] `src/equipments/equipment-manager.test.ts`: test `allAwningsExtend` dispatches only to awnings; `allShuttersOpen` dispatches only to shutters when both equipment types exist in the same zone.
- [ ] `src/equipments/binding-candidates.test.ts`: test awning + shutter_position device → 1 candidate.
- [ ] `src/zones/zone-aggregator.test.ts`: test a zone with 1 awning at 50 + 1 shutter at 50 → `awningsDeployed=1, shuttersOpen=1`.

### A5. Frontend — types + bindings

- [ ] Mirror the type additions in any UI-local mirror (`ui/src/types.ts` or similar).
- [ ] `ui/src/components/equipments/bindingUtils.ts`: add `RELEVANT_DATA["awning"]`, `RELEVANT_ORDERS["awning"]`, `awning` in `CANDIDATE_BASED_TYPES`.
- [ ] `ui/src/components/equipments/bindingUtils.test.ts`: test auto-bind on a shutter_position device.

### A6. Frontend — equipment form + selector

- [ ] `ui/src/components/equipments/EquipmentForm.tsx`: add awning option to type dropdown.
- [ ] `ui/src/components/equipments/DeviceSelector.tsx`: add awning to candidate-types list.
- [ ] `ui/src/components/equipments/useEquipmentState.ts`: export `isAwning`.

### A7. Frontend — icon

- [ ] `ui/src/components/icons/AwningIcon.tsx`: new component (canopy + wall + support arm SVG).
- [ ] `ui/src/components/equipments/IconPicker.tsx`: register awning custom icon.
- [ ] `ui/src/components/dashboard/widget-icons.ts`: register `awning` / `awnings` in the icon registry.

### A8. Frontend — compact card (zone row)

- [ ] `ui/src/components/equipments/ShutterControl.tsx`: add `isAwning` branch with translated labels (extend / stop / retract, deployed / retracted / X%). Keep vertical arrows.

### A9. Frontend — dashboard family widget

- [ ] `ui/src/components/dashboard/widget-utils.ts`: add `awning` to widget-friendly types.
- [ ] `ui/src/components/dashboard/AddWidgetModal.tsx`: add `awnings` to FAMILIES.
- [ ] `ui/src/components/dashboard/ZoneWidget.tsx`: new `ZoneAwningWidget`, plumb the family branch.
- [ ] `ui/src/components/dashboard/MobileWidgetCard.tsx`: add `isAwning` branch.
- [ ] `ui/src/components/dashboard/WidgetGrid.tsx`: add `awnings` family handling.
- [ ] `ui/src/components/dashboard/WidgetDetailSheet.tsx`: extend isShutter check, add `ZoneAwningsDetail`, add family-map entry.

### A10. Frontend — i18n

- [ ] `ui/src/i18n/locales/en.json` + `fr.json`: add all keys listed in FR12.

### A11. Validation

- [ ] `npx tsc --noEmit` (backend) — zero errors.
- [ ] `cd ui && npx tsc -b --noEmit` — zero errors.
- [ ] `npx vitest run` — all green.
- [ ] `npx eslint src/ --ext .ts` — zero errors.
- [ ] Manual UI test: create an awning equipment bound to a fake shutter_position device, verify all 3 cards render correctly with awning vocabulary in EN and FR.

### A12. Documentation

- [ ] Update `docs/user/equipments.md` with an "Awnings" section.
- [ ] Update `docs/technical/data-model.md` to mention the new equipment type + family.
- [ ] Update `docs/specs-index.md` with a row for spec 115.
- [ ] Add release-notes entries in `docs/release-notes.md` + `docs/release-notes.fr.md` (will land in the same commit as the version bump at release time).

### A13. PR + merge

- [ ] Open PR `feat: awning equipment type` against `main`.
- [ ] Wait for explicit user approval before merging.
- [ ] Squash-merge, delete branch.

---

## Work-stream B — Plugin `sowel-plugin-somfy-rts` (new repo)

### B1. Create the repo

- [ ] `gh repo create mchacher/sowel-plugin-somfy-rts --public --license GPL-3.0 --description "Somfy RTS shutters and awnings via a somfyrts2mqtt bridge"`.
- [ ] Clone locally under `~/Documents/01_Geekerie/sowel-plugin-somfy-rts/`.

### B2. Scaffold from `sowel-plugin-tasmota`

- [ ] Copy `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.eslintrc.cjs`, `.github/workflows/release.yml` and adapt names / IDs.
- [ ] Create empty src/ with the file structure listed in architecture.md.
- [ ] `npm install`.

### B3. Manifest + settings schema

- [ ] Write `manifest.json` with id `somfy-rts`, version `1.0.0`, settings schema for `mqtt.url`, `mqtt.username`, `mqtt.password`, `bridges.roots`.

### B4. Pure parsers (test-first)

- [ ] Write `src/sensor-parser.ts` with `parseSensorPayload(json: unknown): RemoteUpdate[]`.
- [ ] Write `src/sensor-parser.test.ts` covering: valid payload, missing Position field, non-object payload, empty `{}`.
- [ ] Write `src/order-dispatcher.ts` with `dispatchOrder(client, root, name, orderKey, value): boolean`.
- [ ] Write `src/order-dispatcher.test.ts` covering: shutter_move OPEN/CLOSE/STOP, set_shutter_position number, unknown order key (returns false + warns).

### B5. MQTT client wrapper

- [ ] Write `src/mqtt-client.ts` — wraps mqtt.js with reconnect logic, returns an event emitter for `connect`, `message`, `close`. Settings-driven URL + auth.

### B6. Plugin glue (`src/plugin.ts`)

- [ ] Wire the parser to `deviceManager.upsertFromDiscovery` on the first SENSOR payload per remote.
- [ ] Push `deviceManager.updateDeviceData` on every subsequent position change.
- [ ] Handle LWT messages → `system.integration.connected/disconnected`.
- [ ] `executeOrder` routes through `order-dispatcher`.

### B7. Integration test

- [ ] `src/plugin.test.ts` boots a stub mqtt client (or uses `aedes` in-process broker), publishes a SENSOR payload, asserts the right `deviceManager` calls were made.

### B8. Validation on plugin repo

- [ ] `npm run typecheck` clean.
- [ ] `npm test` all green.
- [ ] `npm run lint` clean.
- [ ] `npm run build` produces `dist/index.js`.
- [ ] Smoke test: install the built tarball into a dev Sowel instance, configure with the real broker (`192.168.0.230:1883`, root `somfyrts2mqtt`), confirm one of the paired terrace remotes shows up as a Device.

### B9. Plugin release

- [ ] Tag `v1.0.0`, push tag, let GitHub Actions build + create the release with the tarball.

### B10. Registry PR to Sowel

- [ ] Back in this Sowel repo, on a new branch `feat/registry-add-somfy-rts`:
  - [ ] Add the registry entry to `plugins/registry.json` (id, name, repo, version 1.0.0, tags, sowelVersion).
  - [ ] Run `node scripts/backfill-registry-sha256.mjs` to fill the SHA256.
  - [ ] Commit `chore(registry): add somfy-rts v1.0.0`.
- [ ] Open PR + wait for user approval + merge.

### B11. End-to-end validation

- [ ] On a Sowel install (dev or sowelox after a release), Admin → Plugins → install Somfy RTS Bridge.
- [ ] Configure broker, save.
- [ ] Verify devices appear under Admin → Devices.
- [ ] Create an awning equipment in a zone, bind to a remote.
- [ ] Click "Extend" → physical motor moves.

---

## Test Plan

### Modules to test (Sowel core)

| Module             | Scenario                                                                        | Expected                                                                |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| equipment-manager  | `create({ type: "awning" })` succeeds                                           | Equipment row inserted, type stored as "awning"                         |
| equipment-manager  | `create({ type: "awningg" })` (typo)                                            | Throws `Invalid equipment type`                                         |
| equipment-manager  | `dispatchZoneCommand("allAwningsExtend")` in a zone with 1 awning + 1 shutter   | Only the awning receives `executeOrder(shutter_move, "CLOSE")`          |
| equipment-manager  | `dispatchZoneCommand("allShuttersOpen")` in the same zone                       | Only the shutter receives `executeOrder(shutter_move, "OPEN")`          |
| equipment-manager  | Change an equipment's type from shutter to awning                               | `equipment.updated` event emitted; bindings preserved (same categories) |
| binding-candidates | `awning` + device with `shutter_position` data + `shutter_move` order           | 1 candidate, grouped under shutter index 1                              |
| zone-aggregator    | Zone with 1 awning at position 50 + 1 shutter at position 50                    | `awningsDeployed=1, awningsTotal=1, shuttersOpen=1, shuttersTotal=1`    |
| zone-aggregator    | Zone with 0 awnings, 2 shutters                                                 | `awningsDeployed=0, awningsTotal=0, shuttersOpen=…, shuttersTotal=2`    |
| zone-aggregator    | Parent zone aggregating 2 children (1 awning, 1 shutter, in different children) | Parent reports `awningsTotal=1, shuttersTotal=1`                        |
| bindingUtils (UI)  | Auto-bind awning to a device exposing `shutter_position` + `shutter_move`       | Aliases produced: `position` + `state` (matching shutter's mapping)     |

### Modules to test (plugin)

| Module           | Scenario                                                       | Expected                                                                                      |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| sensor-parser    | Valid 2-remote SENSOR payload                                  | Returns `[{ name: "kitchen", position: 45 }, { name: "bedroom", position: 0 }]`               |
| sensor-parser    | Payload with missing `Position` for one remote                 | Returns only the valid remote; warns for the other                                            |
| sensor-parser    | Non-object payload (`null`, `[]`, `"foo"`)                     | Returns `[]`, warns                                                                           |
| order-dispatcher | `(shutter_move, "OPEN")` for `somfy-rts:somfyrts2mqtt:kitchen` | Publishes `cmnd/somfyrts2mqtt/kitchen/Open` with `""`, QoS 0                                  |
| order-dispatcher | `(shutter_move, "close")` (lowercase)                          | Same as above with `Close` cmnd                                                               |
| order-dispatcher | `(set_shutter_position, 50)`                                   | Publishes `cmnd/somfyrts2mqtt/kitchen/Position` with `"50"`                                   |
| order-dispatcher | `(set_shutter_position, 150)` out of range                     | Clamps to 100, publishes `"100"`, warns                                                       |
| order-dispatcher | Unknown order key `(foo, "bar")`                               | Returns false, logs `warn`, no publish                                                        |
| plugin           | Boot with stub mqtt, publish SENSOR with 2 remotes             | `deviceManager.upsertFromDiscovery` called twice; `system.integration.connected` emitted once |
| plugin           | Subsequent SENSOR with one remote's position changed           | `deviceManager.updateDeviceData` called once for the changed remote only                      |
| plugin           | LWT changes from `Online` → `Offline`                          | `system.integration.disconnected` emitted; devices marked offline                             |

### Manual verification (Sowel core PR)

- [ ] Boot dev Sowel, create a fake shutter device via the test fixtures (or use a real Z2M cover).
- [ ] Create an awning equipment bound to it.
- [ ] Verify compact zone row shows "Extend / Stop / Retract" buttons (EN) and "Déployer / Arrêter / Rétracter" (FR).
- [ ] Verify dashboard "Awnings" widget appears under the family list.
- [ ] Verify "Retract all" dispatches an order to the bound device.
- [ ] Verify a separate `shutter` equipment in the same zone is NOT affected by "Retract all".

### Manual verification (plugin)

- [ ] Install plugin tarball into dev Sowel.
- [ ] Configure broker 192.168.0.230:1883, root `somfyrts2mqtt`.
- [ ] Verify each paired remote shows up under Admin → Devices.
- [ ] Bind one as an awning, send "Extend" — the physical motor moves.
- [ ] Disconnect the bridge (power off), verify Sowel UI shows the integration as disconnected within ~10 s.
- [ ] Reconnect, verify state recovers.

---

## Risks and mitigations

- **Risk**: Spec 053+ plugin types may have evolved since `sowel-plugin-tasmota` was last released — the new plugin might need a newer `plugin-api` interface.
  **Mitigation**: pin to the version used by `tasmota` initially; bump only if needed.
- **Risk**: Plugin soft isolation (spec 111) refuses an emit type or settings key.
  **Mitigation**: settings keys are under our own `integration.somfy-rts.*` namespace (allowed by default). The only emitted events are `system.integration.{connected,disconnected}` which are in `ALLOWED_EMIT_TYPES`. No special opt-out needed.
- **Risk**: The bridge's SENSOR payload format changes in a future firmware release.
  **Mitigation**: parser is permissive; missing fields produce warns, not crashes. Bridge MQTT API is documented at the bridge repo; both sides reference the same doc.
- **Risk**: Multiple bridges with the same root cause overlapping discovery.
  **Mitigation**: documented edge case; rely on user configuration.

---

## Release strategy

- **Sowel PR (work-stream A)**: merged → ships in the next Sowel release (likely v1.12.x). Awning equipment becomes usable for any user binding it to an existing shutter_position device.
- **Plugin repo (work-stream B)**: tagged `v1.0.0`, GH release built, smoke-tested by maintainer before the registry PR.
- **Registry PR (R3)**: merged → plugin appears in Sowel Admin → Plugins within 1h (CDN cache). End-to-end Somfy RTS support unlocked.

The three steps are loosely coupled — A can ship without B; B can ship without R3 (manual install); R3 unlocks the marketplace path.
