import type { Logger } from "../../core/logger.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { PanasonicBridge } from "./panasonic-bridge.js";
import type { BridgeDevice } from "./panasonic-types.js";
import type { DiscoveredDevice } from "../../devices/device-manager.js";
import type { DataType, DataCategory } from "../../shared/types.js";
import {
  FAN_SPEED_VALUES,
  AIR_SWING_UD_VALUES,
  AIR_SWING_LR_VALUES,
  ECO_MODE_VALUES,
  NANOE_VALUES,
  getAvailableModes,
} from "./panasonic-types.js";

const DEFAULT_POLL_INTERVAL_MS = 300_000; // 5 minutes
const DEFAULT_ON_DEMAND_DELAY_MS = 10_000; // 10 seconds

export class PanasonicPoller {
  private bridge: PanasonicBridge;
  private deviceManager: DeviceManager;
  private logger: Logger;
  private email: string;
  private password: string;
  private pollIntervalMs: number;
  private onDemandDelayMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  private polling = false;
  private lastPollAt: string | null = null;
  private staggerTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    bridge: PanasonicBridge,
    deviceManager: DeviceManager,
    logger: Logger,
    email: string,
    password: string,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onDemandDelayMs = DEFAULT_ON_DEMAND_DELAY_MS,
  ) {
    this.bridge = bridge;
    this.deviceManager = deviceManager;
    this.logger = logger.child({ module: "panasonic-poller" });
    this.email = email;
    this.password = password;
    this.pollIntervalMs = pollIntervalMs;
    this.onDemandDelayMs = onDemandDelayMs;
  }

  async start(pollOffset = 0): Promise<void> {
    this.logger.info({ intervalMs: this.pollIntervalMs, pollOffset }, "Starting Panasonic poller");
    // Immediate first poll — awaited so data is available at startup
    await this.poll();
    // Stagger recurring polls by pollOffset
    const startInterval = () => {
      this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
    };
    if (pollOffset > 0) {
      this.staggerTimeout = setTimeout(startInterval, pollOffset);
    } else {
      startInterval();
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.staggerTimeout) {
      clearTimeout(this.staggerTimeout);
      this.staggerTimeout = null;
    }
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.logger.info("Panasonic poller stopped");
  }

  /** Force an immediate poll (for manual refresh). */
  async refresh(): Promise<void> {
    await this.poll();
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    if (!this.lastPollAt) return null;
    return { lastPollAt: this.lastPollAt, intervalMs: this.pollIntervalMs };
  }

  scheduleOnDemandPoll(delayMs?: number): void {
    const delay = delayMs ?? this.onDemandDelayMs;
    this.logger.debug({ delayMs: delay }, "Scheduling on-demand poll");
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.poll();
    }, delay);
    this.pendingTimers.add(timer);
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      this.logger.debug("Poll already in progress, skipping");
      return;
    }
    this.polling = true;

    try {
      this.lastPollAt = new Date().toISOString();
      this.logger.debug("Polling Panasonic devices...");
      const response = await this.bridge.getDevices(this.email, this.password);

      for (const device of response.devices) {
        const discovered = mapBridgeDeviceToDiscovered(device);
        this.deviceManager.upsertFromDiscovery("panasonic_cc", "panasonic_cc", discovered);

        // Update data values
        this.updateDeviceData(device);
      }

      this.logger.debug({ deviceCount: response.devices.length }, "Panasonic poll complete");
    } catch (err) {
      this.logger.error({ err }, "Panasonic poll failed");
    } finally {
      this.polling = false;
    }
  }

  private updateDeviceData(bridgeDevice: BridgeDevice): void {
    const sourceDeviceId = bridgeDevice.name || bridgeDevice.id;
    const p = bridgeDevice.parameters;

    const payload: Record<string, unknown> = {};
    if (p.power !== null) payload.power = p.power === "on";
    if (p.mode !== null) payload.operationMode = p.mode;
    if (p.targetTemperature !== null) payload.targetTemperature = p.targetTemperature;
    if (p.insideTemperature !== null) payload.insideTemperature = p.insideTemperature;
    if (p.outsideTemperature !== null) payload.outsideTemperature = p.outsideTemperature;
    if (p.fanSpeed !== null) payload.fanSpeed = p.fanSpeed;
    if (p.airSwingUD !== null) payload.airSwingUD = p.airSwingUD;
    if (p.airSwingLR !== null) payload.airSwingLR = p.airSwingLR;
    if (p.ecoMode !== null) payload.ecoMode = p.ecoMode;
    if (p.nanoe !== null) payload.nanoe = p.nanoe;

    // updateDeviceData also sets status to "online"
    this.deviceManager.updateDeviceData("panasonic_cc", sourceDeviceId, payload);
  }
}

