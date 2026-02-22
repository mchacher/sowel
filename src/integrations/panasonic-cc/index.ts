import { resolve } from "node:path";
import type { IntegrationPlugin } from "../integration-registry.js";
import type { IntegrationStatus, IntegrationSettingDef, Device } from "../../shared/types.js";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import { PanasonicBridge } from "./panasonic-bridge.js";
import { PanasonicPoller } from "./panasonic-poller.js";

const SETTINGS_PREFIX = "integration.panasonic_cc.";
const DEFAULT_DATA_DIR = resolve(process.cwd(), "data");

export class PanasonicCCIntegration implements IntegrationPlugin {
  readonly id = "panasonic_cc";
  readonly name = "Panasonic Comfort Cloud";
  readonly description = "Panasonic AC units via Comfort Cloud API";
  readonly icon = "AirVent";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private bridge: PanasonicBridge | null = null;
  private poller: PanasonicPoller | null = null;
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
    this.logger = logger.child({ module: "integration-panasonic-cc" });
  }

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    return this.status;
  }

  isConfigured(): boolean {
    return this.getSetting("email") !== undefined && this.getSetting("password") !== undefined;
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      {
        key: "email",
        label: "Panasonic ID (email)",
        type: "text",
        required: true,
        placeholder: "user@example.com",
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        required: true,
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
    if (!this.isConfigured()) {
      this.status = "not_configured";
      return;
    }

    const email = this.getSetting("email")!;
    const password = this.getSetting("password")!;
    const pollingIntervalSec = parseInt(this.getSetting("polling_interval") ?? "300", 10);
    const pollingIntervalMs = (isNaN(pollingIntervalSec) ? 300 : pollingIntervalSec) * 1000;
    const tokenFile = resolve(DEFAULT_DATA_DIR, "panasonic-tokens.json");

    try {
      this.bridge = new PanasonicBridge(tokenFile, this.logger);

      // Verify credentials
      await this.bridge.login(email, password);
      this.logger.info("Panasonic CC credentials verified");

      // Start polling
      this.poller = new PanasonicPoller(
        this.bridge,
        this.deviceManager,
        this.logger,
        email,
        password,
        pollingIntervalMs,
      );
      this.poller.start();

      this.status = "connected";
      this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      this.logger.info({ pollingIntervalMs }, "Panasonic CC integration started");
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start Panasonic CC integration");
    }
  }

  async stop(): Promise<void> {
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
    this.bridge = null;
    this.status = "disconnected";
    this.eventBus.emit({ type: "system.integration.disconnected", integrationId: this.id });
    this.logger.info("Panasonic CC integration stopped");
  }

  async executeOrder(
    _device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void> {
    if (!this.bridge || this.status !== "connected") {
      throw new Error("Panasonic CC integration not connected");
    }

    const email = this.getSetting("email")!;
    const password = this.getSetting("password")!;
    const param = dispatchConfig.param as string;
    const guid = dispatchConfig.guid as string;

    if (!param || !guid) {
      throw new Error("Invalid dispatch config: missing param or guid");
    }

    await this.bridge.control(guid, param, value, email, password);
    this.logger.info({ guid, param, value }, "Panasonic order executed");

    // Schedule on-demand poll to confirm the change
    if (this.poller) {
      this.poller.scheduleOnDemandPoll();
    }
  }

  private getSetting(key: string): string | undefined {
    return this.settingsManager.get(`${SETTINGS_PREFIX}${key}`);
  }
}
