import { randomUUID } from "node:crypto";
import type { EventBus } from "../core/event-bus.js";
import type { Logger } from "../core/logger.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { ZoneManager } from "../zones/zone-manager.js";
import type { SunlightManager } from "../zones/sunlight-manager.js";
import { ACTIVITY_RETENTION_DAYS, type ActivityStore } from "./activity-store.js";
import type { ActivityItem, ActivityCategory, ActivityMessage } from "../shared/types.js";

interface GetItemsOptions {
  zoneId?: string | null;
  includeDescendants?: boolean;
  limit?: number;
}

const MAX_ITEMS = 2000;
// Spec 147 — keep the live ring aligned with the persisted retention so a
// restart restores the same window it will then maintain (bounded by MAX_ITEMS).
const TTL_MS = ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Ring buffer of activity items fed by the engine event bus (spec 101).
 *
 * - Cap of 2000 items, 7-day TTL purged on every push (matches persistence).
 * - Filters and enriches engine events before storage, then re-emits
 *   `activity.added` on the bus so the WebSocket layer can broadcast.
 * - Spec 147: when an `ActivityStore` is injected, every item is persisted to
 *   SQLite and the recent history is reloaded on boot, so the feed survives a
 *   restart. Without a store it stays in-memory only (pre-147 behaviour).
 */
export class ActivityBuffer {
  private readonly items: ActivityItem[] = [];
  private readonly logger: Logger;
  private prevIsDaylight: boolean | null = null;

  constructor(
    private readonly bus: EventBus,
    private readonly equipmentManager: EquipmentManager,
    private readonly recipeManager: RecipeManager,
    private readonly zoneManager: ZoneManager,
    private readonly sunlightManager: SunlightManager,
    logger: Logger,
    private readonly store?: ActivityStore,
  ) {
    this.logger = logger.child({ module: "activity-buffer" });
    this.prevIsDaylight = this.sunlightManager.getSunlightData().isDaylight;
  }

  start(): void {
    // Spec 147 — seed from persisted history (newest-first, matching the ring)
    // before subscribing, so the feed is populated right after a restart.
    if (this.store && this.items.length === 0) {
      const recent = this.store.loadRecent(MAX_ITEMS);
      this.items.push(...recent);
      if (recent.length > 0) {
        this.logger.info({ count: recent.length }, "Activity feed restored from store");
      }
    }
    this.bus.onType("equipment.order.executed", (e) => this.onOrderExecuted(e));
    this.bus.onType("equipment.data.changed", (e) => this.onDataChanged(e));
    this.bus.onType("recipe.instance.started", (e) => this.onRecipeStarted(e));
    this.bus.onType("recipe.instance.stopped", (e) => this.onRecipeStopped(e));
    this.bus.onType("recipe.instance.error", (e) => this.onRecipeError(e));
    this.bus.onType("mode.activated", (e) => this.onModeActivated(e));
    this.bus.onType("mode.deactivated", (e) => this.onModeDeactivated(e));
    this.bus.onType("sunlight.changed", () => this.onSunlightChanged());
    this.bus.onType("system.alarm.raised", (e) => this.onAlarmRaised(e));
    this.logger.info("Activity buffer started");
  }

  getItems(opts: GetItemsOptions = {}): ActivityItem[] {
    const { zoneId = null, includeDescendants = true, limit = 50 } = opts;

    let allowedZones: Set<string> | null = null;
    if (zoneId !== null) {
      const ids = includeDescendants ? this.zoneManager.getDescendantIds(zoneId) : [zoneId];
      allowedZones = new Set(ids);
    }

    const filtered: ActivityItem[] = [];
    for (const item of this.items) {
      if (item.zoneId === null) {
        filtered.push(item);
      } else if (allowedZones === null || allowedZones.has(item.zoneId)) {
        filtered.push(item);
      }
      if (filtered.length >= limit) break;
    }
    return filtered;
  }

  /** Internal: clear all items (used in tests). */
  clear(): void {
    this.items.length = 0;
  }

  /** Internal: get raw count (used in tests). */
  size(): number {
    return this.items.length;
  }

  // ── push helpers ──────────────────────────────────────

  private push(
    category: ActivityCategory,
    zoneId: string | null,
    message: ActivityMessage,
    extra?: { source?: ActivityItem["source"]; timestamp?: number },
  ): void {
    const item: ActivityItem = {
      id: randomUUID(),
      timestamp: extra?.timestamp ?? Date.now(),
      category,
      zoneId,
      message,
      source: extra?.source,
    };
    this.items.unshift(item);

    // Cap by count
    if (this.items.length > MAX_ITEMS) {
      this.items.length = MAX_ITEMS;
    }
    // Purge by TTL (tail)
    const cutoff = Date.now() - TTL_MS;
    while (this.items.length > 0 && this.items[this.items.length - 1].timestamp < cutoff) {
      this.items.pop();
    }

    // Spec 147 — persist so the feed survives a restart (never throws).
    this.store?.insert(item);

    this.bus.emit({ type: "activity.added", item });
  }

