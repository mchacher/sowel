# Architecture: V0.10a Integration Plugin Architecture

## IntegrationPlugin Interface

```ts
interface IntegrationPlugin {
  /** Unique integration type ID (e.g. "zigbee2mqtt", "panasonic-cc") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description for UI */
  readonly description: string;
  /** Icon name (lucide) */
  readonly icon: string;

  /** Current connection/health status */
  getStatus(): IntegrationStatus;

  /** Check if required settings are configured */
  isConfigured(): boolean;

  /** Settings schema for the UI config form */
  getSettingsSchema(): IntegrationSettingDef[];

  /** Start the integration (connect, subscribe, start polling, etc.) */
  start(): Promise<void>;

  /** Stop the integration gracefully */
  stop(): Promise<void>;

  /**
   * Execute an order on a device managed by this integration.
   * Called by EquipmentManager when dispatching an order.
   * @param device The target device
   * @param dispatchConfig The order dispatch config (integration-specific)
   * @param value The value to set
   */
  executeOrder(
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;
}

type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "error";

interface IntegrationSettingDef {
  key: string; // e.g. "mqtt.url"
  label: string; // Display label
  type: "text" | "password" | "number";
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

interface IntegrationInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: IntegrationStatus;
  settings: IntegrationSettingDef[];
  configured: boolean;
}
```

## IntegrationRegistry

```ts
class IntegrationRegistry {
  register(plugin: IntegrationPlugin): void;
  getById(id: string): IntegrationPlugin | undefined;
  getAll(): IntegrationPlugin[];
  getAllInfo(): IntegrationInfo[];
  async startAll(): Promise<void>;
  async stopAll(): Promise<void>;
}
```

- Lives in `src/integrations/integration-registry.ts`
- Called from `index.ts` to register built-in integrations and start them

## Data Model Changes

### `devices` table (migration 011)

| Column             | Before                         | After                                                  |
| ------------------ | ------------------------------ | ------------------------------------------------------ |
| `mqtt_base_topic`  | `TEXT NOT NULL`                | **Removed**                                            |
| `mqtt_name`        | `TEXT NOT NULL`                | **Removed**                                            |
| `integration_id`   | —                              | `TEXT NOT NULL` (e.g. "zigbee2mqtt")                   |
| `source_device_id` | —                              | `TEXT NOT NULL` (unique device key within integration) |
| UNIQUE constraint  | `(mqtt_base_topic, mqtt_name)` | `(integration_id, source_device_id)`                   |

Migration: `integration_id = mqtt_base_topic`, `source_device_id = mqtt_name`

### `device_orders` table (migration 011)

| Column            | Before          | After                        |
| ----------------- | --------------- | ---------------------------- |
| `mqtt_set_topic`  | `TEXT NOT NULL` | **Removed**                  |
| `payload_key`     | `TEXT NOT NULL` | **Removed**                  |
| `dispatch_config` | —               | `JSON NOT NULL DEFAULT '{}'` |

Migration: `dispatch_config = json_object('topic', mqtt_set_topic, 'payloadKey', payload_key)`

### TypeScript types (`types.ts`)

```ts
// Before
export interface Device {
  mqttBaseTopic: string;
  mqttName: string;
  // ...
}

// After
export interface Device {
  integrationId: string; // "zigbee2mqtt", "panasonic-cc", ...
  sourceDeviceId: string; // Unique device key within integration
  // ...
}

// Before
export interface DeviceOrder {
  mqttSetTopic: string;
  payloadKey: string;
  // ...
}

// After
export interface DeviceOrder {
  dispatchConfig: Record<string, unknown>; // Integration-specific
  // ...
}

// Updated DeviceSource to match integrationId
export type DeviceSource =
  | "zigbee2mqtt"
  | "tasmota"
  | "esphome"
  | "shelly"
  | "custom_mqtt"
  | "panasonic_cc";
```

## Event Bus Events

No new events. Existing events remain unchanged:

- `device.discovered`, `device.removed`, `device.status_changed`, `device.data.updated`
- `equipment.order.executed`

New system events:

