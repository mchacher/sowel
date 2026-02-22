/**
 * MczPoller — periodic polling loop for MCZ Maestro stove data.
 *
 * Same pattern as PanasonicPoller: immediate first poll, regular interval,
 * on-demand poll after order execution, concurrent-poll prevention.
 */

import type { Logger } from "../../core/logger.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { DiscoveredDevice } from "../../devices/device-manager.js";
import type { DataType, DataCategory } from "../../shared/types.js";
import type { MczBridge } from "./mcz-bridge.js";
import {
  type MczStatusFrame,
  stoveStateToString,
  isStoveActive,
  profileToString,
  pelletSensorToString,
  sparkPlugToString,
  ORDER_PROFILE_VALUES,
  PELLET_SENSOR_VALUES,
  SPARK_PLUG_VALUES,
  COMMAND_ID,
} from "./mcz-types.js";

const DEFAULT_POLL_INTERVAL_MS = 300_000; // 5 minutes
const DEFAULT_ON_DEMAND_DELAY_MS = 5_000; // 5 seconds

export class MczPoller {
  private bridge: MczBridge;
  private deviceManager: DeviceManager;
  private logger: Logger;
  private serialNumber: string;
  private pollIntervalMs: number;
  private onDemandDelayMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  private polling = false;

  constructor(
    bridge: MczBridge,
    deviceManager: DeviceManager,
    logger: Logger,
    serialNumber: string,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onDemandDelayMs = DEFAULT_ON_DEMAND_DELAY_MS,
  ) {
    this.bridge = bridge;
    this.deviceManager = deviceManager;
    this.logger = logger.child({ module: "mcz-poller" });
    this.serialNumber = serialNumber;
    this.pollIntervalMs = pollIntervalMs;
    this.onDemandDelayMs = onDemandDelayMs;
  }

  async start(): Promise<void> {
    this.logger.info({ intervalMs: this.pollIntervalMs }, "Starting MCZ poller");
    // Immediate first poll — awaited so data is available at startup
    await this.poll();
    // Regular polling
    this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.logger.info("MCZ poller stopped");
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  scheduleOnDemandPoll(delayMs?: number): void {
    const delay = delayMs ?? this.onDemandDelayMs;
    this.logger.debug({ delayMs: delay }, "Scheduling on-demand MCZ poll");
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.poll();
    }, delay);
    this.pendingTimers.add(timer);
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      this.logger.debug("MCZ poll already in progress, skipping");
      return;
    }
    this.polling = true;

    try {
      this.logger.debug("Polling MCZ stove...");
      const frame = await this.bridge.getStatus();

      // Upsert device with capabilities
      const discovered = mapFrameToDiscovered(this.serialNumber, frame);
      this.deviceManager.upsertFromDiscovery("mcz_maestro", "mcz_maestro", discovered);

      // Update data values
      this.updateDeviceData(frame);

      this.logger.debug({ frame }, "MCZ poll complete");
    } catch (err) {
      this.logger.error({ err }, "MCZ poll failed");
    } finally {
      this.polling = false;
    }
  }

  private updateDeviceData(frame: MczStatusFrame): void {
    const sourceDeviceId = this.serialNumber;

    const stoveState = stoveStateToString(frame.stoveState);
    const isOn = isStoveActive(stoveState);

    const payload: Record<string, unknown> = {
      power: isOn,
      stoveState: stoveState,
      insideTemperature: frame.ambientTemperature,
      targetTemperature: frame.targetTemperature,
      profile: profileToString(frame.profile),
      ecoMode: frame.ecoMode === 1,
      pelletSensor: pelletSensorToString(frame.pelletSensor),
      ignitionCount: frame.ignitionCount,
      sparkPlug: sparkPlugToString(frame.sparkPlug),
    };

    this.deviceManager.updateDeviceData("mcz_maestro", sourceDeviceId, payload);
  }
}

/**
 * Map an MCZ status frame to a Corbel DiscoveredDevice for upsert.
 */
function mapFrameToDiscovered(_serial: string, _frame: MczStatusFrame): DiscoveredDevice {
  const stoveStates = [
    "off",
    "checking",
    "stabilizing",
    "running",
    "running_p1",
    "running_p2",
    "running_p3",
    "running_p4",
    "running_p5",
    "diagnostic",
    "extinguishing",
    "cooling",
    "standby",
    "auto_eco",
  ];

  const data: DiscoveredDevice["data"] = [
    { key: "power", type: "boolean" as DataType, category: "generic" as DataCategory },
    {
      key: "stoveState",
      type: "enum" as DataType,
      category: "generic" as DataCategory,
    },
    {
      key: "insideTemperature",
      type: "number" as DataType,
      category: "temperature" as DataCategory,
      unit: "°C",
    },
    {
      key: "targetTemperature",
      type: "number" as DataType,
      category: "temperature" as DataCategory,
      unit: "°C",
    },
    {
      key: "profile",
      type: "enum" as DataType,
      category: "generic" as DataCategory,
    },
    { key: "ecoMode", type: "boolean" as DataType, category: "generic" as DataCategory },
    {
      key: "pelletSensor",
      type: "enum" as DataType,
      category: "generic" as DataCategory,
    },
    { key: "ignitionCount", type: "number" as DataType, category: "generic" as DataCategory },
    {
      key: "sparkPlug",
      type: "enum" as DataType,
      category: "generic" as DataCategory,
    },
  ];

  const orders: DiscoveredDevice["orders"] = [
    {
      key: "power",
      type: "boolean" as DataType,
      dispatchConfig: { commandId: COMMAND_ID.POWER },
    },
    {
      key: "targetTemperature",
      type: "number" as DataType,
      dispatchConfig: { commandId: COMMAND_ID.TARGET_TEMPERATURE },
      min: 5,
      max: 40,
      unit: "°C",
    },
    {
      key: "profile",
      type: "enum" as DataType,
      dispatchConfig: { commandId: COMMAND_ID.PROFILE },
      enumValues: [...ORDER_PROFILE_VALUES],
    },
    {
      key: "ecoMode",
      type: "boolean" as DataType,
      dispatchConfig: { commandId: COMMAND_ID.ECO_MODE },
    },
    {
      key: "resetAlarm",
      type: "boolean" as DataType,
      dispatchConfig: { commandId: COMMAND_ID.RESET_ALARM },
    },
  ];

  return {
    friendlyName: _serial,
    manufacturer: "MCZ",
    model: "Maestro",
    data,
    orders,
    rawExpose: {
      stoveStates,
      pelletSensorValues: [...PELLET_SENSOR_VALUES],
      sparkPlugValues: [...SPARK_PLUG_VALUES],
    },
  };
}
