import mqtt, { type MqttClient } from "mqtt";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { MqttBrokerManager } from "./mqtt-broker-manager.js";
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
  brokerId: string | null;
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
  private readonly clients: Map<string, MqttClient> = new Map();
  private unsubscribe: (() => void) | null = null;

  /**
   * In-memory lookup index:
   * key = "equipment:{sourceId}:{sourceKey}" or "zone:{sourceId}:{sourceKey}" or "recipe:{instanceId}:{stateKey}"
   * value = array of mapping refs to publish to
   */
  private index: Map<string, MappingRef[]> = new Map();

  constructor(
    private readonly eventBus: EventBus,
    private readonly brokerManager: MqttBrokerManager,
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
    this.connectAllBrokers();
    this.rebuildIndex();
    this.subscribeToEvents();
    this.publishInitialSnapshot();
    this.logger.info({ mappings: this.index.size }, "MQTT publish service initialized");
  }

  async destroy(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const disconnects = [...this.clients.entries()].map(async ([brokerId, client]) => {
      try {
        await client.endAsync();
      } catch {
        // Ignore disconnect errors during shutdown
      }
      this.clients.delete(brokerId);
    });
    await Promise.all(disconnects);
  }

  // ── Broker connection pool ─────────────────────────────────

  private connectAllBrokers(): void {
    const brokers = this.brokerManager.getAll();
    for (const broker of brokers) {
      this.connectBroker(broker.id);
    }
  }

  private connectBroker(brokerId: string): void {
    const broker = this.brokerManager.getById(brokerId);
    if (!broker) return;

    // Disconnect existing client for this broker if any
    this.disconnectBroker(brokerId);

    const client = mqtt.connect(broker.url, {
      clientId: `sowel-publisher-${brokerId.slice(0, 8)}`,
      username: broker.username,
      password: broker.password,
      clean: true,
      reconnectPeriod: 5000,
    });

    let firstConnect = true;
    client.on("connect", () => {
      this.logger.info({ brokerId, brokerUrl: broker.url }, "MQTT publish broker connected");
      // Only publish snapshot on first connect, not on every reconnect
      if (firstConnect) {
        this.publishInitialSnapshotForBroker(brokerId);
        firstConnect = false;
      }
    });

    client.on("reconnect", () => {
      this.logger.warn({ brokerId }, "MQTT publish broker reconnecting...");
    });

    client.on("error", (err) => {
      this.logger.error({ err, brokerId }, "MQTT publish broker error");
    });

    this.clients.set(brokerId, client);
  }

  private disconnectBroker(brokerId: string): void {
    const existing = this.clients.get(brokerId);
    if (existing) {
      existing.end(true);
      this.clients.delete(brokerId);
    }
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
          brokerId: pub.brokerId,
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
            this.publishInitialSnapshot();
            break;

          case "mqtt-broker.created":
            this.connectBroker(event.broker.id);
            break;

          case "mqtt-broker.updated":
            this.connectBroker(event.broker.id);
            break;

          case "mqtt-broker.removed":
            this.disconnectBroker(event.brokerId);
            this.rebuildIndex();
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

    let published = 0;
    for (const ref of refs) {
      if (!ref.enabled || !ref.brokerId) continue;
      this.publish(ref.brokerId, ref.publisherTopic, ref.publishKey, value);
      published++;
    }
    if (published > 0) {
      this.logger.debug({ equipmentId, alias, published }, "MQTT published equipment data");
    }
  }

  private handleZoneDataChanged(zoneId: string, aggregatedData: ZoneAggregatedData): void {
    const entries = Object.entries(aggregatedData) as [keyof ZoneAggregatedData, unknown][];
    let published = 0;
    for (const [field, value] of entries) {
      const key = `zone:${zoneId}:${field}`;
      const refs = this.index.get(key);
      if (!refs) continue;

      for (const ref of refs) {
        if (!ref.enabled || !ref.brokerId) continue;
        this.publish(ref.brokerId, ref.publisherTopic, ref.publishKey, value);
        published++;
      }
    }
    if (published > 0) {
      this.logger.debug({ zoneId, published }, "MQTT published zone data");
    }
  }

  private handleRecipeStateChanged(instanceId: string): void {
    const state = this.recipeManager.getInstanceState(instanceId);
    let published = 0;
    for (const [stateKey, value] of Object.entries(state)) {
      const key = `recipe:${instanceId}:${stateKey}`;
      const refs = this.index.get(key);
      if (!refs) continue;

      for (const ref of refs) {
        if (!ref.enabled || !ref.brokerId) continue;
        this.publish(ref.brokerId, ref.publisherTopic, ref.publishKey, value);
        published++;
      }
    }
    if (published > 0) {
      this.logger.debug({ instanceId, published }, "MQTT published recipe state");
    }
  }

  // ── Publishing ───────────────────────────────────────────────

  private publish(brokerId: string, topic: string, publishKey: string, value: unknown): void {
    const client = this.clients.get(brokerId);
    if (!client?.connected) return;

    const mqttValue = toMqttValue(value);
    const payload = JSON.stringify({ [publishKey]: mqttValue });
    client.publish(topic, payload, { retain: true }, (err) => {
      if (err) {
        const broker = this.brokerManager.getById(brokerId);
        this.logger.error(
          { err, brokerId, brokerName: broker?.name, topic, publishKey },
          "MQTT publish error",
        );
      }
    });

    this.logger.trace({ brokerId, topic, publishKey, value }, "MQTT published");
  }

  // ── Initial snapshot ─────────────────────────────────────────

  private publishInitialSnapshot(): void {
    const publishers = this.publisherManager.getAllWithMappings();
    let published = 0;

    for (const pub of publishers) {
      if (!pub.enabled || !pub.brokerId) continue;
      const client = this.clients.get(pub.brokerId);
      if (!client?.connected) continue;

      for (const mapping of pub.mappings) {
        const value = this.resolveCurrentValue(
          mapping.sourceType,
          mapping.sourceId,
          mapping.sourceKey,
        );
        if (value !== undefined) {
          this.publish(pub.brokerId, pub.topic, mapping.publishKey, value);
          published++;
        }
      }
    }

    if (published > 0) {
      this.logger.debug({ published }, "Initial snapshot published");
    }
  }

  private publishInitialSnapshotForBroker(brokerId: string): void {
    const publishers = this.publisherManager.getAllWithMappings();
    let published = 0;

    for (const pub of publishers) {
      if (!pub.enabled || pub.brokerId !== brokerId) continue;

      for (const mapping of pub.mappings) {
        const value = this.resolveCurrentValue(
          mapping.sourceType,
          mapping.sourceId,
          mapping.sourceKey,
        );
        if (value !== undefined) {
          this.publish(brokerId, pub.topic, mapping.publishKey, value);
          published++;
        }
      }
    }

    if (published > 0) {
      this.logger.debug({ brokerId, published }, "Broker snapshot published on connect");
    }
  }

  // ── Test publish ────────────────────────────────────────────

  publishSnapshotForPublisher(publisherId: string): number {
    const publisher = this.publisherManager.getByIdWithMappings(publisherId);
    if (!publisher || !publisher.brokerId) return 0;

    const client = this.clients.get(publisher.brokerId);
    if (!client?.connected) return 0;

    let published = 0;
    for (const mapping of publisher.mappings) {
      const value = this.resolveCurrentValue(
        mapping.sourceType,
        mapping.sourceId,
        mapping.sourceKey,
      );
      if (value !== undefined) {
        this.publish(publisher.brokerId, publisher.topic, mapping.publishKey, value);
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
