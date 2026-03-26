import type { EventBus } from "../../core/event-bus.js";
import type { Logger } from "../../core/logger.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { ZoneManager } from "../../zones/zone-manager.js";
import type { ZoneAggregator } from "../../zones/zone-aggregator.js";
import type { RecipeSlotDef, RecipeActionDef, RecipeLangPack } from "../../shared/types.js";
import type { RecipeStateStore } from "./recipe-state-store.js";

// ============================================================
// RecipeContext — injected into each recipe instance
// ============================================================

export interface RecipeContext {
  eventBus: EventBus;
  equipmentManager: EquipmentManager;
  zoneManager: ZoneManager;
  zoneAggregator: ZoneAggregator;
  logger: Logger;
  state: RecipeStateStore;
  log: (message: string, level?: "info" | "warn" | "error") => void;
}

// ============================================================
// Recipe — abstract base class for all recipes
// ============================================================

export abstract class Recipe {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly slots: RecipeSlotDef[];
  readonly actions: RecipeActionDef[] = [];
  readonly i18n: Record<string, RecipeLangPack> = {};

  /**
   * Validate params before starting. Throw if invalid.
   */
  abstract validate(params: Record<string, unknown>, ctx: RecipeContext): void;

  /**
   * Start the recipe instance. Subscribe to events, set up timers.
   */
  abstract start(params: Record<string, unknown>, ctx: RecipeContext): void;

  /**
   * Stop the recipe instance. Unsubscribe events, clear timers.
   * Must be idempotent.
   */
  abstract stop(): void;

  /**
   * Handle an action sent from UI or mode impact.
   * Override in subclasses to support recipe-specific actions.
   */
  onAction(_action: string, _payload?: Record<string, unknown>): void {
    // Default: no-op
  }
}
