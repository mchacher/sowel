import { resolve } from "node:path";
import type { IntegrationPlugin } from "../integration-registry.js";
import type { IntegrationStatus, IntegrationSettingDef, Device } from "../../shared/types.js";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import { NetatmoBridge } from "./netatmo-bridge.js";
import { NetatmoPoller } from "./netatmo-poller.js";

const SETTINGS_PREFIX = "integration.netatmo_hc.";
const DEFAULT_DATA_DIR = resolve(process.cwd(), "data");

export class NetatmoHCIntegration implements IntegrationPlugin {
  readonly id = "netatmo_hc";
  readonly name = "Netatmo Home+Control";
  readonly description = "Legrand Home+Control devices via Netatmo Connect API";
  readonly icon = "PlugZap";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private bridge: NetatmoBridge | null = null;
  private poller: NetatmoPoller | null = null;
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
    this.logger = logger.child({ module: "integration-netatmo-hc" });
  }

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    return this.status;
  }

  isConfigured(): boolean {
    return (
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
      {
        key: "client_secret",
        label: "Client Secret",
        type: "password",
        required: true,
      },
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
    ];
  }

  async start(): Promise<void> {
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

    const clientId = this.getSetting("client_id")!;
    const clientSecret = this.getSetting("client_secret")!;
    const refreshToken = this.getSetting("refresh_token")!;
    const pollingIntervalSec = parseInt(this.getSetting("polling_interval") ?? "300", 10);
    const pollingIntervalMs = (isNaN(pollingIntervalSec) ? 300 : pollingIntervalSec) * 1000;

    try {
      // Create bridge with token rotation callback
      this.bridge = new NetatmoBridge(
        clientId,
        clientSecret,
        refreshToken,
        this.logger,
        DEFAULT_DATA_DIR,
        (newToken) => {
          // Persist the rotated refresh_token to settings
          this.settingsManager.set(`${SETTINGS_PREFIX}refresh_token`, newToken);
        },
      );

      // Authenticate (refresh token → get access token)
      await this.bridge.authenticate();
      this.logger.info("Netatmo authentication successful");

      // Discover home ID (use first home)
      const homesData = await this.bridge.getHomesData();
      const homes = homesData.body.homes;
      if (homes.length === 0) {
        throw new Error("No homes found in Netatmo account");
      }
      const homeId = homes[0].id;
      this.logger.info({ homeId, homeName: homes[0].name }, "Using Netatmo home");

      // Start polling
      this.poller = new NetatmoPoller(
        this.bridge,
        this.deviceManager,
        homeId,
        this.logger,
        pollingIntervalMs,
      );
      await this.poller.start();

      this.status = "connected";
      this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      this.logger.info({ pollingIntervalMs }, "Netatmo Home+Control integration started");
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start Netatmo Home+Control integration");
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
    this.logger.info("Netatmo Home+Control integration stopped");
  }

  async executeOrder(
    _device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void> {
    if (!this.bridge || this.status !== "connected") {
      throw new Error("Netatmo Home+Control integration not connected");
    }

    const homeId = dispatchConfig.homeId as string;
    const moduleId = dispatchConfig.moduleId as string;
    const param = dispatchConfig.param as string;

    if (!homeId || !moduleId || !param) {
      throw new Error("Invalid dispatch config: missing homeId, moduleId, or param");
    }

    await this.bridge.setState({
      home: {
        id: homeId,
        modules: [{ id: moduleId, [param]: value }],
      },
    });

    this.logger.info({ moduleId, param, value }, "Netatmo order executed");

    // Schedule on-demand poll to confirm the change
    if (this.poller) {
      this.poller.scheduleOnDemandPoll();
    }
  }

  async refresh(): Promise<void> {
    if (!this.poller || this.status !== "connected") {
      throw new Error("Netatmo Home+Control integration not connected");
    }
    await this.poller.refresh();
    this.logger.info("Netatmo Home+Control manual refresh completed");
  }

  private getSetting(key: string): string | undefined {
    return this.settingsManager.get(`${SETTINGS_PREFIX}${key}`);
  }
}
