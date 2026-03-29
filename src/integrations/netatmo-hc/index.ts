import { resolve } from "node:path";
import type { IntegrationPlugin } from "../integration-registry.js";
import type { IntegrationStatus, IntegrationSettingDef, Device } from "../../shared/types.js";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { InfluxClient } from "../../core/influx-client.js";
import { NetatmoBridge } from "./netatmo-bridge.js";
import { NetatmoPoller } from "./netatmo-poller.js";
import { backfillEnergyIfNeeded } from "./energy-backfill.js";

const SETTINGS_PREFIX = "integration.netatmo_hc.";
const DEFAULT_DATA_DIR = resolve(process.cwd(), "data");

/**
 * Netatmo HC integration — now only handles energy monitoring (NLPC meters).
 * Home+Control devices are handled by the legrand_control plugin.
 * Weather data is handled by the netatmo_weather plugin.
 */
export class NetatmoHCIntegration implements IntegrationPlugin {
  readonly id = "netatmo_hc";
  readonly name = "Legrand Energy";
  readonly description = "Legrand energy monitoring (NLPC meters)";
  readonly icon = "Zap";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private equipmentManager: EquipmentManager;
  private bridge: NetatmoBridge | null = null;
  private poller: NetatmoPoller | null = null;
  private status: IntegrationStatus = "disconnected";
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;

  constructor(
    settingsManager: SettingsManager,
    deviceManager: DeviceManager,
    equipmentManager: EquipmentManager,
    eventBus: EventBus,
    logger: Logger,
  ) {
    this.settingsManager = settingsManager;
    this.deviceManager = deviceManager;
    this.equipmentManager = equipmentManager;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "legrand-hc" });
  }

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    if (this.status === "connected" && this.poller && !this.poller.isPollHealthy()) {
      return "error";
    }
    return this.status;
  }

  isConfigured(): boolean {
    const enableEnergy = this.getSetting("enable_energy") === "true";
    return (
      enableEnergy &&
      this.getSetting("client_id") !== undefined &&
      this.getSetting("client_secret") !== undefined &&
      this.getSetting("refresh_token") !== undefined
    );
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      {
        key: "client_id",
        label: "Client ID",
        type: "text",
        required: true,
        placeholder: "From dev.netatmo.com",
      },
      { key: "client_secret", label: "Client Secret", type: "password", required: true },
      {
        key: "refresh_token",
        label: "Refresh Token",
        type: "password",
        required: true,
        placeholder: "From Netatmo Token Generator",
      },
      {
        key: "polling_interval",
        label: "Polling interval (seconds)",
        type: "number",
        required: false,
        defaultValue: "300",
        placeholder: "300",
      },
      {
        key: "enable_energy",
        label: "Enable Energy Monitoring",
        type: "boolean",
        required: false,
        defaultValue: "false",
      },
    ];
  }

  async start(options?: { pollOffset?: number }): Promise<void> {
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

    const clientId = this.getSetting("client_id")!;
    const clientSecret = this.getSetting("client_secret")!;
    const refreshToken = this.getSetting("refresh_token")!;
    const pollingIntervalSec = parseInt(this.getSetting("polling_interval") ?? "300", 10);
    const pollingIntervalMs = (isNaN(pollingIntervalSec) ? 300 : pollingIntervalSec) * 1000;

    try {
      this.bridge = new NetatmoBridge(
        clientId,
        clientSecret,
        refreshToken,
        this.logger,
        DEFAULT_DATA_DIR,
        (newToken) => {
          this.settingsManager.set(`${SETTINGS_PREFIX}refresh_token`, newToken);
        },
      );

      await this.bridge.authenticate();
      this.logger.info("Legrand Energy authentication successful");

      // Discover home ID for energy polling
      const homesData = await this.bridge.getHomesData();
      const homes = homesData.body.homes;
      if (homes.length === 0) throw new Error("No homes found");
      const homeId = homes[0].id;

      // Start energy-only poller
      this.poller = new NetatmoPoller(
        this.bridge,
        this.deviceManager,
        this.equipmentManager,
        this.settingsManager,
        this.eventBus,
        homeId,
        this.logger,
        pollingIntervalMs,
      );
      await this.poller.start(options?.pollOffset ?? 0);

      this.status = "connected";
      this.retryCount = 0;
      this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      this.logger.info({ pollingIntervalMs }, "Legrand Energy started");
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start Legrand Energy");
      this.scheduleRetry();
    }
  }

  async stop(): Promise<void> {
    this.cancelRetry();
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
    this.logger.info("Legrand Energy stopped");
  }

  private scheduleRetry(): void {
    this.cancelRetry();
    this.retryCount++;
    const delaySec = Math.min(30 * Math.pow(2, this.retryCount - 1), 600);
    this.logger.warn({ retryCount: this.retryCount, delaySec }, "Scheduling retry");
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.start().catch((err) => this.logger.error({ err }, "Retry failed"));
    }, delaySec * 1000);
  }

  private cancelRetry(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  async executeOrder(
    _device: Device,
    _dispatchConfig: Record<string, unknown>,
    _value: unknown,
  ): Promise<void> {
    throw new Error("Legrand Energy does not support orders");
  }

  async refresh(): Promise<void> {
    if (!this.poller || this.status !== "connected") throw new Error("Not connected");
    await this.poller.refresh();
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    return this.poller?.getPollingInfo() ?? null;
  }

  async runEnergyBackfillIfNeeded(
    equipmentManager: EquipmentManager,
    influxClient: InfluxClient,
  ): Promise<void> {
    const enableEnergy = this.getSetting("enable_energy") === "true";
    if (!enableEnergy || !this.bridge || this.status !== "connected") return;

    const bridgeId = this.poller?.getBridgeId();
    if (!bridgeId) return;

    await backfillEnergyIfNeeded({
      bridge: this.bridge,
      bridgeId,
      influxClient,
      settingsManager: this.settingsManager,
      equipmentManager,
      logger: this.logger,
    });
  }

  private getSetting(key: string): string | undefined {
    return this.settingsManager.get(`${SETTINGS_PREFIX}${key}`);
  }
}
