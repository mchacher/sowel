import type { IntegrationPlugin } from "../integration-registry.js";
import type { IntegrationStatus, IntegrationSettingDef, Device } from "../../shared/types.js";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import { MqttConnector } from "../../mqtt/mqtt-connector.js";
import { Lora2MqttParser } from "../../mqtt/parsers/lora2mqtt.js";

const SETTINGS_PREFIX = "integration.lora2mqtt.";

export class Lora2MqttIntegration implements IntegrationPlugin {
  readonly id = "lora2mqtt";
  readonly name = "LoRa2MQTT";
  readonly description = "LoRa devices via lora2mqtt bridge";
  readonly icon = "Radio";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private mqttConnector: MqttConnector | null = null;
  private loraParser: Lora2MqttParser | null = null;
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
    this.logger = logger.child({ module: "integration-lora2mqtt" });
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
        placeholder: "mqtt://192.168.0.45:1883",
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
        defaultValue: "sowel-lora",
      },
      {
        key: "base_topic",
        label: "LoRa2MQTT Base Topic",
        type: "text",
        required: false,
        defaultValue: "lora2mqtt",
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
    const mqttClientId = this.getSetting("mqtt_client_id") ?? "sowel-lora";
    const baseTopic = this.getSetting("base_topic") ?? "lora2mqtt";

    try {
      this.mqttConnector = new MqttConnector(
        mqttUrl,
        { username: mqttUsername, password: mqttPassword, clientId: mqttClientId },
        this.eventBus,
        this.logger,
      );

      await this.mqttConnector.connect();

      this.loraParser = new Lora2MqttParser(
        baseTopic,
        this.mqttConnector,
        this.deviceManager,
        this.logger,
      );
      this.loraParser.start();

      this.status = this.mqttConnector.isConnected() ? "connected" : "disconnected";
      if (this.status === "connected") {
        this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      }

      this.logger.info("LoRa2MQTT integration started");
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start LoRa2MQTT integration");
    }
  }

  async stop(): Promise<void> {
    if (this.mqttConnector) {
      await this.mqttConnector.disconnect();
      this.mqttConnector = null;
      this.loraParser = null;
      this.status = "disconnected";
      this.eventBus.emit({ type: "system.integration.disconnected", integrationId: this.id });
      this.logger.info("LoRa2MQTT integration stopped");
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
