import mqtt, { type MqttClient } from "mqtt";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { MqttPublisherManager } from "./mqtt-publisher-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { ZoneAggregator } from "../zones/zone-aggregator.js";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { ZoneAggregatedData } from "../shared/types.js";

// ============================================================
// Internal types
// ============================================================

interface MappingRef {
  publisherTopic: string;
  publishKey: string;
  enabled: boolean;
}

// ============================================================
// Value conversion — booleans and binary states → 0/1
// ============================================================

const TRUTHY = new Set<unknown>([true, "ON", "open"]);
const FALSY = new Set<unknown>([false, "OFF", "closed"]);

function toMqttValue(value: unknown): unknown {
  if (TRUTHY.has(value)) return 1;
  if (FALSY.has(value)) return 0;
  return value;
}

// ============================================================
// MqttPublishService
// ============================================================

export class MqttPublishService {
  private readonly logger: Logger;
  private client: MqttClient | null = null;
  private unsubscribe: (() => void) | null = null;

  /**
   * In-memory lookup index:
   * key = "equipment:{sourceId}:{sourceKey}" or "zone:{sourceId}:{sourceKey}" or "recipe:{instanceId}:{stateKey}"
   * value = array of mapping refs to publish to
   */
  private index: Map<string, MappingRef[]> = new Map();

