# Architecture — Spec 121 — `sowel-plugin-energy-display`

## Design decisions

### D1 — MQTT bridge plugin pattern (mirror of `sowel-plugin-somfy-rts`)

The plugin shape is a straight copy of the existing
`sowel-plugin-somfy-rts` (spec 115 work-stream B): a single
long-running MQTT client owns the connection, dispatches inbound
messages to the appropriate handler, and exposes
`executeOrder(device, orderKey, value)` for the outbound path.
There is no per-device state machine; the broker + retained
`state` topic IS the state.

No reinvention here on purpose — the user runs Mosquitto already,
the Sowel plugin manager already understands MQTT plugins, and
`mqtt.js` (which the existing plugins use) handles reconnect with
backoff.

### D2 — `topic_prefix` is a single setting, not per-display

Multiple displays share one topic prefix (default `sowel-display`).
Splitting per display would force the user to configure each one
manually in Sowel Admin, defeating the auto-discovery goal.
Operators who run truly heterogeneous deployments can run several
brokers (or topic namespaces) and configure the plugin once per
broker — but that is a self-inflicted setup, not the target case.

### D3 — `DeviceOrder` declaration is plugin-driven

Per spec 120 D4, the equipment detail UI hides an order control
when the bound device has no matching `DeviceOrder`. The plugin
declares the orders at device-creation time based on **which state
field the display has reported at least once**:

- Device reports `language` → plugin declares `set_language`.
- Device reports `brightness` → plugin declares `set_display_brightness`.
- Otherwise → no order declared, UI hides the control.

This is the polymorphism payoff: a passive single-screen display
that only reports `firmware_version + uptime` ends up with zero
orders and zero controls in the UI — observability without UI
noise.

Concretely: in the state handler, after every `updateDeviceData`,
check whether the matching order is already declared on the device;
if not, append it via `deps.devices.declareOrder(deviceId, ...)`.

### D4 — `availability` LWT drives `Device.status`, not equipment status

`EquipmentStatus` (spec 116) derives "online" / "degraded" / "offline"
from `Device.status` + streaming binding freshness. We do not touch
`EquipmentStatus` here. The plugin's only job on the availability
topic is to call `deps.devices.updateStatus(deviceId, "online" | "offline")`
and let the equipment manager cascade.

Keep-alive is set to 30 s on the MQTT client; LWT therefore fires
~45-60 s after a hard disconnect, which matches the user's tolerance
("see displays go offline within a minute").

### D5 — Permissive JSON parser

Every field in the `state` payload is parsed independently inside a
try/catch — a malformed `rssi` does not poison the parse of
`brightness`. Unknown extras pass through as `generic` data so a
future firmware can extend the payload without a plugin upgrade.

This is the same shape as `today_parse.cpp` in the firmware
(zero-fill on missing fields, no parse error on partial schemas).
Forward + backward compatibility for free.

### D6 — `custom_mqtt` as `DeviceSource`

No new `DeviceSource` enum value. Plugins are polymorphic on the
wire format, not the entity type. A future bridge that publishes
displays over a different protocol (e.g. CoAP) would set its own
source — we do not commit Sowel to a "sowel_display" source value
in `types.ts`.

### D7 — Single PR for the plugin, separate PR for the registry entry

Per the spec 089 supply-chain workflow:

1. Plugin repo creation + first release tag.
2. Registry entry PR on Sowel referencing the GH release tarball +
   the matching SHA256 (computed by
   `scripts/backfill-registry-sha256.mjs`).

The plugin can be installed manually (point Sowel at a local
tarball) before the registry entry lands; the registry PR is what
turns it into a one-click install for other users.

## Plugin manifest

```json
{
  "id": "energy-display",
  "name": "Sowel Energy Display",
  "kind": "integration",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "description": "MQTT supervision for Sowel-supervised displays (energy display, e-paper, ...).",
  "settings": {
    "mqtt_broker_url": {
      "type": "string",
      "required": true,
      "label": "MQTT broker URL (e.g. mqtt://192.168.0.230:1883)"
    },
    "mqtt_user": {
      "type": "string",
      "required": false,
      "label": "MQTT username (optional)"
    },
    "mqtt_pass": {
      "type": "secret",
      "required": false,
      "label": "MQTT password (optional)"
    },
    "topic_prefix": {
      "type": "string",
      "required": false,
      "default": "sowel-display",
      "label": "Topic prefix (default: sowel-display)"
    }
  }
}
```

## File layout (plugin repo)

```
sowel-plugin-energy-display/
├── src/
│   ├── index.ts              # createPlugin entry — wires MQTT client to deps
│   ├── mqtt-client.ts        # broker connect / subscribe / publish wrapper
│   ├── parse-state.ts        # JSON state → DeviceData mapping
│   ├── parse-state.test.ts
│   ├── dispatch-order.ts     # Sowel order → MQTT publish
│   ├── dispatch-order.test.ts
│   └── availability.ts       # LWT handler → device.status
├── manifest.json
├── package.json
├── tsconfig.json
├── README.md
├── .github/workflows/release.yml
└── specs/001-initial-release/spec.md  (migrated copy of THIS doc)
```

The size estimate: ~600 LOC of TS in src/, ~200 LOC of tests, ~100
LOC of release scaffolding. Total plugin ~1 KLOC, in line with the
existing somfy-rts / tasmota plugins.

## Data flow

### Inbound (display → Sowel)

```
display publishes sowel-display/abc/state {...}
  → mqtt-client.ts onMessage(topic, payload)
    → parse-state.ts: split topic, parse JSON, map fields
      → for each canonical field:
          deps.devices.updateDeviceData(deviceId, key, value, category)
        for orders not yet declared:
          deps.devices.declareOrder(deviceId, orderCategory)
      → emit system.integration.connected (first-seen heartbeat)
```

```
display LWT publishes sowel-display/abc/availability "offline"
  → mqtt-client.ts onMessage(topic, payload)
    → availability.ts: parse "online"|"offline"
      → deps.devices.updateStatus(deviceId, status)
        → EventBus: device.status.changed
          → EquipmentManager re-derives EquipmentStatus
            → WebSocket → UI dims the display row
```

### Outbound (Sowel order → display)

```
User clicks "Set brightness 80%" on DisplayDetailCard
  → POST /api/v1/equipments/<id>/orders { category: "set_display_brightness", value: 80 }
    → EquipmentManager.dispatchOrder()
      → plugin.executeOrder(device, "set_display_brightness", 80)
        → dispatch-order.ts: map category → topic suffix
          → mqtt-client.ts: publish sowel-display/abc/cmd/brightness "80"
            → display receives, applies, republishes state with brightness=80
              → loops back to inbound flow, UI sees the new value
```

## Risk register

| Risk                                                    | Mitigation                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin written against draft API and core drift         | Pin `@sowel/plugin-api` to a released version; bump in lockstep with breaking changes (rare since 053).                                                                            |
| MQTT broker unreachable at install time                 | Plugin reports `disconnected` status; user fixes broker URL in Admin; reconnects automatically.                                                                                    |
| Display publishes very chatty state (every 5 s)         | `DeviceManager.updateDeviceData` is idempotent on unchanged values; no event flood.                                                                                                |
| Two displays accidentally share the same `id`           | `upsertFromDiscovery` matches by `(integrationId, sourceDeviceId)` → second display overwrites first. Surface a warning on duplicate first-seen if both have different `hostname`. |
| LWT keep-alive too long (firmware sets keep-alive=300s) | Document the recommended firmware-side keep-alive (30 s) in the firmware spec (035). Plugin tolerates whatever the client picks.                                                   |
