import type { IntegrationPlugin } from "../integration-registry.js";
import type { IntegrationStatus, IntegrationSettingDef, Device } from "../../shared/types.js";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import { MczBridge } from "./mcz-bridge.js";
import { MczPoller } from "./mcz-poller.js";
import {
  COMMAND_ID,
  profileToRaw,
  RESET_ALARM_VALUE,
  POWER_ON_VALUE,
  POWER_OFF_VALUE,
} from "./mcz-types.js";

const SETTINGS_PREFIX = "integration.mcz_maestro.";

export class MczMaestroIntegration implements IntegrationPlugin {
  readonly id = "mcz_maestro";
  readonly name = "MCZ Maestro";
  readonly description = "MCZ pellet stoves via Maestro cloud";
  readonly icon = "Flame";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private bridge: MczBridge | null = null;
  private poller: MczPoller | null = null;
  private status: IntegrationStatus = "disconnected";

  constructor(
    settingsManager: SettingsManager,
    deviceManager: DeviceManager,
    eventBus: EventBus,
    logger: Logger,
  ) {
    this.settingsManager = settingsManager;
    this.deviceManager = deviceManager;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "integration-mcz-maestro" });
  }

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    return this.status;
  }

  isConfigured(): boolean {
    return (
      this.getSetting("serial_number") !== undefined && this.getSetting("mac_address") !== undefined
    );
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      {
        key: "serial_number",
        label: "Serial number",
        type: "text",
        required: true,
        placeholder: "e.g. 1234567890",
      },
      {
        key: "mac_address",
        label: "MAC address",
        type: "text",
        required: true,
        placeholder: "e.g. AA:BB:CC:DD:EE:FF",
      },
      {
        key: "polling_interval",
        label: "Polling interval (seconds)",
        type: "number",
        required: false,
        defaultValue: "300",
        placeholder: "300",
      },
    ];
  }

  async start(options?: { pollOffset?: number }): Promise<void> {
    // Clean up previous state before (re)starting
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
    if (this.bridge) {
      this.bridge.disconnect();
      this.bridge = null;
    }

    if (!this.isConfigured()) {
      this.status = "not_configured";
      return;
    }

    const serialNumber = this.getSetting("serial_number")!;
    const macAddress = this.getSetting("mac_address")!;
    const pollingIntervalSec = parseInt(this.getSetting("polling_interval") ?? "300", 10);
    const pollingIntervalMs = (isNaN(pollingIntervalSec) ? 300 : pollingIntervalSec) * 1000;

    try {
      this.bridge = new MczBridge(this.logger);

      // Connect to MCZ cloud
      await this.bridge.connect(serialNumber, macAddress);
      this.logger.info("MCZ Maestro cloud connected");

      // Start polling
      this.poller = new MczPoller(
        this.bridge,
        this.deviceManager,
        this.logger,
        serialNumber,
        pollingIntervalMs,
      );
      await this.poller.start(options?.pollOffset ?? 0);

      this.status = "connected";
      this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      this.logger.info({ pollingIntervalMs }, "MCZ Maestro integration started");
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start MCZ Maestro integration");
    }
  }

  async stop(): Promise<void> {
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
    if (this.bridge) {
      this.bridge.disconnect();
      this.bridge = null;
    }
    this.status = "disconnected";
    this.eventBus.emit({ type: "system.integration.disconnected", integrationId: this.id });
    this.logger.info("MCZ Maestro integration stopped");
  }

  async executeOrder(
    _device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void> {
    if (!this.bridge || this.status !== "connected") {
      throw new Error("MCZ Maestro integration not connected");
    }

    const commandId = dispatchConfig.commandId as number;
    if (commandId === undefined) {
      throw new Error("Invalid dispatch config: missing commandId");
    }

    let rawValue: number;

    switch (commandId) {
      case COMMAND_ID.POWER:
        rawValue = value === true ? POWER_ON_VALUE : POWER_OFF_VALUE;
        break;
      case COMMAND_ID.TARGET_TEMPERATURE:
        // Protocol expects value × 2
        rawValue = Math.round((value as number) * 2);
        break;
      case COMMAND_ID.PROFILE:
        rawValue = profileToRaw(value as string);
        break;
      case COMMAND_ID.ECO_MODE:
        rawValue = value === true ? 1 : 0;
        break;
      case COMMAND_ID.RESET_ALARM:
        rawValue = RESET_ALARM_VALUE;
        break;
      default:
        rawValue = value as number;
    }

    await this.bridge.sendCommand(commandId, rawValue);
    this.logger.info({ commandId, value, rawValue }, "MCZ order executed");

    // Schedule on-demand poll to confirm the change
    if (this.poller) {
      this.poller.scheduleOnDemandPoll();
    }
  }

  async refresh(): Promise<void> {
    if (!this.poller || this.status !== "connected") {
      throw new Error("MCZ Maestro integration not connected");
    }
    await this.poller.refresh();
    this.logger.info("MCZ Maestro manual refresh completed");
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    return this.poller?.getPollingInfo() ?? null;
  }

  private getSetting(key: string): string | undefined {
    return this.settingsManager.get(`${SETTINGS_PREFIX}${key}`);
  }
}
