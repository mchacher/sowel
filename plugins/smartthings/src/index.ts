/**
 * Sowel Plugin: Samsung SmartThings
 *
 * Integrates Samsung SmartThings devices via the SmartThings REST API.
 * Uses a Personal Access Token (PAT) for authentication and polling for data updates.
 *
 * Supported device types:
 * - Samsung OCF TV → media_player (power, volume, mute, input source, picture mode)
 * - Samsung OCF Washer → appliance (power, state, phase, progress, remaining time, energy)
 * - Other devices → generic sensor data
 */

// ============================================================
// Local type definitions (no imports from Sowel source)
// ============================================================

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
  upsertFromDiscovery(
    integrationId: string,
    source: string,
    discovered: DiscoveredDevice,
  ): void;
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

// ============================================================
// SmartThings API types
// ============================================================

interface STDevice {
  deviceId: string;
  label?: string;
  name: string;
  deviceTypeName: string;
  manufacturerName?: string;
  components: Array<{
    id: string;
    capabilities: Array<{ id: string; version: number }>;
  }>;
}

interface STDeviceStatus {
  components: Record<string, Record<string, Record<string, { value: unknown }>>>;
}

// ============================================================
// Constants
// ============================================================

const INTEGRATION_ID = "smartthings";
const SOURCE = "smartthings";
const API_BASE = "https://api.smartthings.com/v1";
const MIN_POLL_INTERVAL = 60_000;
const DEFAULT_POLL_INTERVAL = 300_000;

const SETTINGS: IntegrationSettingDef[] = [
  {
    key: "token",
    label: "Personal Access Token (PAT)",
    type: "password",
    required: true,
    placeholder: "Generate at account.smartthings.com/tokens",
  },
  {
    key: "polling_interval",
    label: "Polling interval (seconds)",
    type: "number",
    required: false,
    defaultValue: "300",
    placeholder: "Min 60, default 300",
  },
];

// ============================================================
// Plugin factory
// ============================================================

class SmartThingsPlugin implements IntegrationPlugin {
  readonly id = INTEGRATION_ID;
  readonly name = "Samsung SmartThings";
  readonly description = "Samsung SmartThings devices (TV, washing machine, and more)";
  readonly icon = "Smartphone";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private status: IntegrationStatus = "disconnected";
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastPollAt: string | null = null;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL;

  /** SmartThings deviceId → STDevice */
  private knownDevices = new Map<string, STDevice>();

  // previousEnergy is persisted in settings to survive restarts

  constructor(deps: PluginDeps) {
    this.logger = deps.logger;
    this.eventBus = deps.eventBus;
    this.settingsManager = deps.settingsManager;
    this.deviceManager = deps.deviceManager;
  }

  // ── Settings ─────────────────────────────────────────────

  getSettingsSchema(): IntegrationSettingDef[] {
    return SETTINGS;
  }

  getStatus(): IntegrationStatus {
    return this.status;
  }

  isConfigured(): boolean {
    return !!this.getSetting("token");
  }

  getPollingInfo() {
    return this.lastPollAt
      ? { lastPollAt: this.lastPollAt, intervalMs: this.pollIntervalMs }
      : null;
  }

  private getSetting(key: string): string | undefined {
    return this.settingsManager.get(`integration.${INTEGRATION_ID}.${key}`);
  }

  // ── API helpers ──────────────────────────────────────────

  private getToken(): string {
    const token = this.getSetting("token");
    if (!token) throw new Error("SmartThings PAT not configured");
    return token;
  }

