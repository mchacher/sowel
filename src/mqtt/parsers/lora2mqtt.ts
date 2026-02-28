import type { Logger } from "../../core/logger.js";
import type { MqttConnector } from "../mqtt-connector.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { DataType, DataCategory } from "../../shared/types.js";
import { LORA_TYPE_TO_DATA_TYPE, PROPERTY_TO_CATEGORY } from "../../shared/constants.js";

interface ParsedData {
  key: string;
  type: DataType;
  category: DataCategory;
  unit?: string;
}

interface ParsedOrder {
  key: string;
  type: DataType;
  dispatchConfig: Record<string, unknown>;
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}

interface ParsedDevice {
  ieeeAddress: string;
  friendlyName: string;
  manufacturer?: string;
  model?: string;
  data: ParsedData[];
  orders: ParsedOrder[];
  rawExpose: unknown;
}

interface LoraNode {
  node_id: number;
  friendly_name: string | null;
  data_keys: Record<string, { type: string; access: string; values?: string[] }>;
  is_active: boolean;
}

export class Lora2MqttParser {
  private logger: Logger;
  private mqttConnector: MqttConnector;
  private deviceManager: DeviceManager;
  private baseTopic: string;

  constructor(
    baseTopic: string,
    mqttConnector: MqttConnector,
    deviceManager: DeviceManager,
    logger: Logger,
  ) {
    this.baseTopic = baseTopic;
    this.mqttConnector = mqttConnector;
    this.deviceManager = deviceManager;
    this.logger = logger.child({ module: "lora2mqtt-parser" });
  }

  start(): void {
    // Subscribe to bridge/devices (retained message with full node list)
    this.mqttConnector.subscribe(`${this.baseTopic}/bridge/devices`, (_topic, payload) => {
      this.handleBridgeDevices(payload);
    });

    // Subscribe to device state messages
    this.mqttConnector.subscribe(`${this.baseTopic}/+`, (topic, payload) => {
      this.handleDeviceState(topic, payload);
    });

    // Subscribe to device availability
    this.mqttConnector.subscribe(`${this.baseTopic}/+/availability`, (topic, payload) => {
      this.handleDeviceAvailability(topic, payload);
    });

    this.logger.info({ baseTopic: this.baseTopic }, "LoRa2MQTT parser started");
  }

  private handleBridgeDevices(payload: Buffer): void {
    try {
      const nodes: LoraNode[] = JSON.parse(payload.toString());
      this.logger.info({ count: nodes.length }, "Received bridge/devices");

      const currentNames = new Set<string>();

      for (const node of nodes) {
        // Skip nodes without a friendly_name (can't be addressed)
        if (!node.friendly_name) continue;

        currentNames.add(node.friendly_name);
        const parsed = this.parseLoraNode(node);
        if (parsed) {
          this.deviceManager.upsertFromDiscovery(this.baseTopic, "lora2mqtt", parsed);
        }
      }

      // Clean up devices no longer in the bridge device list
      this.deviceManager.removeStaleDevices(this.baseTopic, currentNames);
      this.deviceManager.logSummary();
    } catch (err) {
      this.logger.error({ err }, "Failed to parse bridge/devices");
    }
  }

  private handleDeviceState(topic: string, payload: Buffer): void {
    const prefix = `${this.baseTopic}/`;
    if (!topic.startsWith(prefix)) return;

    const rest = topic.slice(prefix.length);

    // Skip bridge topics, availability subtopics, and legacy NODE_XX topics
    if (rest.startsWith("bridge/") || rest.includes("/") || rest.startsWith("NODE_")) return;

    const deviceName = rest;

    try {
      const data = JSON.parse(payload.toString());
      if (typeof data !== "object" || data === null) return;

      // Remove internal #tx counter and normalize action values
      const cleaned = { ...data };
      delete cleaned["#tx"];
      if (cleaned.action === "click") cleaned.action = "single";

      if (Object.keys(cleaned).length > 0) {
        this.deviceManager.updateDeviceData(
          this.baseTopic,
          deviceName,
          cleaned as Record<string, unknown>,
        );
      }
    } catch {
      // Non-JSON payloads are ignored
    }
  }

  private handleDeviceAvailability(topic: string, payload: Buffer): void {
    const prefix = `${this.baseTopic}/`;
    const suffix = "/availability";
    if (!topic.startsWith(prefix) || !topic.endsWith(suffix)) return;

    const deviceName = topic.slice(prefix.length, -suffix.length);

    // Skip legacy NODE_XX availability
    if (deviceName.startsWith("NODE_")) return;

    try {
      const status = payload.toString();
      if (status === "online" || status === "offline") {
        this.deviceManager.updateDeviceStatus(this.baseTopic, deviceName, status);
      }
    } catch (err) {
      this.logger.error({ err, topic }, "Failed to parse availability");
    }
  }

  private parseLoraNode(node: LoraNode): ParsedDevice | null {
    if (!node.friendly_name) return null;

    const data: ParsedData[] = [];
    const orders: ParsedOrder[] = [];

    for (const [key, meta] of Object.entries(node.data_keys ?? {})) {
      const dataType: DataType = LORA_TYPE_TO_DATA_TYPE[meta.type] ?? "text";
      const category: DataCategory = PROPERTY_TO_CATEGORY[key] ?? "generic";

      // All keys are readable → create DeviceData
      data.push({ key, type: dataType, category });

      // If writable → also create DeviceOrder
      if (meta.access === "rw") {
        orders.push({
          key,
          type: dataType,
          dispatchConfig: {
            topic: `${this.baseTopic}/${node.friendly_name}/set`,
            payloadKey: key,
          },
          enumValues: meta.values,
        });
      }
    }

    return {
      ieeeAddress: String(node.node_id),
      friendlyName: node.friendly_name,
      manufacturer: "LoRa",
      model: `Node ${node.node_id}`,
      data,
      orders,
      rawExpose: node.data_keys,
    };
  }
}