  constructor(
    private readonly eventBus: EventBus,
    private readonly settingsManager: SettingsManager,
    private readonly publisherManager: MqttPublisherManager,
    private readonly equipmentManager: EquipmentManager,
    private readonly zoneAggregator: ZoneAggregator,
    private readonly recipeManager: RecipeManager,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "mqtt-publish-service" });
  }

  // ── Lifecycle ────────────────────────────────────────────────

  init(): void {
    this.tryConnect();
    this.rebuildIndex();
    this.subscribeToEvents();
    this.publishInitialSnapshot();
    this.logger.info({ mappings: this.index.size }, "MQTT publish service initialized");
  }

  async destroy(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.client) {
      try {
        await this.client.endAsync();
      } catch {
        // Ignore disconnect errors during shutdown
      }
      this.client = null;
    }
  }

  // ── MQTT connection ──────────────────────────────────────────

  private tryConnect(): void {
    // Read publisher-specific MQTT settings, fallback to Z2M settings
    const brokerUrl =
      this.settingsManager.get("mqtt-publisher.brokerUrl") ||
      this.settingsManager.get("integration.zigbee2mqtt.mqtt_url");

    if (!brokerUrl) {
      this.logger.warn(
        "No MQTT broker configured for publisher (set mqtt-publisher.brokerUrl or configure Zigbee2MQTT)",
      );
      return;
    }

    const username =
      this.settingsManager.get("mqtt-publisher.username") ||
      this.settingsManager.get("integration.zigbee2mqtt.mqtt_username") ||
      undefined;
    const password =
      this.settingsManager.get("mqtt-publisher.password") ||
      this.settingsManager.get("integration.zigbee2mqtt.mqtt_password") ||
      undefined;

    // Disconnect existing client if any
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }

    this.client = mqtt.connect(brokerUrl, {
      clientId: "winch-publisher",
      username,
      password,
      clean: true,
      reconnectPeriod: 5000,
    });

    this.client.on("connect", () => {
      this.logger.info({ brokerUrl }, "MQTT publish service connected");
      // Re-publish snapshot on reconnect so retained values are up-to-date
      this.publishInitialSnapshot();
    });

    this.client.on("reconnect", () => {
      this.logger.warn("MQTT publish service reconnecting...");
    });

    this.client.on("error", (err) => {
      this.logger.error({ err }, "MQTT publish service error");
    });
  }

  private async tryReconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.endAsync(true);
      } catch {
        // Ignore
      }
      this.client = null;
    }
    this.tryConnect();
  }

  // ── Index management ─────────────────────────────────────────

  private rebuildIndex(): void {
    this.index.clear();

    const publishers = this.publisherManager.getAllWithMappings();
    for (const pub of publishers) {
      for (const mapping of pub.mappings) {
        const key = `${mapping.sourceType}:${mapping.sourceId}:${mapping.sourceKey}`;
        const refs = this.index.get(key) ?? [];
        refs.push({
          publisherTopic: pub.topic,
          publishKey: mapping.publishKey,
          enabled: pub.enabled,
        });
        this.index.set(key, refs);
      }
    }

    this.logger.debug({ indexKeys: this.index.size }, "Publisher index rebuilt");
  }

  // ── Event handling ───────────────────────────────────────────

  private subscribeToEvents(): void {
    this.unsubscribe = this.eventBus.on((event) => {
      try {
        switch (event.type) {
          case "equipment.data.changed":
            this.handleEquipmentDataChanged(event.equipmentId, event.alias, event.value);
            break;

          case "zone.data.changed":
            this.handleZoneDataChanged(event.zoneId, event.aggregatedData);
            break;

          case "recipe.instance.state.changed":
            this.handleRecipeStateChanged(event.instanceId);
            break;

          case "mqtt-publisher.created":
          case "mqtt-publisher.updated":
          case "mqtt-publisher.removed":
          case "mqtt-publisher.mapping.created":
          case "mqtt-publisher.mapping.removed":
            this.rebuildIndex();
            break;

          case "settings.changed":
            if (event.keys.some((k) => k.startsWith("mqtt-publisher."))) {
              this.tryReconnect();
            }
            break;
        }
      } catch (err) {
        this.logger.error({ err }, "Error in MQTT publish service event handler");
      }
    });
  }

  private handleEquipmentDataChanged(equipmentId: string, alias: string, value: unknown): void {
    const key = `equipment:${equipmentId}:${alias}`;
    const refs = this.index.get(key);
    if (!refs) return;

    for (const ref of refs) {
      if (!ref.enabled) continue;
      this.publish(ref.publisherTopic, ref.publishKey, value);
    }
  }

  private handleZoneDataChanged(zoneId: string, aggregatedData: ZoneAggregatedData): void {
    const entries = Object.entries(aggregatedData) as [keyof ZoneAggregatedData, unknown][];
    for (const [field, value] of entries) {
      const key = `zone:${zoneId}:${field}`;
      const refs = this.index.get(key);
      if (!refs) continue;

      for (const ref of refs) {
        if (!ref.enabled) continue;
        this.publish(ref.publisherTopic, ref.publishKey, value);
      }
    }
  }

  private handleRecipeStateChanged(instanceId: string): void {
    const state = this.recipeManager.getInstanceState(instanceId);
    for (const [stateKey, value] of Object.entries(state)) {
      const key = `recipe:${instanceId}:${stateKey}`;
      const refs = this.index.get(key);
      if (!refs) continue;

      for (const ref of refs) {
        if (!ref.enabled) continue;
        this.publish(ref.publisherTopic, ref.publishKey, value);
      }
    }
  }

  // ── Publishing ───────────────────────────────────────────────

  private publish(topic: string, publishKey: string, value: unknown): void {
    if (!this.client?.connected) return;

    const mqttValue = toMqttValue(value);
    const payload = JSON.stringify({ [publishKey]: mqttValue });
    this.client.publish(topic, payload, { retain: true }, (err) => {
      if (err) {
        this.logger.error({ err, topic, publishKey }, "MQTT publish error");
      }
    });

    this.logger.trace({ topic, publishKey, value }, "MQTT published");
  }

  // ── Initial snapshot ─────────────────────────────────────────

  private publishInitialSnapshot(): void {
    if (!this.client?.connected) return;

    const publishers = this.publisherManager.getAllWithMappings();
    let published = 0;

    for (const pub of publishers) {
      if (!pub.enabled) continue;

      for (const mapping of pub.mappings) {
        const value = this.resolveCurrentValue(
          mapping.sourceType,
          mapping.sourceId,
          mapping.sourceKey,
        );
        if (value !== undefined) {
          this.publish(pub.topic, mapping.publishKey, value);
          published++;
        }
      }
    }

    if (published > 0) {
      this.logger.debug({ published }, "Initial snapshot published");
    }
  }

  // ── Test publish ────────────────────────────────────────────

  publishSnapshotForPublisher(publisherId: string): number {
    if (!this.client?.connected) return 0;

    const publisher = this.publisherManager.getByIdWithMappings(publisherId);
    if (!publisher) return 0;

    let published = 0;
    for (const mapping of publisher.mappings) {
      const value = this.resolveCurrentValue(
        mapping.sourceType,
        mapping.sourceId,
        mapping.sourceKey,
      );
      if (value !== undefined) {
        this.publish(publisher.topic, mapping.publishKey, value);
        published++;
      }
    }

    this.logger.info({ publisherId, published }, "Test publish triggered");
    return published;
  }

  private resolveCurrentValue(
    sourceType: "equipment" | "zone" | "recipe",
    sourceId: string,
    sourceKey: string,
  ): unknown {
    if (sourceType === "equipment") {
      const bindings = this.equipmentManager.getDataBindingsWithValues(sourceId);
      const binding = bindings.find((b) => b.alias === sourceKey);
      return binding?.value;
    }

    if (sourceType === "zone") {
      const allAggregated = this.zoneAggregator.getAll();
      const zoneData = allAggregated[sourceId];
      if (!zoneData) return undefined;
      return zoneData[sourceKey as keyof ZoneAggregatedData];
    }

    if (sourceType === "recipe") {
      const state = this.recipeManager.getInstanceState(sourceId);
      return state[sourceKey];
    }

    return undefined;
  }
}