/**
 * Map a bridge device to a Corbel DiscoveredDevice for upsert.
 */
function mapBridgeDeviceToDiscovered(bridgeDevice: BridgeDevice): DiscoveredDevice {
  const features = bridgeDevice.features;

  const data: DiscoveredDevice["data"] = [
    { key: "power", type: "boolean" as DataType, category: "generic" as DataCategory },
    { key: "operationMode", type: "enum" as DataType, category: "generic" as DataCategory },
    {
      key: "targetTemperature",
      type: "number" as DataType,
      category: "temperature" as DataCategory,
      unit: "°C",
    },
    {
      key: "insideTemperature",
      type: "number" as DataType,
      category: "temperature" as DataCategory,
      unit: "°C",
    },
    {
      key: "outsideTemperature",
      type: "number" as DataType,
      category: "temperature" as DataCategory,
      unit: "°C",
    },
    { key: "fanSpeed", type: "enum" as DataType, category: "generic" as DataCategory },
    { key: "airSwingUD", type: "enum" as DataType, category: "generic" as DataCategory },
    { key: "airSwingLR", type: "enum" as DataType, category: "generic" as DataCategory },
    { key: "ecoMode", type: "enum" as DataType, category: "generic" as DataCategory },
  ];

  if (features.nanoe) {
    data.push({ key: "nanoe", type: "enum" as DataType, category: "generic" as DataCategory });
  }

  const orders: DiscoveredDevice["orders"] = [
    {
      key: "power",
      type: "boolean" as DataType,
      dispatchConfig: { param: "power", guid: bridgeDevice.id },
    },
    {
      key: "operationMode",
      type: "enum" as DataType,
      dispatchConfig: { param: "mode", guid: bridgeDevice.id },
      enumValues: getAvailableModes(features),
    },
    {
      key: "targetTemperature",
      type: "number" as DataType,
      dispatchConfig: { param: "targetTemperature", guid: bridgeDevice.id },
      min: 16,
      max: 30,
      unit: "°C",
    },
    {
      key: "fanSpeed",
      type: "enum" as DataType,
      dispatchConfig: { param: "fanSpeed", guid: bridgeDevice.id },
      enumValues: [...FAN_SPEED_VALUES],
    },
    {
      key: "airSwingUD",
      type: "enum" as DataType,
      dispatchConfig: { param: "airSwingUD", guid: bridgeDevice.id },
      enumValues: [...AIR_SWING_UD_VALUES],
    },
  ];

  if (features.airSwingLR) {
    orders.push({
      key: "airSwingLR",
      type: "enum" as DataType,
      dispatchConfig: { param: "airSwingLR", guid: bridgeDevice.id },
      enumValues: [...AIR_SWING_LR_VALUES],
    });
  }

  orders.push({
    key: "ecoMode",
    type: "enum" as DataType,
    dispatchConfig: { param: "ecoMode", guid: bridgeDevice.id },
    enumValues: [...ECO_MODE_VALUES],
  });

  if (features.nanoe) {
    orders.push({
      key: "nanoe",
      type: "enum" as DataType,
      dispatchConfig: { param: "nanoe", guid: bridgeDevice.id },
      enumValues: [...NANOE_VALUES],
    });
  }

  return {
    friendlyName: bridgeDevice.name || bridgeDevice.id,
    manufacturer: "Panasonic",
    model: bridgeDevice.model || undefined,
    data,
    orders,
  };
}
