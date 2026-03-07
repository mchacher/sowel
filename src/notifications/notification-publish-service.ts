import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { NotificationPublisherManager } from "./notification-publisher-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { ZoneAggregator } from "../zones/zone-aggregator.js";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { ZoneAggregatedData } from "../shared/types.js";
import type { NotificationChannel } from "./channels/channel.js";
import { TelegramChannel } from "./channels/telegram.js";

// ============================================================
// Internal types
// ============================================================

interface MappingRef {
  mappingId: string;
  publisherId: string;
  message: string;
  channelType: "telegram";
  channelConfig: unknown;
  enabled: boolean;
  throttleMs: number;
}

// ============================================================
// NotificationPublishService
// ============================================================

export class NotificationPublishService {
  private readonly logger: Logger;
  private unsubscribe: (() => void) | null = null;

  /** In-memory lookup index: sourceKey → array of mapping refs */
  private index: Map<string, MappingRef[]> = new Map();

  /** Throttle state: mappingId → last sent timestamp */
  private lastSent: Map<string, number> = new Map();

  /** Channel providers by type */
  private readonly channels: Record<string, NotificationChannel> = {
    telegram: new TelegramChannel(),
  };

  constructor(
    private readonly eventBus: EventBus,
    private readonly publisherManager: NotificationPublisherManager,
    private readonly equipmentManager: EquipmentManager,
    private readonly zoneAggregator: ZoneAggregator,
    private readonly recipeManager: RecipeManager,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "notification-publish-service" });
  }

  // ── Lifecycle ────────────────────────────────────────────────

  init(): void {
    this.rebuildIndex();
    this.subscribeToEvents();
    this.logger.info({ mappings: this.index.size }, "Notification publish service initialized");
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
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
          mappingId: mapping.id,
          publisherId: pub.id,
          message: mapping.message,
          channelType: pub.channelType,
          channelConfig: pub.channelConfig,
          enabled: pub.enabled,
          throttleMs: mapping.throttleMs,
        });
        this.index.set(key, refs);
      }
    }

    this.logger.debug({ indexKeys: this.index.size }, "Notification publisher index rebuilt");
  }

  // ── Event handling ───────────────────────────────────────────

  private subscribeToEvents(): void {
    this.unsubscribe = this.eventBus.on((event) => {
      try {
        switch (event.type) {
          case "equipment.data.changed":
            this.handleSourceChanged(
              "equipment",
              event.equipmentId,
              event.alias,
              event.value,
              event.previous,
            );
            break;

          case "zone.data.changed":
            this.handleZoneDataChanged(event.zoneId, event.aggregatedData);
            break;

          case "recipe.instance.state.changed":
            this.handleRecipeStateChanged(event.instanceId);
            break;

          case "notification-publisher.created":
          case "notification-publisher.updated":
          case "notification-publisher.removed":
          case "notification-publisher.mapping.created":
          case "notification-publisher.mapping.removed":
            this.rebuildIndex();
            break;
        }
      } catch (err) {
        this.logger.error({ err }, "Error in notification publish service event handler");
      }
    });
  }

  private handleZoneDataChanged(zoneId: string, aggregatedData: ZoneAggregatedData): void {
    const entries = Object.entries(aggregatedData) as [keyof ZoneAggregatedData, unknown][];
    for (const [field, value] of entries) {
      this.handleSourceChanged("zone", zoneId, field, value, undefined);
    }
  }

  private handleRecipeStateChanged(instanceId: string): void {
    const state = this.recipeManager.getInstanceState(instanceId);
    for (const [stateKey, value] of Object.entries(state)) {
      this.handleSourceChanged("recipe", instanceId, stateKey, value, undefined);
    }
  }

  private handleSourceChanged(
    sourceType: "equipment" | "zone" | "recipe",
    sourceId: string,
    sourceKey: string,
    value: unknown,
    previous: unknown,
  ): void {
    if (value === null || value === undefined) return;

    const key = `${sourceType}:${sourceId}:${sourceKey}`;
    const refs = this.index.get(key);
    if (!refs) return;

    let sent = 0;
    for (const ref of refs) {
      if (!ref.enabled) continue;
      if (!this.shouldNotify(ref, value, previous)) continue;

      const text = formatNotificationText(ref.message, value);
      this.sendNotification(ref, text);
      this.lastSent.set(ref.mappingId, Date.now());
      sent++;
    }

    if (sent > 0) {
      this.logger.debug({ sourceType, sourceId, sourceKey, sent }, "Notifications dispatched");
    }
  }

  // ── Throttle logic ──────────────────────────────────────────

  private shouldNotify(ref: MappingRef, value: unknown, previous: unknown): boolean {
    // Boolean/enum state transitions: always notify immediately
    if (
      typeof value === "boolean" ||
      value === "ON" ||
      value === "OFF" ||
      value === "open" ||
      value === "closed"
    ) {
      return value !== previous;
    }

    // Throttle check for other types
    const last = this.lastSent.get(ref.mappingId);
    if (!last) return true;

    const elapsed = Date.now() - last;
    return elapsed >= ref.throttleMs;
  }

  // ── Send notification ───────────────────────────────────────

  private sendNotification(ref: MappingRef, text: string): void {
    const channel = this.channels[ref.channelType];
    if (!channel) {
      this.logger.warn({ channelType: ref.channelType }, "Unknown notification channel type");
      return;
    }

    channel.send(ref.channelConfig, text).catch((err) => {
      this.logger.error(
        { err, publisherId: ref.publisherId, channelType: ref.channelType },
        "Notification send failed",
      );
    });
  }

  // ── Test publish ─────────────────────────────────────────────

  async testChannel(publisherId: string): Promise<void> {
    const publisher = this.publisherManager.getById(publisherId);
    if (!publisher) throw new Error("Publisher not found");

    const channel = this.channels[publisher.channelType];
    if (!channel) throw new Error(`Unknown channel type: ${publisher.channelType}`);

    await channel.testConnection(publisher.channelConfig);
    this.logger.info({ publisherId }, "Notification channel test sent");
  }

  async testPublisher(publisherId: string): Promise<number> {
    const publisher = this.publisherManager.getByIdWithMappings(publisherId);
    if (!publisher) throw new Error("Publisher not found");

    const channel = this.channels[publisher.channelType];
    if (!channel) throw new Error(`Unknown channel type: ${publisher.channelType}`);

    let sent = 0;
    for (const mapping of publisher.mappings) {
      const value = this.resolveCurrentValue(
        mapping.sourceType,
        mapping.sourceId,
        mapping.sourceKey,
      );
      if (value === undefined) continue;

      const text = formatNotificationText(mapping.message, value);
      await channel.send(publisher.channelConfig, text);
      sent++;
    }

    this.logger.info({ publisherId, sent }, "Notification test publish completed");
    return sent;
  }

  // ── Resolve current value ──────────────────────────────────

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

// ============================================================
// Helper: format values for human-readable display
// ============================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function formatNotificationText(message: string, value: unknown): string {
  // Booleans: just send the message, no value suffix
  if (typeof value === "boolean") return message;
  // null: just send the message
  if (value === null) return message;
  return `${message} : ${formatDisplayValue(value)}`;
}

function formatDisplayValue(value: unknown): string {
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
    }
  }
  return String(value);
}