  private async apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`SmartThings API ${res.status}: ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private async apiPost(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SmartThings command failed ${res.status}: ${text}`);
    }
  }

  // ── Device detection ─────────────────────────────────────

  private isTV(device: STDevice): boolean {
    return device.deviceTypeName.includes("TV");
  }

  private isWasher(device: STDevice): boolean {
    return device.deviceTypeName.includes("Washer");
  }

  // ── Discovery ────────────────────────────────────────────

  private buildDiscoveredDevice(device: STDevice): DiscoveredDevice {
    const friendlyName = device.label ?? device.name;

    const data: DiscoveredDevice["data"] = [];
    const orders: DiscoveredDevice["orders"] = [];

    if (this.isTV(device)) {
      data.push(
        { key: "power", type: "boolean", category: "generic" },
        { key: "volume", type: "number", category: "generic" },
        { key: "mute", type: "boolean", category: "generic" },
        { key: "input_source", type: "enum", category: "generic" },
        { key: "picture_mode", type: "enum", category: "generic" },
      );
      orders.push(
        { key: "power", type: "boolean", dispatchConfig: { command: "switch" } },
        { key: "volume", type: "number", min: 0, max: 100, dispatchConfig: { command: "setVolume" } },
        { key: "mute", type: "boolean", dispatchConfig: { command: "mute" } },
        { key: "input_source", type: "enum", enumValues: [], dispatchConfig: { command: "setInputSource" } },
      );
    } else if (this.isWasher(device)) {
      data.push(
        { key: "power", type: "boolean", category: "generic" },
        { key: "state", type: "enum", category: "generic" },
        { key: "job_phase", type: "enum", category: "generic" },
        { key: "progress", type: "number", category: "generic", unit: "%" },
        { key: "remaining_time", type: "number", category: "generic", unit: "min" },
        { key: "remaining_time_str", type: "text", category: "generic" },
        { key: "energy", type: "number", category: "energy", unit: "Wh" },
      );
    } else {
      // Generic: expose power
      const hasSwitchCap = device.components.some((c) =>
        c.capabilities.some((cap) => cap.id === "switch"),
      );
      if (hasSwitchCap) {
        data.push({ key: "power", type: "boolean", category: "generic" });
      }
    }

    return {
      friendlyName,
      manufacturer: device.manufacturerName ?? "Samsung",
      model: device.deviceTypeName,
      data,
      orders,
    };
  }

  private async discover(): Promise<void> {
    const result = await this.apiGet<{ items: STDevice[] }>("/devices");
    const devices = result.items;

    this.knownDevices.clear();

    for (const device of devices) {
      this.knownDevices.set(device.deviceId, device);
      const discovered = this.buildDiscoveredDevice(device);
      this.deviceManager.upsertFromDiscovery(INTEGRATION_ID, SOURCE, discovered);
    }

    this.logger.info({ count: devices.length }, "SmartThings devices discovered");
  }

  // ── Status extraction ────────────────────────────────────

  private getAttr(
    main: Record<string, Record<string, { value: unknown }>>,
    capability: string,
    attribute: string,
  ): unknown {
    return main[capability]?.[attribute]?.value ?? null;
  }

  private updateTV(deviceLabel: string, main: Record<string, Record<string, { value: unknown }>>): void {
    const payload: Record<string, unknown> = {};

    const switchVal = this.getAttr(main, "switch", "switch");
    payload["power"] = switchVal === "on";

    const volume = this.getAttr(main, "audioVolume", "volume");
    if (typeof volume === "number") payload["volume"] = volume;

    const mute = this.getAttr(main, "audioMute", "mute");
    payload["mute"] = mute === "muted";

    const inputSource =
      this.getAttr(main, "samsungvd.mediaInputSource", "inputSource") ??
      this.getAttr(main, "mediaInputSource", "inputSource");
    if (inputSource !== null) payload["input_source"] = inputSource;

    const pictureMode = this.getAttr(main, "custom.picturemode", "pictureMode");
    if (pictureMode !== null) payload["picture_mode"] = pictureMode;

    this.deviceManager.updateDeviceData(INTEGRATION_ID, deviceLabel, payload);
  }

  private updateWasher(deviceLabel: string, main: Record<string, Record<string, { value: unknown }>>): void {
    const payload: Record<string, unknown> = {};

    const switchVal = this.getAttr(main, "switch", "switch");
    const isOn = switchVal === "on";
    payload["power"] = isOn;

    if (isOn) {
      // Only report cycle data when machine is powered on
      const operatingState =
        this.getAttr(main, "samsungce.washerOperatingState", "operatingState") ??
        this.getAttr(main, "washerOperatingState", "machineState");
      if (operatingState !== null) payload["state"] = operatingState;

      const jobPhase =
        this.getAttr(main, "samsungce.washerOperatingState", "washerJobPhase") ??
        this.getAttr(main, "washerOperatingState", "washerJobState");
      if (jobPhase !== null) payload["job_phase"] = jobPhase;

      const progress = this.getAttr(main, "samsungce.washerOperatingState", "progress");
      if (typeof progress === "number") payload["progress"] = progress;

      const remainingTime = this.getAttr(main, "samsungce.washerOperatingState", "remainingTime");
      if (typeof remainingTime === "number") payload["remaining_time"] = remainingTime;

      const remainingTimeStr = this.getAttr(main, "samsungce.washerOperatingState", "remainingTimeStr");
      if (remainingTimeStr !== null) payload["remaining_time_str"] = String(remainingTimeStr);
    }
    // When power=off, don't update state/progress/time — keep last known values.
    // This prevents state-watch from seeing off→ready transitions on every poll cycle.

    // Energy — compute delta from cumulative counter, persisted in settings
    const powerConsumption = this.getAttr(main, "powerConsumptionReport", "powerConsumption") as {
      energy?: number;
    } | null;
    if (powerConsumption?.energy !== undefined) {
      const currentEnergy = powerConsumption.energy;
      const settingsKey = `integration.${INTEGRATION_ID}.energy_prev_${deviceLabel.replace(/\s+/g, "_")}`;
      const previousStr = this.settingsManager.get(settingsKey);
      const previousEnergy = previousStr !== undefined ? parseFloat(previousStr) : undefined;

      // Always persist current value for next poll (survives restarts)
      this.settingsManager.set(settingsKey, String(currentEnergy));

      if (previousEnergy !== undefined && !isNaN(previousEnergy) && currentEnergy >= previousEnergy) {
        const delta = currentEnergy - previousEnergy;
        if (delta > 0) {
          payload["energy"] = delta;
        }
      }
      // First poll or after restart: skip (no previous value to compute delta)
    }

    this.deviceManager.updateDeviceData(INTEGRATION_ID, deviceLabel, payload);
  }

  // ── Poll cycle ───────────────────────────────────────────

  private async poll(): Promise<void> {
    try {
      await this.discover();

      for (const [deviceId, device] of this.knownDevices) {
        try {
          const deviceStatus = await this.apiGet<STDeviceStatus>(`/devices/${deviceId}/status`);
          const main = deviceStatus.components?.main;
          if (!main) continue;

          const deviceLabel = device.label ?? device.name;

          if (this.isTV(device)) {
            this.updateTV(deviceLabel, main);
          } else if (this.isWasher(device)) {
            this.updateWasher(deviceLabel, main);
          } else {
            const switchVal = this.getAttr(main, "switch", "switch");
            if (switchVal !== null) {
              this.deviceManager.updateDeviceData(INTEGRATION_ID, deviceLabel, {
                power: switchVal === "on",
              });
            }
          }
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? { message: err.message } : {}, deviceId },
            "Failed to poll device status",
          );
        }
      }

      this.lastPollAt = new Date().toISOString();
      if (this.status !== "connected") {
        this.status = "connected";
        this.eventBus.emit({ type: "system.integration.connected", integrationId: INTEGRATION_ID });
      }

      this.logger.debug({ devices: this.knownDevices.size }, "SmartThings poll complete");
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? { message: err.message } : {} },
        "SmartThings poll failed",
      );
      this.status = "error";
    }
  }

  // ── Lifecycle ────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("SmartThings plugin starting");

    const intervalSetting = this.getSetting("polling_interval");
    if (intervalSetting) {
      const parsed = parseInt(intervalSetting, 10);
      if (!isNaN(parsed) && parsed >= 60) {
        this.pollIntervalMs = parsed * 1000;
      }
    }
    if (this.pollIntervalMs < MIN_POLL_INTERVAL) {
      this.pollIntervalMs = MIN_POLL_INTERVAL;
    }

    await this.poll();

    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error(
          { err: err instanceof Error ? { message: err.message } : {} },
          "SmartThings poll error",
        );
      });
    }, this.pollIntervalMs);

    this.logger.info(
      { intervalMs: this.pollIntervalMs, devices: this.knownDevices.size },
      "SmartThings plugin started",
    );
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.status = "disconnected";
    this.eventBus.emit({ type: "system.integration.disconnected", integrationId: INTEGRATION_ID });
    this.logger.info("SmartThings plugin stopped");
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  // ── Order execution ──────────────────────────────────────

  async executeOrder(
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void> {
    // Find SmartThings device ID by sourceDeviceId (label)
    let targetDeviceId: string | null = null;
    for (const [id, stDevice] of this.knownDevices) {
      if ((stDevice.label ?? stDevice.name) === device.sourceDeviceId) {
        targetDeviceId = id;
        break;
      }
    }

    if (!targetDeviceId) {
      throw new Error(`SmartThings device "${device.sourceDeviceId}" not found`);
    }

    const command = dispatchConfig["command"] as string | undefined;
    if (!command) {
      throw new Error("Missing 'command' in dispatchConfig");
    }

    const commands: Array<{ component: string; capability: string; command: string; arguments?: unknown[] }> = [];

    switch (command) {
      case "switch":
        commands.push({
          component: "main",
          capability: "switch",
          command: value ? "on" : "off",
        });
        break;
      case "setVolume":
        commands.push({
          component: "main",
          capability: "audioVolume",
          command: "setVolume",
          arguments: [Number(value)],
        });
        break;
      case "mute":
        commands.push({
          component: "main",
          capability: "audioMute",
          command: value ? "mute" : "unmute",
        });
        break;
      case "setInputSource":
        commands.push({
          component: "main",
          capability: "samsungvd.mediaInputSource",
          command: "setInputSource",
          arguments: [String(value)],
        });
        break;
      default:
        throw new Error(`Unknown SmartThings command: ${command}`);
    }

    await this.apiPost(`/devices/${targetDeviceId}/commands`, { commands });
    this.logger.info(
      { deviceId: targetDeviceId, command, value },
      "SmartThings order executed",
    );
  }
}

// ============================================================
// Plugin entry point
// ============================================================

export function createPlugin(deps: PluginDeps): IntegrationPlugin {
  return new SmartThingsPlugin(deps);
}