- `system.integration.connected` → `{ type: "system.integration.connected"; integrationId: string }`
- `system.integration.disconnected` → `{ type: "system.integration.disconnected"; integrationId: string }`

These replace the current `system.mqtt.connected` / `system.mqtt.disconnected` events (which become specific to the zigbee2mqtt integration internally).

## API Changes

### New endpoint

`GET /api/v1/integrations` → Returns `IntegrationInfo[]` (list of all registered integrations with status and settings schema)

`POST /api/v1/integrations/:id/start` → Start an integration
`POST /api/v1/integrations/:id/stop` → Stop an integration

### Changed endpoints

`PUT /api/v1/settings` → Unchanged (settings are still flat key-value, integration settings use prefix `integration.<id>.xxx`)

`POST /api/v1/settings/mqtt/reconnect` → Replaced by `POST /api/v1/integrations/zigbee2mqtt/start`

`GET /api/v1/settings/mqtt/status` → Replaced by `GET /api/v1/integrations` (status per integration)

### Backward compatibility

The old MQTT-specific settings endpoints are removed. The UI is updated to use the new integration endpoints.

## UI Changes

### IntegrationsPage

Currently hardcoded `Zigbee2mqttCard`. Refactor to:

1. Fetch `GET /api/v1/integrations` on mount
2. Render a generic `IntegrationCard` for each integration
3. Each card shows: name, description, status indicator, settings form (from schema), save/start/stop buttons

### Settings stored

Integration settings change prefix from flat (`mqtt.url`, `z2m.baseTopic`) to namespaced (`integration.zigbee2mqtt.mqtt_url`, `integration.zigbee2mqtt.base_topic`).

Migration: existing `mqtt.*` and `z2m.*` settings are migrated to new prefix.

## File Changes

| File                                          | Change                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/shared/types.ts`                         | Update Device, DeviceOrder interfaces. Add IntegrationPlugin types. Add new events. |
| `src/shared/constants.ts`                     | No change                                                                           |
| `src/integrations/integration-registry.ts`    | **New** — IntegrationRegistry class                                                 |
| `src/integrations/zigbee2mqtt/index.ts`       | **New** — Zigbee2MqttIntegration implements IntegrationPlugin                       |
| `src/mqtt/mqtt-connector.ts`                  | Kept as-is (used internally by Zigbee2MqttIntegration)                              |
| `src/mqtt/parsers/zigbee2mqtt.ts`             | Moved into integration, adapted to call DeviceManager generically                   |
| `src/devices/device-manager.ts`               | Remove MQTT-specific columns. Add `integrationId`/`sourceDeviceId`.                 |
| `src/equipments/equipment-manager.ts`         | Replace `mqttConnector.publish()` with `integrationRegistry.executeOrder()`         |
| `src/api/routes/settings.ts`                  | Remove MQTT-specific reconnect/status endpoints                                     |
| `src/api/routes/integrations.ts`              | **New** — Integration management routes                                             |
| `src/api/server.ts`                           | Register integration routes, pass registry                                          |
| `src/index.ts`                                | Create IntegrationRegistry, register Zigbee2MQTT, start integrations                |
| `src/core/settings-manager.ts`                | Add helper for integration-scoped settings                                          |
| `migrations/011_integration_architecture.sql` | **New** — Rename columns, migrate data                                              |
| `ui/src/pages/IntegrationsPage.tsx`           | Refactor to generic integration cards                                               |
| `ui/src/api.ts`                               | Add integration API functions                                                       |
| `ui/src/i18n/locales/fr.json`                 | Integration-related translations                                                    |
| `ui/src/i18n/locales/en.json`                 | Integration-related translations                                                    |

## Pipeline Change

```
Before:
  MqttConnector → Z2MParser → DeviceManager → EventBus → EquipmentManager → mqttConnector.publish()

After:
  IntegrationRegistry
    └── Zigbee2MqttIntegration
         ├── MqttConnector (internal)
         ├── Z2MParser (internal)
         └── calls DeviceManager (same as before)

  EquipmentManager.executeOrder()
    → finds device.integrationId
    → calls integrationRegistry.getById(integrationId).executeOrder()
```
