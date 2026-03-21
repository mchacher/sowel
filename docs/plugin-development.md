# Sowel Plugin Development Guide

This guide explains how to create a third-party plugin for Sowel. A plugin is a self-contained integration that can be installed, enabled, disabled, and removed at runtime without restarting the Sowel engine.

---

## Table of Contents

1. [Overview](#overview)
2. [Plugin Structure](#plugin-structure)
3. [Manifest Schema](#manifest-schema)
4. [PluginDeps API Reference](#plugindeps-api-reference)
5. [Creating a Plugin Step by Step](#creating-a-plugin-step-by-step)
6. [Device Discovery](#device-discovery)
7. [Device Data Updates](#device-data-updates)
8. [Order Execution](#order-execution)
9. [Settings](#settings)
10. [Publishing](#publishing)
11. [Example: Minimal Plugin](#example-minimal-plugin)

---

## Overview

A Sowel plugin is a Node.js package that exports a factory function. When loaded, Sowel injects a `PluginDeps` object providing access to core services (logging, event bus, device management, settings, MQTT). The plugin uses these dependencies to discover devices, push data updates, and handle orders — exactly like built-in integrations.

Plugins live in the `plugins/` directory at the Sowel root. Each plugin has its own subdirectory containing a `manifest.json` and compiled JavaScript.

**Lifecycle:**

1. Sowel reads `plugins/*/manifest.json` on startup
2. For each enabled plugin, Sowel calls `require(pluginPath)` to load the factory
3. The factory receives `PluginDeps` and returns an `IntegrationPlugin` instance
4. Sowel calls `plugin.start()` to activate the integration
5. On disable/uninstall, Sowel calls `plugin.stop()` to clean up

---

## Plugin Structure

```
plugins/
  my-plugin/
    manifest.json          # Plugin metadata and configuration
    package.json           # Node.js package descriptor
    dist/
      index.js             # Compiled entry point (CommonJS)
      index.js.map         # Source map (optional)
    src/
      index.ts             # TypeScript source (not loaded by Sowel)
    node_modules/          # Plugin-specific dependencies (if any)
    README.md              # Plugin documentation
```

**Key rules:**

- The `dist/index.js` file is the entry point loaded by Sowel
- Use CommonJS format (`module.exports`) — Sowel uses `require()` to load plugins
- The `src/` directory is for development only; Sowel never reads it
- Plugin-specific `node_modules/` are isolated from Sowel's dependencies

---

## Manifest Schema

The `manifest.json` file describes the plugin to Sowel. All fields are required unless marked optional.

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Short description of what this plugin does",
  "author": "Your Name",
  "license": "MIT",
  "sowelVersion": ">=0.10.0",
  "entry": "dist/index.js",
  "integrationId": "my-plugin",
  "settings": [
    {
      "key": "apiKey",
      "label": "API Key",
      "type": "string",
      "required": true,
      "secret": true
    },
    {
      "key": "pollInterval",
      "label": "Poll Interval (seconds)",
      "type": "number",
      "required": false,
      "default": 300
    }
  ],
  "repository": "https://github.com/user/sowel-plugin-my-plugin"
}
```

### Field Reference

| Field           | Type   | Description                                                                                                                      |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | string | Unique plugin identifier. Use lowercase with hyphens (e.g., `netatmo-security`). Must match the directory name under `plugins/`. |
| `name`          | string | Human-readable display name shown in the UI.                                                                                     |
| `version`       | string | SemVer version (e.g., `1.0.0`).                                                                                                  |
| `description`   | string | Short description (one sentence) shown in the plugin store.                                                                      |
| `author`        | string | Author name or organization.                                                                                                     |
| `license`       | string | SPDX license identifier (e.g., `MIT`, `Apache-2.0`).                                                                             |
| `sowelVersion`  | string | SemVer range of compatible Sowel versions (e.g., `>=0.10.0`).                                                                    |
| `entry`         | string | Relative path to the compiled entry point (usually `dist/index.js`).                                                             |
| `integrationId` | string | Integration identifier used in device source attribution. Typically same as `id`.                                                |
| `settings`      | array  | (Optional) Array of setting definitions. See [Settings](#settings).                                                              |
| `repository`    | string | (Optional) GitHub repository URL for linking and updates.                                                                        |

---

## PluginDeps API Reference

When Sowel loads a plugin, it passes a `PluginDeps` object to the factory function. This is the plugin's gateway to all Sowel core services.

### `logger`

**Type:** `pino.Logger`

A child logger pre-configured with `{ module: "plugin:<pluginId>" }`. Use this for all logging — never use `console.log`.

```typescript
deps.logger.info({ deviceCount: 5 }, "Devices discovered");
deps.logger.debug({ response }, "API response received");
deps.logger.error({ err }, "Poll failed");
```

**Level guidelines:**

- `info` — significant events (connected, discovered devices, poll completed)
- `debug` — operational details (API responses, intermediate steps)
- `trace` — high-volume data (every message, every data point)
- `error` — operation failed, include `{ err }` with the Error object
- `warn` — unexpected but handled (retry, fallback)

### `eventBus`

**Type:** `EventBus`

The typed event emitter. Plugins can emit and listen to events.

```typescript
// Listen for equipment orders targeting your integration
deps.eventBus.on("equipment.order.dispatched", (event) => {
  if (event.integrationId === manifest.integrationId) {
    // Handle the order
  }
});
```

**Common events:**

- `device.data.updated` — a device's data changed
- `equipment.order.dispatched` — an order needs to be sent to a device
- `integration.status.changed` — integration connection status changed

### `settingsManager`

**Type:** `SettingsManager`

Read and write integration settings stored in the SQLite `settings` table.

```typescript
// Read a setting
const apiKey = deps.settingsManager.get("my-plugin", "apiKey");

// Read all settings for your integration
const allSettings = deps.settingsManager.getAll("my-plugin");

// Write a setting
deps.settingsManager.set("my-plugin", "lastPollTime", Date.now().toString());
```

**Methods:**
| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `(integrationId: string, key: string) => string \| undefined` | Get a single setting value |
| `getAll` | `(integrationId: string) => Record<string, string>` | Get all settings for an integration |
| `set` | `(integrationId: string, key: string, value: string) => void` | Set a setting value |

### `deviceManager`

**Type:** `DeviceManager`

Manage devices discovered by your plugin.

```typescript
// Discover or update a device
deps.deviceManager.upsertFromDiscovery({
  sourceId: "netatmo:aa:bb:cc:dd:ee",
  name: "Indoor Camera",
  source: "netatmo-security",
  category: "camera",
  data: {
    status: { value: "online", label: "Status" },
    motionDetected: { value: false, label: "Motion" },
  },
  orders: ["setMonitoring"],
});

// Update device data (after initial discovery)
deps.deviceManager.updateData("device-uuid", {
  motionDetected: { value: true, label: "Motion" },
});
```

**Methods:**
| Method | Signature | Description |
|--------|-----------|-------------|
| `upsertFromDiscovery` | `(discovery: DeviceDiscovery) => Device` | Create or update a device from discovery data. Returns the Device object with its UUID. |
| `updateData` | `(deviceId: string, data: Record<string, DataPoint>) => void` | Update one or more data points on an existing device. Triggers `device.data.updated` event. |
| `getBySourceId` | `(sourceId: string) => Device \| undefined` | Look up a device by its integration-specific source ID. |
| `getBySource` | `(source: string) => Device[]` | Get all devices from a given source/integration. |

### `mqttConnector`

**Type:** `MqttConnectorFactory`

Factory to create MQTT client connections. Use this if your plugin needs to communicate via MQTT (e.g., for local device protocols).

```typescript
const client = await deps.mqttConnector.create({
  brokerUrl: "mqtt://192.168.1.100:1883",
  clientId: "sowel-my-plugin",
  username: "optional",
  password: "optional",
});

client.on("message", (topic, payload) => {
  // Handle incoming MQTT messages
});

await client.subscribe("my-plugin/devices/#");
```

> **Note:** Most cloud-based plugins (REST APIs) do not need MQTT. Only use this if your integration communicates via an MQTT broker.

### `pluginDir`

**Type:** `string`

Absolute path to the plugin's directory (e.g., `/app/plugins/my-plugin`). Use this for reading local files or storing plugin-specific data.

```typescript
const dataPath = path.join(deps.pluginDir, "cache.json");
```

---

## Creating a Plugin Step by Step

### 1. Initialize the project

```bash
mkdir sowel-plugin-my-device
cd sowel-plugin-my-device
npm init -y
npm install -D typescript @types/node
```

### 2. Configure TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

### 3. Define the types

You don't need to import Sowel types directly. Your plugin's factory function receives `PluginDeps` and returns an object conforming to `IntegrationPlugin`. Use the following interface as a reference:

```typescript
// Reference types — these are provided by Sowel at runtime
interface IntegrationPlugin {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): IntegrationStatus;
  executeOrder?(deviceId: string, order: string, params?: Record<string, unknown>): Promise<void>;
}

type IntegrationStatus = "connected" | "disconnected" | "connecting" | "error";
```

### 4. Implement the plugin

Create `src/index.ts`:

```typescript
interface PluginDeps {
  logger: any;
  eventBus: any;
  settingsManager: any;
  deviceManager: any;
  mqttConnector?: any;
  pluginDir: string;
}

function createPlugin(deps: PluginDeps) {
  const { logger, settingsManager, deviceManager } = deps;
  let pollTimer: NodeJS.Timeout | null = null;
  let status: "connected" | "disconnected" | "connecting" | "error" = "disconnected";

  async function poll() {
    try {
      // Fetch data from your API / device
      // Update devices with deviceManager
      status = "connected";
    } catch (err) {
      logger.error({ err }, "Poll failed");
      status = "error";
    }
  }

  return {
    id: "my-plugin",

    async start() {
      logger.info("Starting my-plugin");
      status = "connecting";

      const interval = Number(settingsManager.get("my-plugin", "pollInterval") || 300);
      await poll();
      pollTimer = setInterval(poll, interval * 1000);
    },

    async stop() {
      logger.info("Stopping my-plugin");
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      status = "disconnected";
    },

    getStatus() {
      return status;
    },

    async executeOrder(deviceId: string, order: string, params?: Record<string, unknown>) {
      logger.info({ deviceId, order, params }, "Executing order");
      // Send command to your device/API
    },
  };
}

module.exports = { createPlugin };
```

### 5. Build

```bash
npx tsc
```

This produces `dist/index.js` (CommonJS) ready for Sowel to load.

### 6. Create the manifest

Create `manifest.json` at the plugin root:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "Integration with My Device",
  "author": "Your Name",
  "license": "MIT",
  "sowelVersion": ">=0.10.0",
  "entry": "dist/index.js",
  "integrationId": "my-plugin",
  "settings": [],
  "repository": "https://github.com/yourname/sowel-plugin-my-device"
}
```

### 7. Test locally

Copy or symlink the plugin directory into Sowel's `plugins/` directory:

```bash
# From the Sowel root
ln -s /path/to/sowel-plugin-my-device plugins/my-plugin
```

Start Sowel — it will detect and load the plugin automatically. Check the logs for your plugin's output:

```
[info] plugin:my-plugin — Starting my-plugin
```

---

## Device Discovery

When your plugin detects devices (from an API, MQTT, or local scan), register them with `deviceManager.upsertFromDiscovery()`.

```typescript
const device = deps.deviceManager.upsertFromDiscovery({
  sourceId: "my-plugin:device-001", // Unique within your integration
  name: "Living Room Sensor", // Human-readable name
  source: "my-plugin", // Must match your integrationId
  category: "sensor", // Device category (see below)
  data: {
    temperature: { value: 21.5, label: "Temperature", unit: "C" },
    humidity: { value: 45, label: "Humidity", unit: "%" },
    battery: { value: 87, label: "Battery", unit: "%" },
  },
  orders: [], // Commands this device accepts
});

// device.id is the Sowel UUID — store it for future data updates
```

**Device categories:** `light`, `shutter`, `sensor`, `thermostat`, `camera`, `lock`, `switch`, `gate`, `hvac`, `other`

**Important:**

- `sourceId` must be unique and stable across restarts (use the device's hardware ID or MAC address)
- Call `upsertFromDiscovery()` on every poll cycle — it is idempotent (creates on first call, updates on subsequent calls)
- Include all known data points in the initial discovery

---

## Device Data Updates

After initial discovery, push data updates when new values arrive. Use `deviceManager.updateData()` with the Sowel device UUID.

```typescript
// On receiving new data from your device
deps.deviceManager.updateData(device.id, {
  temperature: { value: 22.1, label: "Temperature", unit: "C" },
  humidity: { value: 43, label: "Humidity", unit: "%" },
});
```

This triggers the reactive pipeline:

1. `device.data.updated` event is emitted
2. Equipment bindings are re-evaluated
3. Zone aggregations are updated
4. Scenario triggers are checked
5. UI receives WebSocket update

**Tips:**

- Only include data points that changed (partial updates are fine)
- For boolean sensors (motion, contact), use `{ value: true/false }`
- For enum states, use string values: `{ value: "home" }`, `{ value: "away" }`

---

## Order Execution

When a user or scenario sends a command to a device managed by your plugin, Sowel calls `executeOrder()` on your plugin instance.

```typescript
async executeOrder(deviceId: string, order: string, params?: Record<string, unknown>) {
  const device = deps.deviceManager.getBySourceId(/* ... */);

  switch (order) {
    case "setMonitoring":
      await myApi.setMonitoring(device.sourceId, params?.enabled as boolean);
      break;

    case "setTemperature":
      await myApi.setTemperature(device.sourceId, params?.temperature as number);
      break;

    default:
      deps.logger.warn({ order }, "Unknown order");
  }
}
```

**Order flow:**

1. User taps a button in the UI or a scenario action fires
2. Equipment dispatches order to the bound device
3. Sowel routes the order to the plugin that owns the device
4. Plugin's `executeOrder()` is called
5. Plugin sends the command to the physical device
6. On next poll (or push update), the new state is reflected

**Best practices:**

- Validate params before sending to the device
- Log orders at `info` level
- After executing, poll immediately if possible to confirm the state change
- Throw an error if the order fails — Sowel will log it and notify the user

---

## Settings

Plugins declare their settings in `manifest.json`. Sowel renders a settings form in the UI automatically based on this schema.

### Declaring Settings

```json
{
  "settings": [
    {
      "key": "apiKey",
      "label": "API Key",
      "type": "string",
      "required": true,
      "secret": true,
      "description": "Your API key from the developer portal"
    },
    {
      "key": "pollInterval",
      "label": "Poll Interval",
      "type": "number",
      "required": false,
      "default": 300,
      "description": "How often to fetch data (seconds)"
    },
    {
      "key": "region",
      "label": "Region",
      "type": "select",
      "required": true,
      "options": ["eu", "us", "asia"],
      "default": "eu"
    },
    {
      "key": "enableNotifications",
      "label": "Enable Notifications",
      "type": "boolean",
      "required": false,
      "default": false
    }
  ]
}
```

### Setting Field Schema

| Field         | Type     | Description                                                   |
| ------------- | -------- | ------------------------------------------------------------- |
| `key`         | string   | Setting identifier (used in `settingsManager.get()`)          |
| `label`       | string   | Display label in the UI                                       |
| `type`        | string   | One of: `string`, `number`, `boolean`, `select`               |
| `required`    | boolean  | Whether the setting must be filled before enabling the plugin |
| `secret`      | boolean  | (Optional) If true, the value is masked in the UI             |
| `default`     | any      | (Optional) Default value                                      |
| `description` | string   | (Optional) Help text shown below the input                    |
| `options`     | string[] | (Required for `select` type) Available choices                |

### Reading Settings at Runtime

```typescript
const apiKey = deps.settingsManager.get("my-plugin", "apiKey");
if (!apiKey) {
  deps.logger.warn("API key not configured, skipping poll");
  return;
}

const pollInterval = Number(deps.settingsManager.get("my-plugin", "pollInterval") || "300");
```

---

## Publishing

To make your plugin available in the Sowel plugin store, create a GitHub release.

### 1. Prepare the release artifact

Create a tarball containing the plugin files (without `src/` or `node_modules/` dev dependencies):

```bash
# Build first
npm run build

# Create tarball
tar -czf sowel-plugin-my-device-1.0.0.tar.gz \
  manifest.json \
  package.json \
  dist/ \
  node_modules/   # only production dependencies, if any
```

### 2. Create a GitHub release

```bash
gh release create v1.0.0 \
  sowel-plugin-my-device-1.0.0.tar.gz \
  --title "v1.0.0" \
  --notes "Initial release"
```

### 3. Register in the Sowel plugin registry

Submit a PR to the Sowel repository adding your plugin to `plugins/registry.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Integration with My Device",
  "author": "Your Name",
  "repository": "https://github.com/yourname/sowel-plugin-my-device",
  "category": "sensor"
}
```

Once merged, your plugin will appear in the Sowel plugin store UI.

### Release naming convention

- Tag: `v1.0.0` (SemVer with `v` prefix)
- Asset: `sowel-plugin-<id>-<version>.tar.gz`
- The version in the tarball's `manifest.json` must match the release tag

---

## Example: Minimal Plugin

A complete, minimal plugin that polls a fictional REST API every 5 minutes and exposes temperature sensors.

**`manifest.json`:**

```json
{
  "id": "weather-station",
  "name": "Weather Station",
  "version": "0.1.0",
  "description": "Reads temperature from a local weather station API",
  "author": "Sowel Community",
  "license": "MIT",
  "sowelVersion": ">=0.10.0",
  "entry": "dist/index.js",
  "integrationId": "weather-station",
  "settings": [
    {
      "key": "stationUrl",
      "label": "Station URL",
      "type": "string",
      "required": true,
      "description": "Base URL of the weather station API (e.g., http://192.168.1.50)"
    },
    {
      "key": "pollInterval",
      "label": "Poll Interval (seconds)",
      "type": "number",
      "required": false,
      "default": 300
    }
  ]
}
```

**`src/index.ts`:**

```typescript
interface PluginDeps {
  logger: any;
  eventBus: any;
  settingsManager: any;
  deviceManager: any;
  pluginDir: string;
}

interface StationReading {
  temperature: number;
  humidity: number;
  pressure: number;
}

function createPlugin(deps: PluginDeps) {
  const { logger, settingsManager, deviceManager } = deps;
  let pollTimer: NodeJS.Timeout | null = null;
  let status: "connected" | "disconnected" | "connecting" | "error" = "disconnected";

  async function fetchReading(url: string): Promise<StationReading> {
    const response = await fetch(`${url}/api/reading`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<StationReading>;
  }

  async function poll() {
    const stationUrl = settingsManager.get("weather-station", "stationUrl");
    if (!stationUrl) {
      logger.warn("Station URL not configured");
      return;
    }

    try {
      const reading = await fetchReading(stationUrl);

      deviceManager.upsertFromDiscovery({
        sourceId: "weather-station:main",
        name: "Weather Station",
        source: "weather-station",
        category: "sensor",
        data: {
          temperature: { value: reading.temperature, label: "Temperature", unit: "C" },
          humidity: { value: reading.humidity, label: "Humidity", unit: "%" },
          pressure: { value: reading.pressure, label: "Pressure", unit: "hPa" },
        },
        orders: [],
      });

      status = "connected";
      logger.debug({ reading }, "Poll completed");
    } catch (err) {
      logger.error({ err }, "Poll failed");
      status = "error";
    }
  }

  return {
    id: "weather-station",

    async start() {
      logger.info("Starting weather-station plugin");
      status = "connecting";

      const interval = Number(settingsManager.get("weather-station", "pollInterval") || "300");

      await poll();
      pollTimer = setInterval(poll, interval * 1000);
    },

    async stop() {
      logger.info("Stopping weather-station plugin");
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      status = "disconnected";
    },

    getStatus() {
      return status;
    },
  };
}

module.exports = { createPlugin };
```

---

## Troubleshooting

**Plugin not detected:**

- Verify `plugins/<id>/manifest.json` exists and is valid JSON
- Check that the `id` field matches the directory name

**Plugin fails to start:**

- Check Sowel logs for `plugin:<id>` entries
- Verify all required settings are configured
- Ensure `dist/index.js` exists and exports `{ createPlugin }`

**Devices not appearing:**

- Verify `source` in `upsertFromDiscovery()` matches your `integrationId`
- Check that `sourceId` is non-empty and unique
- Look for errors in the device manager logs

**Orders not received:**

- Verify your plugin implements `executeOrder()`
- Check that the device's `orders` array includes the order name
- Look for `equipment.order.dispatched` events in trace logs

---

## Reference

- [Sowel Specification](../sowel-spec.md) — Full system specification
- [Recipe Developer Guide](../docs/recipe-developer-guide.md) — Writing automation recipes
- [Integration Plugin Architecture](../specs/011-V0.10a-integration-plugin-architecture/) — Built-in integration design
