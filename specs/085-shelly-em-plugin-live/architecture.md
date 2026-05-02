# Architecture — Spec 085 (It 1)

## Two artefacts

This iteration ships two pieces in parallel:

1. **`sowel-plugin-shelly-mqtt`** — new GitHub plugin repo (separate). Subscribes to a Mosquitto broker over MQTT, parses Shelly Pro 3EM RPC status messages, registers one Sowel device per CT channel with live data + cumulative counters. Generic name on purpose: future-proof for other Shelly variants (Pro 4PM, Plus 1PM, etc.) without renaming.
2. **Sowel core changes** — new `/energy/live` route + page, settings to pick grid/solar source equipments, no impact on the existing energy aggregator.

## A. Plugin: `sowel-plugin-shelly-mqtt`

### Layout

```
sowel-plugin-shelly-mqtt/
├── manifest.json
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts                 # createPlugin entry, IntegrationPlugin contract
    ├── mqtt-connector.ts        # Thin wrapper around mqtt.js (connect/sub/handle/disconnect)
    ├── shelly-parser.ts         # Pure functions: parse status payloads into Sowel discoveries + data updates
    ├── shelly-parser.test.ts    # Unit tests
    └── shelly-plugin.ts         # Engine: subscribe to topics, dispatch to deviceManager, lifecycle
```

### Manifest

```json
{
  "id": "shelly_mqtt",
  "type": "integration",
  "name": "Shelly MQTT",
  "version": "1.0.0",
  "description": "Shelly Pro / Plus devices over MQTT (live + cumulative energy from EM channels)",
  "icon": "Zap",
  "repo": "mchacher/sowel-plugin-shelly-mqtt",
  "author": "mchacher",
  "sowelVersion": ">=1.4.2",
  "settings": [
    {
      "key": "mqtt_url",
      "label": "MQTT Broker URL",
      "type": "text",
      "required": true,
      "placeholder": "mqtt://localhost:1883"
    },
    { "key": "mqtt_username", "label": "MQTT Username", "type": "text", "required": false },
    { "key": "mqtt_password", "label": "MQTT Password", "type": "password", "required": false },
    {
      "key": "mqtt_client_id",
      "label": "MQTT Client ID",
      "type": "text",
      "required": false,
      "defaultValue": "sowel-shelly"
    },
    {
      "key": "topic_filter",
      "label": "Topic filter",
      "type": "text",
      "required": false,
      "defaultValue": "shelly/#",
      "placeholder": "e.g. shelly/# — wildcard the plugin subscribes to"
    }
  ],
  "apiVersion": 2
}
```

### MQTT topics consumed (Shelly Pro 3EM, EM1 mode)

Shelly publishes per channel once the `topic_prefix` is configured in the device. We assume the user follows the convention `<prefix>/<device-id>` (e.g. `shelly/shelly-pro3em_00`):

| Topic                             | Payload (JSON)                                                           | Cadence |
| --------------------------------- | ------------------------------------------------------------------------ | ------- |
| `<prefix>/online`                 | `true` / `false` (LWT)                                                   | event   |
| `<prefix>/status/em1:N` (N=0/1/2) | `{ id, voltage, current, act_power, aprt_power, pf, freq, calibration }` | ~1 Hz   |
| `<prefix>/status/em1data:N`       | `{ id, total_act_energy, total_act_ret_energy }`                         | ~1/min  |

The plugin subscribes to a wildcard topic (default `shelly/#`) and routes by topic suffix.

### Device model (Sowel)

Each `em1:N` channel becomes **one Sowel device**:

- `sourceDeviceId` = `<shelly-id>-em<N>` (e.g. `shelly-pro3em_00-em0`)
- `friendlyName` = the channel name from Shelly config when available, else `<shelly-id> · channel N`
- `manufacturer` = `Shelly`
- `model` = `Pro 3EM channel <N>`
- 5 data points:

| Key              | Category  | Unit | Source field           |
| ---------------- | --------- | ---- | ---------------------- |
| `power`          | `power`   | W    | `act_power`            |
| `voltage`        | `voltage` | V    | `voltage`              |
| `current`        | `current` | A    | `current`              |
| `energy_forward` | `energy`  | Wh   | `total_act_energy`     |
| `energy_reverse` | `energy`  | Wh   | `total_act_ret_energy` |

- 0 orders (Pro 3EM is read-only).
- Status: `online` while `<prefix>/online == true`, `offline` on LWT or after 3 missed updates.

### Configuration discovery

To distinguish a true 3EM in `EM1` mode from a 3-phase setup, the plugin requests `Shelly.GetDeviceInfo` over RPC at startup (or relies on first `em1:N` topics). For V1 we **assume EM1 mode** (i.e. 3 independent channels) and only listen to `em1:N` / `em1data:N` topics. 3-phase mode (`em:0/em:1/em:2`) is not supported in this iteration.

