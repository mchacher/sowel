import type { Logger } from "../../core/logger.js";
import type { MqttConnector } from "../mqtt-connector.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { Z2MDevice, Z2MExpose, Z2MBridgeEvent } from "../../shared/types.js";
import { Z2M_TYPE_TO_DATA_TYPE, Z2M_ACCESS_STATE, Z2M_ACCESS_SET } from "../../shared/constants.js";
import { inferCategory, collectProperties } from "../../devices/category-inference.js";
import type { DataType, DataCategory } from "../../shared/types.js";

interface ParsedData {
  key: string;
  type: DataType;
  category: DataCategory;
  unit?: string;
}

interface ParsedOrder {
  key: string;
  type: DataType;
  payloadKey: string;
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

export class Zigbee2MqttParser {
  private logger: Logger;
  private mqttConnector: MqttConnector;
  private deviceManager: DeviceManager;
  private baseTopic: string;
  private knownDeviceNames = new Set<string>();

  constructor(
    baseTopic: string,
    mqttConnector: MqttConnector,
    deviceManager: DeviceManager,
    logger: Logger,
  ) {
    this.baseTopic = baseTopic;
    this.mqttConnector = mqttConnector;
    this.deviceManager = deviceManager;
    this.logger = logger.child({ module: "z2m-parser" });
  }

  start(): void {
    // Subscribe to bridge/devices (retained message with full device list)
    this.mqttConnector.subscribe(
      `${this.baseTopic}/bridge/devices`,
      (_topic, payload) => {
        this.handleBridgeDevices(payload);
      },
    );

    // Subscribe to bridge/event (device join/leave)
    this.mqttConnector.subscribe(
      `${this.baseTopic}/bridge/event`,
      (_topic, payload) => {
        this.handleBridgeEvent(payload);
      },
    );

    // Subscribe to device state messages
    this.mqttConnector.subscribe(`${this.baseTopic}/+`, (topic, payload) => {
      this.handleDeviceState(topic, payload);
    });

    // Subscribe to device availability
    this.mqttConnector.subscribe(
      `${this.baseTopic}/+/availability`,
      (topic, payload) => {
        this.handleDeviceAvailability(topic, payload);
      },
    );

    this.logger.info({ baseTopic: this.baseTopic }, "Zigbee2MQTT parser started");
  }

  private handleBridgeDevices(payload: Buffer): void {
    try {
      const devices: Z2MDevice[] = JSON.parse(payload.toString());
      this.logger.info({ count: devices.length }, "Received bridge/devices");

      const currentNames = new Set<string>();

      for (const z2mDevice of devices) {
        // Skip the coordinator
        if (z2mDevice.type === "Coordinator") continue;
        // Skip unsupported or disabled devices
        if (!z2mDevice.supported || z2mDevice.disabled) continue;

        currentNames.add(z2mDevice.friendly_name);
        const parsed = this.parseZ2MDevice(z2mDevice);
        if (parsed) {
          this.deviceManager.upsertFromDiscovery(this.baseTopic, parsed);
        }
      }

      // Detect removed devices
      for (const name of this.knownDeviceNames) {
        if (!currentNames.has(name)) {
          this.deviceManager.markRemoved(this.baseTopic, name);
        }
      }

      this.knownDeviceNames = currentNames;
      this.deviceManager.logSummary();
    } catch (err) {
      this.logger.error({ err }, "Failed to parse bridge/devices");
    }
  }

  private handleBridgeEvent(payload: Buffer): void {
    try {
      const event: Z2MBridgeEvent = JSON.parse(payload.toString());

      if (
        event.type === "device_joined" ||
        event.type === "device_announce" ||
        event.type === "device_interview"
      ) {
        this.logger.info(
          { eventType: event.type, data: event.data },
          "Bridge event — will re-read device list on next bridge/devices publish",
        );
      }
    } catch (err) {
      this.logger.error({ err }, "Failed to parse bridge/event");
    }
  }

