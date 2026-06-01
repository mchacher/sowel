# Spec 121 — `sowel-plugin-energy-display` MQTT supervision plugin

## Context

Spec 120 introduces the `display` equipment type in Sowel. The
equipment is plugin-agnostic on purpose: any integration that emits
data of the right `DataCategory` values can bind to a `display`.
This spec ships **the first such integration** — a thin MQTT
supervision plugin that turns any "Sowel-supervised display"
publishing to a known topic structure into a Sowel `Device`.

The plugin reuses the exact same pattern as `sowel-plugin-somfy-rts`
(spec 115, work-stream B): broker URL configured from Sowel Admin,
LWT-based availability, JSON state payloads, command publishes
triggered by Sowel orders.

The first display vendor under supervision is the
`sowel-energy-display` firmware (separate iter 035, separate repo).
The contract documented here is the canonical MQTT wire format —
any future display (e-paper, ePOS, OLED) only needs to publish to
the same topics to be picked up; no Sowel or plugin change required.

This spec lives in Sowel for now because the plugin repo does not
exist yet and Sowel is where the registry tracks it. When the
`sowel-plugin-energy-display` repo is created, the spec migrates to
`specs/001-initial-release/` in that repo verbatim.

## Goals

1. Create a new GitHub repo `mchacher/sowel-plugin-energy-display`
   following the spec-053+ plugin layout (manifest, `dist/index.js`,
   release workflow, SHA256 in Sowel's registry).
2. Connect to a user-configured MQTT broker (URL + optional
   user/pass), driven by Sowel Admin → Plugins → Energy Display.
3. Subscribe to `<topic_prefix>/+/availability` and
   `<topic_prefix>/+/state` (default prefix `sowel-display`).
4. Auto-discover devices: on the first `state` payload seen for an
   unknown `<id>`, call `deps.devices.upsertFromDiscovery(...)` so
   Sowel creates a `Device` named after `state.hostname` (or
   `state.id` as fallback).
5. Translate `state` JSON fields into `DeviceData` rows with the
   canonical category mapping (spec 120):
   - `version` → `firmware_version`
   - `uptime_s` → `uptime`
   - `rssi` → `rssi`
   - `language` → `language`
   - `brightness` → `display_brightness`
   - any other field → `generic` with the JSON key as data key.
6. Mark the underlying device offline within ~30 s when the
   `availability` topic flips to `offline` (LWT fires) — so Sowel's
   `EquipmentStatus` derivation (spec 116) cascades to the
   `display` equipment.
7. Translate Sowel orders to outbound publishes:
   - `set_language` → publish `<topic_prefix>/<id>/cmd/language`,
     payload = the order's value (`"fr"` / `"en"`).
   - `set_display_brightness` → publish
     `<topic_prefix>/<id>/cmd/brightness`, payload = integer string
     (`"80"`).
   - Future vendor-specific orders follow the same `cmd/<key>` shape.
8. Emit `system.integration.connected` /
   `system.integration.disconnected` events on broker connect /
   disconnect, mirroring spec 111's allowed event list.
9. Ship a manifest + README + minimal test suite + GitHub release
   pipeline matching the patterns of `sowel-plugin-tasmota`.
10. Add the registry entry to Sowel's `plugins/registry.json` once
    the first plugin release is tagged (separate PR after the
    plugin ships, per the spec 089 SHA256 workflow).

## Non-Goals

- The `display` equipment type, its data categories, or its UI —
  owned by spec 120.
- The firmware-side implementation — owned by sowel-energy-display
  iter 035, separate repo.
- TLS / mutual auth with the broker — local LAN only for v1.
  Internet-exposed broker = its own iter.
- OTA push from Sowel to displays — future iter.
- Pairing / un-pairing displays from Sowel Admin. Displays are
  self-registering via their `state` payload; admin gets a Devices
  list, not a pairing UI.
- Migrating an existing pre-MQTT display (the current AMOLED
  firmware that polls the Sowel REST API). The polling path stays
  alive in parallel until iter 035 lands and the user opts in to
  MQTT supervision by configuring the broker in the captive portal.
- `cmd/screen` (switch screen). Per spec 120, Sowel does not model
  the display's current screen. A vendor that wants to expose it
  may publish a `cmd/screen` topic and ignore the unknown order on
  the plugin side — the plugin will not standardise it.

## MQTT contract (canonical)

Topic root: `<topic_prefix>/<id>/...` — `<topic_prefix>` defaults to
`sowel-display` and is the only Sowel-side knob (one value shared by
all supervised displays). `<id>` is each display's stable identifier
(MAC-derived, generated firmware-side on first boot, stored in NVS).

| Topic                        | Direction | Retained | Payload                                                |
| ---------------------------- | --------- | -------- | ------------------------------------------------------ |
| `<prefix>/<id>/availability` | sub       | yes      | `online` or `offline` (LWT publishes `offline`)        |
| `<prefix>/<id>/state`        | sub       | yes      | JSON (see below), every ~30 s + on change              |
| `<prefix>/<id>/cmd/<key>`    | pub       | no       | string / number / enum, per the order being dispatched |

### `state` JSON (canonical)

```json
{
  "id": "sowel-display-9a3b1c",
  "version": "1.2.1",
  "uptime_s": 12345,
  "hostname": "sowel-display-9a3b1c",
  "ip": "192.168.0.123",
  "rssi": -55,
  "language": "fr",
  "brightness": 80
}
```

| Field         | Tier            | DataCategory mapping                        |
| ------------- | --------------- | ------------------------------------------- |
| `id`          | mandatory       | not a data row — used as `sourceDeviceId`   |
| `version`     | mandatory       | `firmware_version`                          |
| `uptime_s`    | mandatory       | `uptime`                                    |
| `hostname`    | recommended     | not a data row — used to seed `Device.name` |
| `ip`          | recommended     | `generic`, key `ip_address`                 |
| `rssi`        | recommended     | `rssi`                                      |
| `language`    | recommended     | `language`                                  |
| `brightness`  | vendor-specific | `display_brightness`                        |
| anything else | vendor-specific | `generic`, key = the JSON field name        |

The plugin is **permissive**: unknown / missing / null fields never
fail the parse — each field is mapped independently inside a
try/catch and a parse failure on one field is logged but does not
poison the rest.

### `cmd/<key>` payloads

| Sowel `OrderCategory`    | Topic suffix     | Payload format        |
| ------------------------ | ---------------- | --------------------- |
| `set_language`           | `cmd/language`   | `"fr"` or `"en"`      |
| `set_display_brightness` | `cmd/brightness` | integer 5..100, ASCII |
| vendor-specific (future) | `cmd/<key>`      | string                |

Vendor-specific orders are dispatched by the plugin only when the
device declares the matching `DeviceOrder` — declaration is
plugin-driven (see D3 in `architecture.md`).

## Acceptance criteria

### Wiring

- [ ] Repo `mchacher/sowel-plugin-energy-display` exists with the
      spec-053+ layout.
- [ ] `pluginManifest.json` declares the integration with
      `id: "energy-display"`, `kind: "integration"`, the required
      settings (`mqtt_broker_url`, `mqtt_user?`, `mqtt_pass?`,
      `topic_prefix?`).
- [ ] GitHub Actions release workflow tags + builds + uploads the
      tarball; SHA256 is added to Sowel's `plugins/registry.json`
      via `scripts/backfill-registry-sha256.mjs`.

### Behaviour

- [ ] Plugin connects to the configured broker on `start()`, emits
      `system.integration.connected`.
- [ ] On broker disconnect, `system.integration.disconnected` is
      emitted within ~5 s.
- [ ] On first `state` payload for a new `<id>`, a `Device` is
      auto-created with `source: "custom_mqtt"` and named after
      `state.hostname`.
- [ ] On every `state` payload, the canonical fields map to the
      right `DataCategory` and `DeviceData.value` is updated.
- [ ] On `availability=offline`, the device's `status` flips to
      `"offline"` within ~30 s.
- [ ] On Sowel order with category `set_language`, the plugin
      publishes to `<prefix>/<id>/cmd/language` with the order
      value.
- [ ] On Sowel order with category `set_display_brightness`,
      idem for `cmd/brightness`.

### Tests

- [ ] `parse-state.test.ts`: 5 fixtures (full payload, mandatory
      only, missing optional, unknown extras, malformed JSON).
- [ ] `dispatch-order.test.ts`: 2 fixtures (set_language,
      set_display_brightness) — assert the published topic +
      payload via a mock broker.
- [ ] `availability.test.ts`: LWT flip → Device.status update.

## Edge cases

- **Broker reachable but no displays publishing yet** — plugin
  reports `connected`, devices list stays empty. No error.
- **Display publishes `state` with `id` missing** — drop the
  message + log a warning (without `id`, we cannot key the device).
- **Display publishes `state` then disconnects ungracefully** —
  LWT fires `offline`, plugin marks device offline. When the
  display reconnects, the next `state` re-flips it to online
  (existing `Device` is reused via `upsertFromDiscovery`).
- **User changes `topic_prefix` after devices were discovered** —
  old devices keep their `sourceDeviceId`; new devices appear
  under the new prefix. The plugin does not auto-migrate; the
  user deletes the obsolete devices via Admin.
- **Order issued while the device is offline** — plugin publishes
  to `cmd/<key>` anyway. The display will not receive it (it is
  disconnected); the order is fire-and-forget. The Sowel UI does
  not block the request — consistent with the lights / shutters
  behaviour.
- **`brightness` value out of bounds** — plugin clamps to 0..100
  before publishing. Out-of-range incoming state is logged and
  ignored.
- **Concurrent `state` from same `<id>` racing** — `DeviceManager`
  is the synchronisation point; the plugin just calls
  `updateDeviceData` in order. Last-writer-wins is the existing
  Sowel semantic.