  // ── handlers ──────────────────────────────────────

  private onOrderExecuted(event: {
    equipmentId: string;
    orderAlias: string;
    value: unknown;
    source?: ActivityItem["source"];
  }): void {
    const equipment = this.equipmentManager.getById(event.equipmentId);
    if (!equipment) return;
    this.push(
      "order",
      equipment.zoneId ?? null,
      {
        template: "order.executed",
        params: {
          equipmentName: equipment.name,
          alias: event.orderAlias,
          value: formatValue(event.value),
        },
      },
      { source: event.source },
    );
  }

  private onDataChanged(event: { equipmentId: string; alias: string; value: unknown }): void {
    // Filter by binding category (stable, integration-set) rather than alias (user-set).
    const equipment = this.equipmentManager.getById(event.equipmentId);
    if (!equipment) return;
    const bindings = this.equipmentManager.getDataBindingsWithValues(event.equipmentId);
    const binding = bindings.find((b) => b.alias === event.alias);
    if (!binding) return;

    const category = binding.category;
    if (category !== "motion" && category !== "water_leak" && category !== "smoke") return;

    // Only the rising edge — value === true (or string "true"/"ON"/"1")
    if (!isRisingEdge(event.value)) return;

    if (category === "motion") {
      this.push("motion", equipment.zoneId ?? null, {
        template: "motion.detected",
        params: { equipmentName: equipment.name },
      });
      return;
    }

    // water_leak or smoke → alarm category, scoped to the equipment's zone
    this.push("alarm", equipment.zoneId ?? null, {
      template: "alarm.raised",
      params: {
        source: equipment.name,
        message: category === "water_leak" ? "Fuite d'eau détectée" : "Fumée détectée",
      },
    });
  }

  private onRecipeStarted(event: { instanceId: string }): void {
    const meta = this.recipeManager.getInstanceMeta(event.instanceId);
    if (!meta) return;
    this.push("recipe", meta.zoneId, {
      template: "recipe.started",
      params: { recipeName: meta.recipeName },
    });
  }

  private onRecipeStopped(event: { instanceId: string }): void {
    const meta = this.recipeManager.getInstanceMeta(event.instanceId);
    if (!meta) return;
    this.push("recipe", meta.zoneId, {
      template: "recipe.stopped",
      params: { recipeName: meta.recipeName },
    });
  }

  private onRecipeError(event: { instanceId: string; error: string }): void {
    const meta = this.recipeManager.getInstanceMeta(event.instanceId);
    if (!meta) return;
    this.push("alarm", meta.zoneId, {
      template: "recipe.error",
      params: { recipeName: meta.recipeName, error: event.error },
    });
  }

  private onModeActivated(event: { modeName: string }): void {
    this.push("mode", null, {
      template: "mode.activated",
      params: { modeName: event.modeName },
    });
  }

  private onModeDeactivated(event: { modeName: string }): void {
    this.push("mode", null, {
      template: "mode.deactivated",
      params: { modeName: event.modeName },
    });
  }

  private onSunlightChanged(): void {
    const current = this.sunlightManager.getSunlightData().isDaylight;
    if (current === null || current === this.prevIsDaylight) {
      this.prevIsDaylight = current;
      return;
    }
    const template: "sunlight.sunrise" | "sunlight.sunset" = current
      ? "sunlight.sunrise"
      : "sunlight.sunset";
    this.prevIsDaylight = current;
    this.push("sunlight", null, { template, params: {} });
  }

  private onAlarmRaised(event: { source: string; message: string; zoneId?: string | null }): void {
    // A zone-scoped alarm (a battery alert bound to an equipment, spec 143/#472)
    // lands in that zone; an alarm with no zone (integrations, unbound device)
    // stays global and shows in every zone, as before.
    this.push("alarm", event.zoneId ?? null, {
      template: "alarm.raised",
      params: { source: event.source, message: event.message },
    });
  }
}

function isRisingEdge(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const v = value.trim();
    if (v === "1") return true;
    const upper = v.toUpperCase();
    if (upper === "ON" || upper === "TRUE" || upper === "DETECTED" || upper === "OCCUPIED") {
      return true;
    }
  }
  return false;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