### Lifecycle

1. **start()** — read settings, connect MQTT, subscribe to `<topic_filter>`. Status `connected`.
2. **on message** — route by topic:
   - `*/online` → update device statuses for that Shelly
   - `*/status/em1:N` → parse JSON, push `power`/`voltage`/`current` via `deviceManager.updateDeviceData(...)`. Auto-discover device on first message via `upsertFromDiscovery`.
   - `*/status/em1data:N` → push `energy_forward` / `energy_reverse`.
3. **stop()** — disconnect MQTT, mark devices offline.

All handlers wrapped in try/catch; errors logged with `pino` child logger `module: "shelly-mqtt"`.

## B. Sowel core changes

### Route

- `App.tsx` — change the `/energy` redirect from `/energy/consumption` to `/energy/live`. Add `/energy/live` mapped to a new `LiveEnergyPage` component.
- `EnergyMobileNav.tsx` — add `Live` as the first item.

### LiveEnergyPage (`ui/src/components/energy/LiveEnergyPage.tsx`)

UI matches the validated mockup (`specs/085-shelly-em-plugin-live/mockup.html`). Three boxes (maison / réseau / solaire) connected by an orthogonal bus, animated bubbles flowing in the direction of energy, autoconso pill on the maison.

**Data sources** read from Zustand `useEquipments` store. Two equipment ids stored in user settings:

- `energy.live.grid_equipment_id` — equipment with a `power` alias whose value is signed (positive = import, negative = export). Typical: a `main_energy_meter` whose binding maps to Shelly grid CT's `power` data.
- `energy.live.solar_equipment_id` — equipment with a positive `power` alias representing production. Typical: an `energy_production_meter` bound to Shelly solar CT.

When either id is unset, a friendly empty-state prompt appears asking the user to pick the sources.

### Source picker (settings)

A small popover/dropdown above the diagram lets the user pick the two equipments. Only equipments with a numeric `power` alias appear. Saved via `PUT /api/v1/settings` keys:

- `energy.live.grid_equipment_id`
- `energy.live.solar_equipment_id`

### WebSocket

No new event types. The page reacts to existing `equipment.data.changed` events for the chosen equipments via the existing Zustand store. When the page mounts, it subscribes to those events and updates state at every WS message — typical refresh rate ~1 Hz (Shelly's `act_power` cadence).

### Translations

`ui/src/i18n/locales/{en,fr}.json` — add labels:

- `energy.live` / `Live` / `Live`
- `energy.live.title` / `Instant power` / `Puissance instantanée`
- `energy.live.house` / `House` / `Maison`
- `energy.live.grid_label` / `Grid` / `Réseau`
- `energy.live.solar_label` / `Solar` / `Solaire`
- `energy.live.autoconso` / `autoconso` / `autoconso`
- `energy.live.empty.title` / `Configure your live view` / `Configurez votre vue live`
- `energy.live.empty.help` / `Pick the equipment that measures your grid and solar power.` / `Sélectionnez l'équipement qui mesure votre réseau et votre production solaire.`
- `energy.live.source.grid` / `Grid source` / `Source réseau`
- `energy.live.source.solar` / `Solar source` / `Source solaire`

### Cohabitation with Legrand

Legrand stays disabled (per spec 084 §6 — and already disabled on prod + local). Sowel's `EnergyAggregator` continues to ignore generic `energy_meter` equipments — Shelly devices in It 1 expose generic categories, so the aggregator does nothing with them. Iteration 2 (spec 086) will promote them.

## File-level impact

### Sowel core

- `ui/src/App.tsx` — route changes
- `ui/src/components/energy/EnergyMobileNav.tsx` — add Live tab
- `ui/src/components/energy/LiveEnergyPage.tsx` — NEW
- `ui/src/components/energy/LiveDiagram.tsx` — NEW (the SVG bus + nodes from the validated mockup)
- `ui/src/components/energy/LiveSourcePicker.tsx` — NEW (settings popover)
- `ui/src/store/useLiveSources.ts` — NEW (Zustand store reading the two settings)
- `ui/src/api.ts` — small helpers if needed
- `ui/src/i18n/locales/{en,fr}.json` — translations
- `src/api/routes/settings.ts` — no change (uses generic settings endpoint)

### Plugin repo (separate)

- All files listed under "Layout" above, plus `.github/workflows/release.yml` (mirror of tasmota plugin)

### Out of scope

- No SQLite migration
- No new EventBus types
- No new REST routes
- No new Equipment types — generic `energy_meter` is enough for V1
