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

/** Boolean params expected by Netatmo setstate API. */
const BOOLEAN_PARAMS = new Set(["on"]);
/** Numeric params expected by Netatmo setstate API. */
const NUMERIC_PARAMS = new Set(["brightness", "target_position"]);

/** Coerce Sowel order value to the type Netatmo API expects. */
function coerceValue(param: string, value: unknown): unknown {
  if (BOOLEAN_PARAMS.has(param)) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toUpperCase() === "ON" || value === "true";
    return Boolean(value);
  }
  if (NUMERIC_PARAMS.has(param)) {
    return typeof value === "number" ? value : Number(value);
  }
  return value;
}

export class NetatmoHCIntegration implements IntegrationPlugin {
  readonly id = "netatmo_hc";
  readonly name = "Legrand Home+Control";
  readonly description = "Netatmo Connect API integration";
  readonly icon = "PlugZap";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private bridge: NetatmoBridge | null = null;
  private poller: NetatmoPoller | null = null;
  private status: IntegrationStatus = "disconnected";
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;

  constructor(
    settingsManager: SettingsManager,
    deviceManager: DeviceManager,
    eventBus: EventBus,
    logger: Logger,
  ) {
    this.settingsManager = settingsManager;
    this.deviceManager = deviceManager;
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
      {
        key: "enable_home_control",
        label: "Enable Home+Control devices",
        type: "boolean",
        required: false,
        defaultValue: "true",
      },
      {
        key: "enable_weather",
        label: "Enable Weather Station",
        type: "boolean",
        required: false,
        defaultValue: "false",
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

    const clientId = this.getSetting("client_id")!;
    const clientSecret = this.getSetting("client_secret")!;
    const refreshToken = this.getSetting("refresh_token")!;
    const pollingIntervalSec = parseInt(this.getSetting("polling_interval") ?? "300", 10);
    const pollingIntervalMs = (isNaN(pollingIntervalSec) ? 300 : pollingIntervalSec) * 1000;
    const enableHomeControl = this.getSetting("enable_home_control") !== "false"; // default true
    const enableWeather = this.getSetting("enable_weather") === "true";

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
      this.logger.info("Legrand H+C authentication successful");

      // Discover home ID (use first home) — needed for Home+Control
      let homeId = "";
      if (enableHomeControl) {
        const homesData = await this.bridge.getHomesData();
        const homes = homesData.body.homes;
        if (homes.length === 0) {
          throw new Error("No homes found in Legrand H+C account");
        }
        homeId = homes[0].id;
        this.logger.info({ homeId, homeName: homes[0].name }, "Using Legrand H+C home");
      }

      // Start polling
      this.poller = new NetatmoPoller(
        this.bridge,
        this.deviceManager,
        this.eventBus,
        homeId,
        this.logger,
        pollingIntervalMs,
        enableHomeControl,
        enableWeather,
      );
      await this.poller.start(options?.pollOffset ?? 0);

      this.status = "connected";
      this.retryCount = 0;
      this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      this.logger.info({ pollingIntervalMs }, "Legrand H+C integration started");
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start Legrand H+C integration");
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
    this.logger.info("Legrand H+C integration stopped");
  }

  /** Schedule an automatic retry with exponential backoff (30s, 60s, 120s, ... max 10min). */
  private scheduleRetry(): void {
    this.cancelRetry();
    this.retryCount++;
    const delaySec = Math.min(30 * Math.pow(2, this.retryCount - 1), 600);
    this.logger.warn({ retryCount: this.retryCount, delaySec }, "Scheduling automatic retry");
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.start().catch((err) => this.logger.error({ err }, "Retry start failed"));
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
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void> {
    if (!this.bridge || this.status !== "connected") {
      throw new Error("Legrand H+C integration not connected");
    }

    const homeId = dispatchConfig.homeId as string;
    const moduleId = dispatchConfig.moduleId as string;
    const param = dispatchConfig.param as string;
    const bridge = dispatchConfig.bridge as string | undefined;

    if (!homeId || !moduleId || !param) {
      throw new Error("Invalid dispatch config: missing homeId, moduleId, or param");
    }

    // Coerce value to the type expected by Netatmo API
    const apiValue = coerceValue(param, value);

    const modulePayload: Record<string, unknown> = { id: moduleId, [param]: apiValue };
    if (bridge) modulePayload.bridge = bridge;

    await this.bridge.setState({
      home: {
        id: homeId,
        modules: [modulePayload],
      },
    });

    this.logger.info({ moduleId, param, value }, "Legrand H+C order executed");

    // Rapid-poll status until the expected state is confirmed (or 10s timeout)
    if (this.poller) {
      this.poller.scheduleOnDemandPoll({ moduleId, param, value: apiValue });
    }
  }

  async refresh(): Promise<void> {
    if (!this.poller || this.status !== "connected") {
      throw new Error("Legrand H+C integration not connected");
    }
    await this.poller.refresh();
    this.logger.info("Legrand H+C manual refresh completed");
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    return this.poller?.getPollingInfo() ?? null;
  }

  private getSetting(key: string): string | undefined {
    return this.settingsManager.get(`${SETTINGS_PREFIX}${key}`);
  }
}
