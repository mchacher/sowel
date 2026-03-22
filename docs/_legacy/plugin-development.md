# Sowel Plugin Development Guide

This guide explains how to create a third-party plugin for Sowel. A plugin is a self-contained integration that can be installed, enabled, disabled, and removed at runtime without restarting the Sowel engine.

The `sowel-plugin-weather-forecast` plugin is used as the reference example throughout this document.

---

## Table of Contents

1. [Overview](#overview)
2. [Plugin Structure](#plugin-structure)
3. [Manifest Schema](#manifest-schema)
4. [PluginDeps API Reference](#plugindeps-api-reference)
5. [IntegrationPlugin Interface](#integrationplugin-interface)
6. [Creating a Plugin Step by Step](#creating-a-plugin-step-by-step)
7. [Device Discovery](#device-discovery)
8. [Device Data Updates](#device-data-updates)
9. [Order Execution](#order-execution)
10. [Settings](#settings)
11. [Publishing and Versioning](#publishing-and-versioning)
12. [Troubleshooting](#troubleshooting)

---

## Overview

A Sowel plugin is an ESM (ECMAScript Module) Node.js package that exports a `createPlugin` factory function. When loaded, Sowel injects a `PluginDeps` object providing access to core services (logging, event bus, device management, settings). The plugin uses these dependencies to discover devices, push data updates, and handle orders -- exactly like built-in integrations.

Plugins live in the `plugins/` directory at the Sowel root. Each plugin has its own subdirectory containing a `manifest.json` and compiled JavaScript in `dist/`.

**Lifecycle:**

1. Sowel reads the `plugins` database table on startup
2. For each enabled plugin, Sowel dynamically imports `plugins/<id>/dist/index.js` (ESM)
3. The exported `createPlugin` factory receives `PluginDeps` and returns an `IntegrationPlugin` instance
4. Sowel registers the plugin with the `IntegrationRegistry`
5. If the plugin is configured (`isConfigured()` returns true), Sowel calls `plugin.start()`
6. On disable/uninstall, Sowel calls `plugin.stop()` and unregisters from the registry

---

## Plugin Structure

```
sowel-plugin-my-device/
  manifest.json          # Plugin metadata (required)
  package.json           # Node.js package descriptor ("type": "module")
  tsconfig.json          # TypeScript config (module: "NodeNext")
  dist/
    index.js             # Compiled entry point (ESM)
    index.js.map         # Source map (optional)
  src/
    index.ts             # TypeScript source (not loaded by Sowel)
```

**Key rules:**

- The entry point is always `dist/index.js` -- this is hardcoded in the plugin loader
- Use **ESM format** (`export { createPlugin }`) -- Sowel uses dynamic `import()` to load plugins
- Set `"type": "module"` in `package.json`
- Set `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.json`
- The `src/` directory is for development only; Sowel never reads it
- Plugin-specific `node_modules/` are isolated from Sowel's dependencies

---

## Manifest Schema

The `manifest.json` file describes the plugin to Sowel. It lives at the root of the plugin directory.

**Example** (from `sowel-plugin-weather-forecast`):

```json
{
  "id": "weather-forecast",
  "name": "Weather Forecast",
  "version": "0.2.0",
  "description": "Weather forecast via Open-Meteo API (free, no API key)",
  "icon": "CloudSun",
  "author": "mchacher",
  "sowelVersion": ">=0.10.0",
  "settings": [
    {
      "key": "polling_interval",
      "label": "Polling interval (minutes)",
      "type": "number",
      "required": false,
      "defaultValue": "30",
      "placeholder": "Min 15, default 30"
    }
  ]
}
```

### Field Reference

| Field          | Type                    | Required | Description                                                                                                                 |
| -------------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`           | string                  | Yes      | Unique plugin identifier. Lowercase with hyphens (e.g. `weather-forecast`). Must match the directory name under `plugins/`. |
| `name`         | string                  | Yes      | Human-readable display name shown in the UI.                                                                                |
| `version`      | string                  | Yes      | SemVer version (e.g. `0.2.0`). **Must be updated with each release.** See [Versioning](#versioning).                        |
| `description`  | string                  | Yes      | Short description (one sentence) shown in the plugin store and integrations page.                                           |
| `icon`         | string                  | Yes      | Lucide icon name (e.g. `CloudSun`, `Camera`). Used in the UI for the integration card.                                      |
| `author`       | string                  | No       | Author name or organization.                                                                                                |
| `sowelVersion` | string                  | No       | SemVer range of compatible Sowel versions (e.g. `>=0.10.0`).                                                                |
| `settings`     | IntegrationSettingDef[] | No       | Array of setting definitions for the UI configuration form. See [Settings](#settings).                                      |

**Fields that do NOT exist in the manifest:** `entry`, `integrationId`, `license`, `repository`. Do not include these.

---

## PluginDeps API Reference

When Sowel loads a plugin, it passes a `PluginDeps` object to the `createPlugin` factory function. This is the plugin's gateway to all Sowel core services.

```typescript
interface PluginDeps {
  logger: Logger;
  eventBus: EventBus;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginDir: string;
}
```

### `logger`

A pino child logger pre-configured with `{ module: "plugin:<pluginId>" }`. Use this for all logging -- never use `console.log`.

```typescript
deps.logger.info({ deviceCount: 5 }, "Devices discovered");
deps.logger.debug({ response }, "API response received");
deps.logger.error({ err }, "Poll failed");
```

**Level guidelines:**

| Level   | Usage                                                              |
| ------- | ------------------------------------------------------------------ |
| `info`  | Significant events: connected, devices discovered, poll completed  |
| `debug` | Operational details: API responses, intermediate steps             |
| `trace` | High-volume data: every message, every data point                  |
| `error` | Operation failed -- always include `{ err }` with the Error object |
| `warn`  | Unexpected but handled: retry, fallback, recoverable               |

### `eventBus`

The typed event emitter. Plugins typically emit integration lifecycle events:

```typescript
deps.eventBus.emit({ type: "system.integration.connected", integrationId: "my-plugin" });
deps.eventBus.emit({ type: "system.integration.disconnected", integrationId: "my-plugin" });
```

### `settingsManager`

Read and write settings stored in the SQLite `settings` table. Settings use a **full key** with the `integration.<pluginId>.` prefix.

```typescript
// Read a setting — returns string | undefined
const interval = deps.settingsManager.get("integration.weather-forecast.polling_interval");

// Read a global Sowel setting (no prefix)
const lat = deps.settingsManager.get("home.latitude");

// Write a setting
deps.settingsManager.set("integration.weather-forecast.last_poll", Date.now().toString());
```

**Important:** `get()` takes the **full key** (e.g. `integration.weather-forecast.polling_interval`) and returns `string | undefined` (not null). Settings declared in your manifest's `settings` array are automatically namespaced by Sowel under `integration.<pluginId>.<key>`.

**Methods:**

| Method        | Signature                                    | Description                             |
| ------------- | -------------------------------------------- | --------------------------------------- |
| `get`         | `(key: string) => string \| undefined`       | Get a single setting by its full key    |
| `set`         | `(key: string, value: string) => void`       | Set a single setting                    |
| `getByPrefix` | `(prefix: string) => Record<string, string>` | Get all settings starting with a prefix |
| `setMany`     | `(entries: Record<string, string>) => void`  | Set multiple settings at once           |

### `deviceManager`

Manage devices discovered by your plugin. Two main methods are used:

| Method                | Signature                                                                                   | Description                                   |
| --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `upsertFromDiscovery` | `(integrationId: string, source: string, discovered: DiscoveredDevice) => void`             | Create or update a device from discovery data |
| `updateDeviceData`    | `(integrationId: string, sourceDeviceId: string, payload: Record<string, unknown>) => void` | Push new data values for an existing device   |

See [Device Discovery](#device-discovery) and [Device Data Updates](#device-data-updates) for detailed usage.

### `pluginDir`

Absolute path to the plugin's installed directory (e.g. `/app/plugins/weather-forecast`). Use this for reading local files or storing plugin-specific data.

```typescript
import { resolve } from "node:path";
const cachePath = resolve(deps.pluginDir, "cache.json");
```

**Note:** There is no `mqttConnector` in `PluginDeps`. If your plugin needs MQTT, use the `mqtt` npm package directly as a plugin dependency.

---

## IntegrationPlugin Interface

The `createPlugin` factory must return an object implementing the `IntegrationPlugin` interface:

```typescript
interface IntegrationPlugin {
  readonly id: string; // Unique integration ID (must match manifest.id)
  readonly name: string; // Human-readable name
  readonly description: string; // Short description for the UI
  readonly icon: string; // Lucide icon name

  getStatus(): IntegrationStatus;
  isConfigured(): boolean;
  getSettingsSchema(): IntegrationSettingDef[];
  start(options?: { pollOffset?: number }): Promise<void>;
  stop(): Promise<void>;
  executeOrder(
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;
  refresh?(): Promise<void>;
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;
}

type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "error";
```

### Method Reference

| Method                | Required | Description                                                                                      |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `getStatus()`         | Yes      | Return the current connection status. Return `"not_configured"` if `isConfigured()` is false.    |
| `isConfigured()`      | Yes      | Return true if all required settings are present. Sowel only calls `start()` when this is true.  |
| `getSettingsSchema()` | Yes      | Return the settings form definition (same as manifest `settings`).                               |
| `start(options?)`     | Yes      | Start the integration. `pollOffset` is provided by Sowel to stagger multiple polling plugins.    |
| `stop()`              | Yes      | Stop gracefully: cancel timers, close connections.                                               |
| `executeOrder()`      | Yes      | Execute a command on a device. Throw an error if the plugin does not support orders.             |
| `refresh()`           | No       | Force an immediate data refresh (e.g. re-poll the cloud API). Called from the UI refresh button. |
| `getPollingInfo()`    | No       | Return last poll timestamp and interval. Shown in the integrations UI for polling-based plugins. |

---

## Creating a Plugin Step by Step

### 1. Initialize the project

```bash
mkdir sowel-plugin-my-device
cd sowel-plugin-my-device
npm init -y
npm install -D typescript
```

Edit `package.json` -- set `"type": "module"`:

```json
{
  "name": "sowel-plugin-my-device",
  "version": "0.1.0",
  "description": "Sowel plugin: My Device integration",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

### 2. Configure TypeScript

Create `tsconfig.json` -- use `NodeNext` module format:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### 3. Define local type interfaces

Plugins do **not** import from Sowel source code. Instead, define local interfaces matching the `PluginDeps` shape. This keeps the plugin fully decoupled.

```typescript
// src/index.ts — local type definitions

interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  info(obj: Record<string, unknown>, msg: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
}

interface EventBus {
  emit(event: unknown): void;
}

interface SettingsManager {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

interface DiscoveredDevice {
  ieeeAddress?: string;
  friendlyName: string;
  manufacturer?: string;
  model?: string;
  data: {
    key: string;
    type: string;
    category: string;
    unit?: string;
  }[];
  orders: {
    key: string;
    type: string;
    dispatchConfig: Record<string, unknown>;
    min?: number;
    max?: number;
    enumValues?: string[];
    unit?: string;
  }[];
}

interface DeviceManager {
  upsertFromDiscovery(integrationId: string, source: string, discovered: DiscoveredDevice): void;
  updateDeviceData(
    integrationId: string,
    sourceDeviceId: string,
    payload: Record<string, unknown>,
  ): void;
}

interface Device {
  id: string;
  integrationId: string;
  sourceDeviceId: string;
  name: string;
  manufacturer?: string;
  model?: string;
}

interface PluginDeps {
  logger: Logger;
  eventBus: EventBus;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginDir: string;
}

type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "error";

interface IntegrationSettingDef {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean";
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

interface IntegrationPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  getStatus(): IntegrationStatus;
  isConfigured(): boolean;
  getSettingsSchema(): IntegrationSettingDef[];
  start(options?: { pollOffset?: number }): Promise<void>;
  stop(): Promise<void>;
  executeOrder(
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;
  refresh?(): Promise<void>;
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;
}
```

### 4. Implement the plugin

Below the type definitions, implement your plugin class and export the factory:

```typescript
const PLUGIN_ID = "my-device";
const SETTINGS_PREFIX = `integration.${PLUGIN_ID}.`;
const SOURCE_DEVICE_ID = "My Device"; // Must match friendlyName in DiscoveredDevice

class MyDevicePlugin implements IntegrationPlugin {
  readonly id = PLUGIN_ID;
  readonly name = "My Device";
  readonly description = "Integration with My Device API";
  readonly icon = "Cpu";

  private logger: Logger;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private eventBus: EventBus;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPollAt: string | null = null;
  private pollIntervalMs = 300_000;
  private status: IntegrationStatus = "disconnected";

  constructor(deps: PluginDeps) {
    this.logger = deps.logger.child({ module: PLUGIN_ID });
    this.settingsManager = deps.settingsManager;
    this.deviceManager = deps.deviceManager;
    this.eventBus = deps.eventBus;
  }

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    return this.status;
  }

  isConfigured(): boolean {
    return !!this.settingsManager.get(`${SETTINGS_PREFIX}api_url`);
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      {
        key: "api_url",
        label: "API URL",
        type: "text",
        required: true,
        placeholder: "http://192.168.1.50/api",
      },
      {
        key: "polling_interval",
        label: "Polling interval (seconds)",
        type: "number",
        required: false,
        defaultValue: "300",
      },
    ];
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    return { lastPollAt: this.lastPollAt ?? "", intervalMs: this.pollIntervalMs };
  }

  async start(options?: { pollOffset?: number }): Promise<void> {
    if (!this.isConfigured()) {
      this.status = "not_configured";
      return;
    }

    // Read polling interval from settings
    const rawInterval = parseInt(
      this.settingsManager.get(`${SETTINGS_PREFIX}polling_interval`) ?? "300",
      10,
    );
    this.pollIntervalMs = Math.max(60_000, (isNaN(rawInterval) ? 300 : rawInterval) * 1000);

    await this.poll();
    this.schedulePoll(options?.pollOffset ?? 0);

    this.status = "connected";
    this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
    this.logger.info({ pollIntervalMs: this.pollIntervalMs }, "Plugin started");
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.status = "disconnected";
    this.eventBus.emit({ type: "system.integration.disconnected", integrationId: this.id });
    this.logger.info("Plugin stopped");
  }

  async executeOrder(
    _device: Device,
    _dispatchConfig: Record<string, unknown>,
    _value: unknown,
  ): Promise<void> {
    throw new Error("My Device plugin does not support orders");
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  // --- Polling ---

  private async poll(): Promise<void> {
    try {
      // 1. Fetch data from your API
      // const data = await this.fetchData();

      // 2. Upsert device definition
      this.deviceManager.upsertFromDiscovery(PLUGIN_ID, PLUGIN_ID, {
        friendlyName: SOURCE_DEVICE_ID,
        manufacturer: "My Company",
        model: "Sensor v2",
        data: [
          { key: "temperature", type: "number", category: "temperature", unit: "°C" },
          { key: "humidity", type: "number", category: "humidity", unit: "%" },
        ],
        orders: [],
      });

      // 3. Update device data values
      this.deviceManager.updateDeviceData(PLUGIN_ID, SOURCE_DEVICE_ID, {
        temperature: 21.5,
        humidity: 45,
      });

      this.lastPollAt = new Date().toISOString();
      this.logger.info("Poll complete");
    } catch (err) {
      this.logger.error({ err }, "Poll failed");
      throw err;
    }
  }

  private schedulePoll(offsetMs: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    const delay = offsetMs > 0 ? offsetMs : this.pollIntervalMs;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
      } catch {
        /* already logged */
      }
      this.schedulePoll(0);
    }, delay);
  }
}

// ============================================================
// Plugin factory — this is the entry point Sowel calls
// ============================================================

export function createPlugin(deps: PluginDeps): IntegrationPlugin {
  return new MyDevicePlugin(deps);
}
```

### 5. Build

```bash
npx tsc
```

This produces `dist/index.js` (ESM) ready for Sowel to load.

### 6. Create the manifest

Create `manifest.json` at the plugin root:

```json
{
  "id": "my-device",
  "name": "My Device",
  "version": "0.1.0",
  "description": "Integration with My Device API",
  "icon": "Cpu",
  "author": "Your Name",
  "sowelVersion": ">=0.10.0",
  "settings": [
    {
      "key": "api_url",
      "label": "API URL",
      "type": "text",
      "required": true,
      "placeholder": "http://192.168.1.50/api"
    },
    {
      "key": "polling_interval",
      "label": "Polling interval (seconds)",
      "type": "number",
      "required": false,
      "defaultValue": "300"
    }
  ]
}
```

### 7. Test locally

Symlink the plugin directory into Sowel's `plugins/` directory:

```bash
# From the Sowel root
ln -s /path/to/sowel-plugin-my-device plugins/my-device
```

Then manually register it in the database (Sowel auto-loads from the `plugins` table):

```bash
# Using the Sowel API to install from a local path, or manually:
sqlite3 data/sowel.db "INSERT INTO plugins (id, version, enabled, installed_at, manifest) VALUES ('my-device', '0.1.0', 1, datetime('now'), readfile('plugins/my-device/manifest.json'));"
```

Start Sowel -- it will detect and load the plugin automatically. Check the logs for your plugin's output:

```
[info] plugin:my-device — Plugin started
```

---

## Device Discovery

When your plugin detects devices (from an API, MQTT, or local scan), register them with `deviceManager.upsertFromDiscovery()`.

### Signature

```typescript
deviceManager.upsertFromDiscovery(
  integrationId: string,     // Your plugin ID (e.g. "weather-forecast")
  source: string,            // Device source identifier (typically your plugin ID)
  discovered: DiscoveredDevice,
): void;
```

### DiscoveredDevice format

```typescript
interface DiscoveredDevice {
  ieeeAddress?: string; // Optional hardware address (for Zigbee devices)
  friendlyName: string; // Unique device name — used as sourceDeviceId for data updates
  manufacturer?: string; // Device manufacturer
  model?: string; // Device model
  data: {
    // Data points this device exposes
    key: string; // Data point key (e.g. "temperature", "j1_condition")
    type: string; // "number" | "boolean" | "text" | "enum"
    category: string; // "temperature" | "humidity" | "motion" | "battery" | etc.
    unit?: string; // Unit of measurement (e.g. "°C", "%", "km/h")
  }[];
  orders: {
    // Commands this device accepts
    key: string; // Order key (e.g. "set_monitoring")
    type: string; // Value type: "boolean" | "number" | "enum" | "text"
    dispatchConfig: Record<string, unknown>; // Integration-specific config for order dispatch
    min?: number; // For numeric orders: minimum value
    max?: number; // For numeric orders: maximum value
    enumValues?: string[]; // For enum orders: allowed values
    unit?: string; // Unit (e.g. "°C")
  }[];
}
```

### Example (from weather-forecast)

```typescript
const WEATHER_DISCOVERED_DEVICE: DiscoveredDevice = {
  friendlyName: "Weather Forecast",
  manufacturer: "Open-Meteo",
  model: "Forecast API",
  data: [
    { key: "j1_condition", type: "enum", category: "weather_condition" },
    { key: "j1_temp_min", type: "number", category: "temperature", unit: "°C" },
    { key: "j1_temp_max", type: "number", category: "temperature", unit: "°C" },
    { key: "j1_rain_prob", type: "number", category: "rain", unit: "%" },
    { key: "j1_wind_gusts", type: "number", category: "wind", unit: "km/h" },
    // ... j2 through j5
  ],
  orders: [],
};

// Call during poll
this.deviceManager.upsertFromDiscovery(PLUGIN_ID, SOURCE_DEVICE_ID, WEATHER_DISCOVERED_DEVICE);
```

**Important:**

- `friendlyName` becomes the `source_device_id` in the database. It must match the `sourceDeviceId` argument used in `updateDeviceData()`.
- Call `upsertFromDiscovery()` on every poll cycle -- it is idempotent (creates on first call, updates metadata on subsequent calls).
- Include all data points and orders in the `DiscoveredDevice` definition. Stale data/order entries not in the current discovery are cleaned up automatically.

---

## Device Data Updates

After device discovery, push data updates when new values arrive. Use `deviceManager.updateDeviceData()`.

### Signature

```typescript
deviceManager.updateDeviceData(
  integrationId: string,                // Your plugin ID (e.g. "weather-forecast")
  sourceDeviceId: string,               // Must match friendlyName from upsertFromDiscovery
  payload: Record<string, unknown>,     // Flat key-value map of data points
): void;
```

### Example (from weather-forecast)

```typescript
const payload: Record<string, unknown> = {
  j1_condition: "rainy",
  j1_temp_min: 8.2,
  j1_temp_max: 14.5,
  j1_rain_prob: 75,
  j1_wind_gusts: 42,
  // ... j2 through j5
};

this.deviceManager.updateDeviceData(PLUGIN_ID, SOURCE_DEVICE_ID, payload);
```

**Critical:** the `sourceDeviceId` parameter must exactly match the `friendlyName` used in `upsertFromDiscovery()`. This is how Sowel looks up the device in the database. In the weather-forecast plugin, both are set to `"Weather Forecast"`.

The payload is a **flat `Record<string, unknown>`** -- keys are data point names, values are the raw values (number, boolean, string). This is not a nested object with labels or units; those are defined once in `upsertFromDiscovery()`.

This triggers the reactive pipeline:

1. Device data is updated in SQLite
2. `device.data.updated` event is emitted
3. Equipment bindings are re-evaluated
4. Zone aggregations are updated
5. Scenario triggers are checked
6. UI receives a WebSocket push

---

## Order Execution

When a user or scenario sends a command to a device managed by your plugin, Sowel calls `executeOrder()` on your plugin instance.

### Signature

```typescript
executeOrder(
  device: Device,                             // The target device object
  dispatchConfig: Record<string, unknown>,    // Integration-specific config from the order definition
  value: unknown,                             // The value to set
): Promise<void>;
```

### Example

```typescript
async executeOrder(
  device: Device,
  dispatchConfig: Record<string, unknown>,
  value: unknown,
): Promise<void> {
  const action = dispatchConfig.action as string;

  switch (action) {
    case "set_monitoring":
      await this.api.setMonitoring(device.sourceDeviceId, value as boolean);
      break;
    default:
      this.logger.warn({ action }, "Unknown order action");
  }
}
```

**Order flow:**

1. User taps a button in the UI or a scenario action fires
2. Equipment dispatches order to the bound device
3. Sowel routes the order to the integration that owns the device
4. Plugin's `executeOrder()` is called with the full Device object, the `dispatchConfig` from the order definition, and the value
5. Plugin sends the command to the physical device
6. On next poll (or immediate refresh), the new state is reflected

If your plugin does not support orders (e.g. a read-only weather plugin), throw an error:

```typescript
async executeOrder(): Promise<void> {
  throw new Error("Weather Forecast plugin does not support orders");
}
```

---

## Settings

Plugins declare their settings in `manifest.json` and return the same schema from `getSettingsSchema()`. Sowel renders a configuration form in the UI automatically.

### Setting Definition Schema

```typescript
interface IntegrationSettingDef {
  key: string; // Setting key (without prefix). Stored as "integration.<pluginId>.<key>"
  label: string; // Display label in the UI
  type: string; // One of: "text", "password", "number", "boolean"
  required: boolean; // If true, must be filled before the plugin can start
  placeholder?: string; // Placeholder text in the input field
  defaultValue?: string; // Default value (always a string, even for numbers)
}
```

### Example (from netatmo-security)

```json
{
  "settings": [
    {
      "key": "client_id",
      "label": "Client ID",
      "type": "text",
      "required": true,
      "placeholder": "From dev.netatmo.com"
    },
    {
      "key": "client_secret",
      "label": "Client Secret",
      "type": "password",
      "required": true
    },
    {
      "key": "refresh_token",
      "label": "Refresh Token",
      "type": "password",
      "required": true,
      "placeholder": "With camera scopes"
    },
    {
      "key": "polling_interval",
      "label": "Polling interval (seconds)",
      "type": "number",
      "required": false,
      "defaultValue": "300",
      "placeholder": "Min 180, default 300"
    }
  ]
}
```

### Reading Settings at Runtime

Settings are stored with the full key `integration.<pluginId>.<key>`:

```typescript
const SETTINGS_PREFIX = `integration.${PLUGIN_ID}.`;

// Read a plugin-specific setting
const interval = this.settingsManager.get(`${SETTINGS_PREFIX}polling_interval`);
// Returns "300" (string) or undefined if not set

// Read a global Sowel setting (no prefix)
const lat = this.settingsManager.get("home.latitude");

// Write a setting
this.settingsManager.set(`${SETTINGS_PREFIX}last_token_refresh`, Date.now().toString());
```

**Important notes:**

- `get()` always returns `string | undefined` -- parse numbers with `parseInt()` / `parseFloat()`
- The `defaultValue` in the settings schema is for UI display only; always handle undefined in code
- Use `"password"` type for secrets -- the UI masks these values
- There are no `"select"`, `"string"`, or `"secret"` types. The valid types are: `"text"`, `"password"`, `"number"`, `"boolean"`

---

## Publishing and Versioning

### Creating a Release Tarball

Plugins are installed from GitHub release tarballs. The tarball **must include** `dist/` (compiled JS) and **must exclude** `src/` and `node_modules/`.

```bash
# Build first
npm run build

# Create the release tarball
tar -czf sowel-plugin-my-device-0.1.0.tar.gz \
  manifest.json \
  package.json \
  dist/
```

If your plugin has production dependencies (listed in `dependencies`, not `devDependencies`), also include `package.json` so that Sowel can run `npm install --production` after extraction. If there are no runtime dependencies, `package.json` is still recommended but `node_modules/` should not be included.

### Creating a GitHub Release

```bash
gh release create v0.1.0 \
  sowel-plugin-my-device-0.1.0.tar.gz \
  --title "v0.1.0" \
  --notes "Initial release"
```

**Installation flow:** When a user clicks "Install" in the Sowel plugin store, Sowel:

1. Fetches the latest release from the GitHub API
2. Prefers an uploaded `.tar.gz` asset (which includes `dist/`); falls back to the GitHub source tarball
3. Extracts to `plugins/<id>/`
4. Runs `npm install --production` if `package.json` exists
5. If `dist/` is missing but `tsconfig.json` exists, attempts `npx tsc` to build from source
6. Registers the plugin in the database and loads it

Best practice: **always upload a pre-built tarball** as a release asset. This avoids the need for the user's Sowel instance to have TypeScript installed.

### Registering in the Plugin Store

To make your plugin appear in the Sowel plugin store, submit a PR to the Sowel repository adding an entry to `plugins/registry.json`:

```json
{
  "id": "my-device",
  "name": "My Device",
  "description": "Integration with My Device API",
  "icon": "Cpu",
  "author": "Your Name",
  "repo": "yourname/sowel-plugin-my-device",
  "version": "0.1.0",
  "tags": ["sensor", "api"]
}
```

#### Registry Entry Schema

| Field         | Type     | Required | Description                                                   |
| ------------- | -------- | -------- | ------------------------------------------------------------- |
| `id`          | string   | Yes      | Must match the plugin's `manifest.json` id                    |
| `name`        | string   | Yes      | Display name in the store                                     |
| `description` | string   | Yes      | Short description                                             |
| `icon`        | string   | Yes      | Lucide icon name                                              |
| `author`      | string   | Yes      | Author name                                                   |
| `repo`        | string   | Yes      | GitHub `owner/repo` path (used to fetch releases)             |
| `version`     | string   | No       | Latest available version (shown in the store "Available" tab) |
| `tags`        | string[] | Yes      | Searchable tags (e.g. `["camera", "security"]`)               |

### Versioning

There are **two places** where the version matters, and they serve different purposes:

1. **`manifest.json` (in the plugin repository)** -- the `version` field here is read when the plugin is installed. It is stored in Sowel's database and displayed in the **"Installed" tab** of the Plugins UI.

2. **`plugins/registry.json` (in the Sowel repository)** -- the `version` field here is displayed in the **"Store" tab** of the Plugins UI, showing users what version is available for installation.

**Rules:**

- Update `manifest.json` version with **every release**. This is how Sowel knows what version is installed.
- Update `plugins/registry.json` version in the Sowel repo when you publish a new release. This is how users see that an update is available.
- Keep both versions in sync. If `manifest.json` says `0.2.0` but `registry.json` says `0.1.0`, the store will show an outdated version.
- The version in the release tag (e.g. `v0.2.0`) should match `manifest.json`.

### Release Naming Convention

- Git tag: `v0.2.0` (SemVer with `v` prefix)
- Tarball asset: `sowel-plugin-<id>-<version>.tar.gz`
- The `version` in the tarball's `manifest.json` must match the release tag

---

## Troubleshooting

**Plugin not detected:**

- Verify `plugins/<id>/manifest.json` exists and is valid JSON
- Check that the `id` field matches the directory name
- Check the `plugins` table in SQLite -- the plugin must have a row with `enabled = 1`

**Plugin fails to load:**

- Ensure `dist/index.js` exists and exports a `createPlugin` function
- Check Sowel logs for `plugin:<id>` entries
- Verify the plugin uses ESM (`export function createPlugin` or `export { createPlugin }`)
- The loader also checks `mod.default?.createPlugin` as a fallback

**Plugin loads but does not start:**

- Verify `isConfigured()` returns true -- Sowel skips `start()` when it returns false
- Check that all required settings are configured in the UI (Administration > Integrations)

**Devices not appearing:**

- Verify `integrationId` in `upsertFromDiscovery()` matches your plugin's `id`
- Check that `friendlyName` is non-empty and unique
- Look for errors in the device manager logs

**Data updates not working:**

- Verify `sourceDeviceId` in `updateDeviceData()` exactly matches the `friendlyName` used in `upsertFromDiscovery()`
- Check that the data keys in the payload match the keys declared in the `DiscoveredDevice.data` array

**Orders not received:**

- Verify your plugin implements `executeOrder()` with the correct signature: `(device: Device, dispatchConfig: Record<string, unknown>, value: unknown)`
- Check that the device's `orders` array includes the order definition with a `dispatchConfig`
- Look for order dispatch events in the logs

---

## Reference

- [Sowel Specification](../sowel-spec.md) -- Full system specification
- [Weather Forecast Plugin](https://github.com/mchacher/sowel-plugin-weather-forecast) -- Complete working example
- [Netatmo Security Plugin](https://github.com/mchacher/sowel-plugin-netatmo-security) -- Plugin with OAuth and orders
