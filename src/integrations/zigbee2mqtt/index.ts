import type { IntegrationPlugin } from "../integration-registry.js";
import type { IntegrationStatus, IntegrationSettingDef, Device } from "../../shared/types.js";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import { MqttConnector } from "../../mqtt/mqtt-connector.js";
import { Zigbee2MqttParser } from "../../mqtt/parsers/zigbee2mqtt.js";

const SETTINGS_PREFIX = "integration.zigbee2mqtt.";

export class Zigbee2MqttIntegration implements IntegrationPlugin {
  readonly id = "zigbee2mqtt";
  readonly name = "Zigbee2MQTT";
  readonly description = "Zigbee devices via MQTT bridge";
  readonly icon = "Radio";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private mqttConnector: MqttConnector | null = null;
  private z2mParser: Zigbee2MqttParser | null = null;
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
    this.logger = logger.child({ module: "integration-zigbee2mqtt" });
  }

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    return this.status;
  }

  isConfigured(): boolean {
    return this.getSetting("mqtt_url") !== undefined;
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      {
        key: "mqtt_url",
        label: "MQTT Broker URL",
        type: "text",
        required: true,
        placeholder: "mqtt://localhost:1883",
      },
      {
        key: "mqtt_username",
        label: "MQTT Username",
        type: "text",
        required: false,
      },
      {
        key: "mqtt_password",
        label: "MQTT Password",
        type: "password",
        required: false,
      },
      {
        key: "mqtt_client_id",
        label: "MQTT Client ID",
        type: "text",
        required: false,
        defaultValue: "sowel",
      },
      {
        key: "base_topic",
        label: "Zigbee2MQTT Base Topic",
        type: "text",
        required: false,
        defaultValue: "zigbee2mqtt",
      },
    ];
  }

  async start(): Promise<void> {
    if (!this.isConfigured()) {
      this.status = "not_configured";
      return;
    }

    const mqttUrl = this.getSetting("mqtt_url")!;
    const mqttUsername = this.getSetting("mqtt_username") || undefined;
    const mqttPassword = this.getSetting("mqtt_password") || undefined;
    const mqttClientId = this.getSetting("mqtt_client_id") ?? "sowel";
    const baseTopic = this.getSetting("base_topic") ?? "zigbee2mqtt";

    try {
      this.mqttConnector = new MqttConnector(
        mqttUrl,
        { username: mqttUsername, password: mqttPassword, clientId: mqttClientId },
        this.eventBus,
        this.logger,
      );

      await this.mqttConnector.connect();

      this.z2mParser = new Zigbee2MqttParser(
        baseTopic,
        this.mqttConnector,
        this.deviceManager,
        this.logger,
      );
      this.z2mParser.start();

      this.status = this.mqttConnector.isConnected() ? "connected" : "disconnected";
      if (this.status === "connected") {
        this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      }

      this.logger.info("Zigbee2MQTT integration started");
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start Zigbee2MQTT integration");
    }
  }

  async stop(): Promise<void> {
    if (this.mqttConnector) {
      await this.mqttConnector.disconnect();
      this.mqttConnector = null;
      this.z2mParser = null;
      this.status = "disconnected";
      this.eventBus.emit({ type: "system.integration.disconnected", integrationId: this.id });
      this.logger.info("Zigbee2MQTT integration stopped");
    }
  }

  async executeOrder(
    _device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void> {
    if (!this.mqttConnector?.isConnected()) {
      throw new Error("MQTT broker not connected");
    }

    const topic = dispatchConfig.topic as string;
    const payloadKey = dispatchConfig.payloadKey as string;
    if (!topic || !payloadKey) {
      throw new Error("Invalid dispatch config: missing topic or payloadKey");
    }

    const payload: Record<string, unknown> = {};
    payload[payloadKey] = value;
    this.mqttConnector.publish(topic, JSON.stringify(payload));
  }

  /** Get the underlying MQTT connector (for settings reconnect) */
  getMqttConnector(): MqttConnector | null {
    return this.mqttConnector;
  }

  private getSetting(key: string): string | undefined {
    return this.settingsManager.get(`${SETTINGS_PREFIX}${key}`);
  }
}
