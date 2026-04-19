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

  /** Last notified value per mapping — used to detect real changes when previous is unknown */
  private lastValue: Map<string, unknown> = new Map();

  /** Dedup: last processed timestamp per recipe/zone instance — prevents burst duplicates */
  private lastEventTs: Map<string, number> = new Map();

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
    for (const map of this.alarmReminders.values()) {
      for (const entry of map.values()) clearInterval(entry.intervalId);
    }
    this.alarmReminders.clear();
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
          case "notification-publisher.mapping.created":
          case "notification-publisher.mapping.removed":
            this.rebuildIndex();
            break;

          case "notification-publisher.removed":
            this.rebuildIndex();
            // Clear any in-flight alarm reminders tied to this publisher.
            {
              const map = this.alarmReminders.get(event.publisherId);
              if (map) {
                for (const entry of map.values()) clearInterval(entry.intervalId);
                this.alarmReminders.delete(event.publisherId);
              }
            }
            break;

          case "system.alarm.raised":
            this.onAlarmRaised(event.alarmId, event.source, event.message);
            break;

          case "system.alarm.resolved":
            this.onAlarmResolved(event.alarmId, event.source, event.message);
            break;
        }
      } catch (err) {
        this.logger.error({ err }, "Error in notification publish service event handler");
      }
    });
  }

  private handleZoneDataChanged(zoneId: string, aggregatedData: ZoneAggregatedData): void {
    // Dedup: ignore repeated zone events within 1 second (can fire multiple times per pipeline cycle)
    const dedupKey = `zone:${zoneId}`;
    const now = Date.now();
    const last = this.lastEventTs.get(dedupKey);
    if (last && now - last < 1000) return;
    this.lastEventTs.set(dedupKey, now);

    const entries = Object.entries(aggregatedData) as [keyof ZoneAggregatedData, unknown][];
    for (const [field, value] of entries) {
      this.handleSourceChanged("zone", zoneId, field, value, undefined);
    }
  }

  private handleRecipeStateChanged(instanceId: string): void {
    // Dedup: ignore repeated recipe events within 1 second (can fire multiple times per state change)
    const dedupKey = `recipe:${instanceId}`;
    const now = Date.now();
    const last = this.lastEventTs.get(dedupKey);
    if (last && now - last < 1000) {
      this.logger.debug({ instanceId, gap: now - last }, "Recipe event deduped (burst < 1s)");
      return;
    }
    this.lastEventTs.set(dedupKey, now);

    const state = this.recipeManager.getInstanceState(instanceId);
    this.logger.debug(
      { instanceId, stateKeys: Object.keys(state) },
      "Processing recipe state change",
    );
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

      // When previous is unknown (recipe events), fall back to last notified value
      const effectivePrevious =
        previous !== undefined ? previous : this.lastValue.get(ref.mappingId);
      if (!this.shouldNotify(ref, value, effectivePrevious)) continue;

      const text = formatNotificationText(ref.message, value);
      this.sendNotification(ref, text);
      this.lastSent.set(ref.mappingId, Date.now());
      this.lastValue.set(ref.mappingId, value);
      sent++;
    }

    if (sent > 0) {
      this.logger.info(
        { sourceType, sourceId, sourceKey, value, refsCount: refs.length, sent },
        "Notifications dispatched",
      );
    }
  }

  // ── Throttle logic ──────────────────────────────────────────

  private shouldNotify(ref: MappingRef, value: unknown, previous: unknown): boolean {
    // Never notify if value hasn't changed
    if (value === previous) return false;

    // Discrete state transitions (boolean, string enums): notify immediately on change
    if (typeof value === "boolean" || typeof value === "string") {
      return true;
    }

    // Throttle check for numeric/other types (value has changed, but rate-limit)
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

  // ── System alarm notifications ──────────────────────────────

  /** Active alarm reminders, keyed by publisherId → alarmId. */
  private readonly alarmReminders = new Map<
    string,
    Map<string, { text: string; intervalId: ReturnType<typeof setInterval> }>
  >();

  private onAlarmRaised(alarmId: string, source: string, message: string): void {
    const pub = this.getEnabledTelegramPublisher();
    if (!pub) return;
    const text = `⚠️ ${source} : ${message}`;
    this.sendTelegram(pub.channelConfig, text);

    const minutes = pub.alarmReminderMinutes ?? 0;
    if (minutes <= 0) return;

    // Clear any prior reminder for the same alarm before re-arming.
    this.clearAlarmReminder(pub.id, alarmId);
    const intervalMs = minutes * 60_000;
    const intervalId = setInterval(() => {
      this.sendTelegram(pub.channelConfig, `🔁 Rappel — ${text}`);
    }, intervalMs);
    const map = this.alarmReminders.get(pub.id) ?? new Map();
    map.set(alarmId, { text, intervalId });
    this.alarmReminders.set(pub.id, map);
    this.logger.debug({ publisherId: pub.id, alarmId, minutes }, "Alarm reminder scheduled");
  }

  private onAlarmResolved(alarmId: string, source: string, message: string): void {
    // Clear the reminder on every publisher that had one armed for this
    // alarmId (handles the edge case where the active Telegram publisher
    // was swapped while the alarm was active).
    for (const publisherId of this.alarmReminders.keys()) {
      this.clearAlarmReminder(publisherId, alarmId);
    }
    const pub = this.getEnabledTelegramPublisher();
    if (!pub) return;
    this.sendTelegram(pub.channelConfig, `✅ ${source} : ${message}`);
  }

  private clearAlarmReminder(publisherId: string, alarmId: string): void {
    const map = this.alarmReminders.get(publisherId);
    if (!map) return;
    const entry = map.get(alarmId);
    if (!entry) return;
    clearInterval(entry.intervalId);
    map.delete(alarmId);
    if (map.size === 0) this.alarmReminders.delete(publisherId);
  }

  private getEnabledTelegramPublisher() {
    return this.publisherManager
      .getAllWithMappings()
      .find((p) => p.channelType === "telegram" && p.enabled);
  }

  private sendTelegram(config: unknown, text: string): void {
    const channel = this.channels.telegram;
    if (!channel) return;
    channel.send(config as never, text).catch((err) => {
      this.logger.error({ err }, "System alarm notification send failed");
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