  private handleDeviceState(topic: string, payload: Buffer): void {
    // Extract device name from topic: "zigbee2mqtt/device_name"
    const prefix = `${this.baseTopic}/`;
    if (!topic.startsWith(prefix)) return;

    const rest = topic.slice(prefix.length);

    // Skip bridge topics and availability subtopics
    if (rest.startsWith("bridge/") || rest.includes("/")) return;

    const deviceName = rest;

    try {
      const data = JSON.parse(payload.toString());
      if (typeof data !== "object" || data === null) return;

      this.deviceManager.updateDeviceData(
        this.baseTopic,
        deviceName,
        data as Record<string, unknown>,
      );
    } catch {
      // Non-JSON payloads are ignored (some devices send plain text)
    }
  }

  private handleDeviceAvailability(topic: string, payload: Buffer): void {
    // Topic: "zigbee2mqtt/device_name/availability"
    const prefix = `${this.baseTopic}/`;
    const suffix = "/availability";
    if (!topic.startsWith(prefix) || !topic.endsWith(suffix)) return;

    const deviceName = topic.slice(prefix.length, -suffix.length);

    try {
      const raw = payload.toString();
      // z2m publishes availability as JSON {"state":"online"} or plain "online"/"offline"
      let status: string;
      try {
        const parsed = JSON.parse(raw);
        status = typeof parsed === "object" && parsed !== null ? parsed.state : raw;
      } catch {
        status = raw;
      }

      if (status === "online" || status === "offline") {
        this.deviceManager.updateDeviceStatus(
          this.baseTopic,
          deviceName,
          status,
        );
      }
    } catch (err) {
      this.logger.error({ err, topic }, "Failed to parse availability");
    }
  }

  private parseZ2MDevice(z2mDevice: Z2MDevice): ParsedDevice | null {
    const exposes = z2mDevice.definition?.exposes ?? [];
    const allProperties = collectProperties(exposes);
    const data: ParsedData[] = [];
    const orders: ParsedOrder[] = [];

    this.flattenExposes(exposes, allProperties, data, orders, z2mDevice.friendly_name);

    return {
      ieeeAddress: z2mDevice.ieee_address,
      friendlyName: z2mDevice.friendly_name,
      manufacturer: z2mDevice.definition?.vendor ?? z2mDevice.manufacturer,
      model: z2mDevice.definition?.model ?? z2mDevice.model_id,
      data,
      orders,
      rawExpose: exposes,
    };
  }

  private flattenExposes(
    exposes: Z2MExpose[],
    allProperties: Set<string>,
    data: ParsedData[],
    orders: ParsedOrder[],
    deviceName: string,
    parentExposeType?: string,
  ): void {
    for (const expose of exposes) {
      // Composite/list exposes contain nested features
      if (
        (expose.type === "composite" || expose.type === "list") &&
        expose.features
      ) {
        this.flattenExposes(expose.features, allProperties, data, orders, deviceName, parentExposeType);
        continue;
      }

      // Some top-level exposes have no property but have features (e.g. light, switch, climate)
      if (!expose.property && expose.features) {
        this.flattenExposes(expose.features, allProperties, data, orders, deviceName, expose.type);
        continue;
      }

      if (!expose.property) continue;

      // Default to readable (1) when access is undefined — if z2m exposes a property, it's readable
      const access = expose.access ?? Z2M_ACCESS_STATE;
      const dataType = Z2M_TYPE_TO_DATA_TYPE[expose.type] ?? "text";

      // If readable (bit 0 set) → create DeviceData
      if (access & Z2M_ACCESS_STATE) {
        const category = inferCategory(expose.property, allProperties, parentExposeType);
        data.push({
          key: expose.property,
          type: dataType,
          category,
          unit: expose.unit,
        });
      }

      // If writable (bit 1 set) → create DeviceOrder
      if (access & Z2M_ACCESS_SET) {
        orders.push({
          key: expose.property,
          type: dataType,
          payloadKey: expose.property,
          min: expose.value_min,
          max: expose.value_max,
          enumValues: expose.values,
          unit: expose.unit,
        });
      }
    }
  }
}
