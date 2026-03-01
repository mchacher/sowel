import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { ZoneAggregator } from "../../zones/zone-aggregator.js";
import type { ZoneManager } from "../../zones/zone-manager.js";
import type { RecipeInfo, RecipeInstance, RecipeLogEntry } from "../../shared/types.js";
import type { Recipe, RecipeContext } from "./recipe.js";
import { toISOUtc } from "../../core/database.js";
import { RecipeStateStore } from "./recipe-state-store.js";

// ============================================================
// Types
// ============================================================

export type RecipeConstructor = new () => Recipe;

interface RegisteredRecipe {
  info: RecipeInfo;
  create: () => Recipe;
}

interface RunningInstance {
  recipe: Recipe;
  instance: RecipeInstance;
}

// ============================================================
// RecipeManager — registry, lifecycle, DB persistence
// ============================================================

export class RecipeManager {
  private registry = new Map<string, RegisteredRecipe>();
  private running = new Map<string, RunningInstance>();
  private db: Database.Database;
  private eventBus: EventBus;
  private equipmentManager: EquipmentManager;
  private zoneManager: ZoneManager;
  private zoneAggregator: ZoneAggregator;
  private logger: Logger;
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(
    db: Database.Database,
    eventBus: EventBus,
    equipmentManager: EquipmentManager,
    zoneManager: ZoneManager,
    zoneAggregator: ZoneAggregator,
    logger: Logger,
  ) {
    this.db = db;
    this.eventBus = eventBus;
    this.equipmentManager = equipmentManager;
    this.zoneManager = zoneManager;
    this.zoneAggregator = zoneAggregator;
    this.logger = logger.child({ module: "recipe-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insertInstance: this.db.prepare(
        `INSERT INTO recipe_instances (id, recipe_id, params, enabled)
         VALUES (@id, @recipeId, @params, @enabled)`,
      ),
      getAllInstances: this.db.prepare("SELECT * FROM recipe_instances ORDER BY created_at"),
      getInstanceById: this.db.prepare("SELECT * FROM recipe_instances WHERE id = ?"),
      deleteInstance: this.db.prepare("DELETE FROM recipe_instances WHERE id = ?"),
      insertLog: this.db.prepare(
        `INSERT INTO recipe_log (instance_id, message, level)
         VALUES (?, ?, ?)`,
      ),
      getLog: this.db.prepare(
        `SELECT * FROM recipe_log WHERE instance_id = ?
         ORDER BY timestamp DESC LIMIT ?`,
      ),
      updateInstanceParams: this.db.prepare("UPDATE recipe_instances SET params = ? WHERE id = ?"),
      setInstanceEnabled: this.db.prepare("UPDATE recipe_instances SET enabled = ? WHERE id = ?"),
      getState: this.db.prepare("SELECT key, value FROM recipe_state WHERE instance_id = ?"),
    };
  }

  // ============================================================
  // Registration
  // ============================================================

  register(RecipeClass: RecipeConstructor): void {
    const sample = new RecipeClass();
    this.registry.set(sample.id, {
      info: {
        id: sample.id,
        name: sample.name,
        description: sample.description,
        slots: sample.slots,
        ...(sample.actions.length > 0 ? { actions: sample.actions } : {}),
        ...(Object.keys(sample.i18n).length > 0 ? { i18n: sample.i18n } : {}),
      },
      create: () => new RecipeClass(),
    });
    this.logger.info({ recipeId: sample.id }, "Recipe registered");
  }

  // ============================================================
  // Init — restore instances from DB
  // ============================================================

  init(): void {
    const rows = this.stmts.getAllInstances.all() as InstanceRow[];
    let restored = 0;

    for (const row of rows) {
      if (row.enabled !== 1) continue;

      const registered = this.registry.get(row.recipe_id);
      if (!registered) {
        this.logger.warn(
          { instanceId: row.id, recipeId: row.recipe_id },
          "Recipe not found for instance, skipping",
        );
        continue;
      }

      const instance = rowToInstance(row);
      try {
        const recipe = registered.create();
        this.startInstance(recipe, instance);
        restored++;
      } catch (err) {
        this.logger.error({ err, instanceId: row.id }, "Failed to restore recipe instance");
        this.writeLog(
          row.id,
          `Failed to restore: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    }

    this.logger.info({ restored, total: rows.length }, "Recipe instances restored");
  }

  // ============================================================
  // Public API
  // ============================================================

  getRecipes(): RecipeInfo[] {
    return Array.from(this.registry.values()).map((r) => r.info);
  }

  getRecipeById(recipeId: string): RecipeInfo | null {
    return this.registry.get(recipeId)?.info ?? null;
  }

  getInstances(): (RecipeInstance & { state: Record<string, unknown> })[] {
    const rows = this.stmts.getAllInstances.all() as InstanceRow[];
    return rows.map((row) => ({
      ...rowToInstance(row),
      state: this.getInstanceState(row.id),
    }));
  }

  getInstanceState(instanceId: string): Record<string, unknown> {
    const rows = this.stmts.getState.all(instanceId) as { key: string; value: string | null }[];
    const state: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        state[row.key] = row.value !== null ? JSON.parse(row.value) : null;
      } catch {
        state[row.key] = row.value;
      }
    }
    return state;
  }

  createInstance(recipeId: string, params: Record<string, unknown>): RecipeInstance {
    const registered = this.registry.get(recipeId);
    if (!registered) {
      throw new RecipeError(`Recipe not found: ${recipeId}`, 404);
    }

    // Create a recipe instance for validation
    const recipe = registered.create();
    const tempCtx = this.buildContext("temp", recipeId);

    try {
      recipe.validate(params, tempCtx);
    } catch (err) {
      throw new RecipeError(
        `Invalid params: ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }

    const id = randomUUID();
    this.stmts.insertInstance.run({
      id,
      recipeId,
      params: JSON.stringify(params),
      enabled: 1,
    });

    const row = this.stmts.getInstanceById.get(id) as InstanceRow;
    const instance = rowToInstance(row);

    this.eventBus.emit({ type: "recipe.instance.created", instanceId: id, recipeId });
    this.writeLog(id, "Instance created");

    // Start with a fresh recipe instance
    try {
      const runRecipe = registered.create();
      this.startInstance(runRecipe, instance);
    } catch (err) {
      this.logger.error({ err, instanceId: id }, "Failed to start recipe instance");
      this.writeLog(
        id,
        `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
      this.eventBus.emit({
        type: "recipe.instance.error",
        instanceId: id,
        recipeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return instance;
  }

  deleteInstance(instanceId: string): void {
    const row = this.stmts.getInstanceById.get(instanceId) as InstanceRow | undefined;
    if (!row) {
      throw new RecipeError("Instance not found", 404);
    }

    // Stop if running
    this.stopInstance(instanceId);

    // Delete from DB (cascades to recipe_state and recipe_log)
    this.stmts.deleteInstance.run(instanceId);

    this.logger.info({ instanceId, recipeId: row.recipe_id }, "Recipe instance deleted");
    this.eventBus.emit({ type: "recipe.instance.removed", instanceId, recipeId: row.recipe_id });
  }

  updateInstance(instanceId: string, params: Record<string, unknown>): RecipeInstance {
    const row = this.stmts.getInstanceById.get(instanceId) as InstanceRow | undefined;
    if (!row) {
      throw new RecipeError("Instance not found", 404);
    }

    const registered = this.registry.get(row.recipe_id);
    if (!registered) {
      throw new RecipeError(`Recipe not found: ${row.recipe_id}`, 404);
    }

    // Validate new params
    const recipe = registered.create();
    const tempCtx = this.buildContext("temp", row.recipe_id);
    try {
      recipe.validate(params, tempCtx);
    } catch (err) {
      throw new RecipeError(
        `Invalid params: ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }

    // Stop running instance
    this.stopInstance(instanceId);

    // Update params in DB
    this.stmts.updateInstanceParams.run(JSON.stringify(params), instanceId);

    // Reload and restart only if enabled
    const updatedRow = this.stmts.getInstanceById.get(instanceId) as InstanceRow;
    const instance = rowToInstance(updatedRow);

    if (updatedRow.enabled === 1) {
      try {
        const runRecipe = registered.create();
        this.startInstance(runRecipe, instance);
      } catch (err) {
        this.logger.error({ err, instanceId }, "Failed to restart recipe instance after update");
        this.writeLog(
          instanceId,
          `Failed to restart: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    }

    this.logger.info({ instanceId, recipeId: row.recipe_id }, "Recipe instance updated");
    return instance;
  }

  enableInstance(instanceId: string): void {
    const row = this.stmts.getInstanceById.get(instanceId) as InstanceRow | undefined;
    if (!row) throw new RecipeError("Instance not found", 404);
    if (row.enabled === 1) return;

    this.stmts.setInstanceEnabled.run(1, instanceId);
    const instance = rowToInstance({ ...row, enabled: 1 });

    const registered = this.registry.get(row.recipe_id);
    if (registered) {
      try {
        const recipe = registered.create();
        this.startInstance(recipe, instance);
      } catch (err) {
        this.logger.error({ err, instanceId }, "Failed to start recipe after enable");
      }
    }

    this.logger.info({ instanceId, recipeId: row.recipe_id }, "Recipe instance enabled");
    this.eventBus.emit({ type: "recipe.instance.started", instanceId, recipeId: row.recipe_id });
  }

  disableInstance(instanceId: string): void {
    const row = this.stmts.getInstanceById.get(instanceId) as InstanceRow | undefined;
    if (!row) throw new RecipeError("Instance not found", 404);

    // Always stop in-memory runner even if DB says disabled — prevents orphaned runners
    this.stopInstance(instanceId);

    if (row.enabled === 0) return;

    this.stmts.setInstanceEnabled.run(0, instanceId);

    this.logger.info({ instanceId, recipeId: row.recipe_id }, "Recipe instance disabled");
    this.eventBus.emit({ type: "recipe.instance.stopped", instanceId, recipeId: row.recipe_id });
  }

  updateInstanceParams(instanceId: string, params: Record<string, unknown>): void {
    this.updateInstance(instanceId, params);
  }

  getLog(instanceId: string, limit = 50): RecipeLogEntry[] {
    const rows = this.stmts.getLog.all(instanceId, limit) as LogRow[];
    return rows.map(rowToLogEntry);
  }

  sendAction(instanceId: string, action: string, payload?: Record<string, unknown>): void {
    const running = this.running.get(instanceId);
    if (!running) {
      throw new RecipeError("Instance not running", 400);
    }
    running.recipe.onAction(action, payload);
    this.logger.debug({ instanceId, action, payload }, "Recipe action sent");
  }

  stopAll(): void {
    for (const [instanceId] of this.running) {
      this.stopInstance(instanceId);
    }
  }

  // ============================================================
  // Internal lifecycle
  // ============================================================

  private startInstance(recipe: Recipe, instance: RecipeInstance): void {
    // Stop any existing runner for this instance first (prevents orphaned subscriptions)
    this.stopInstance(instance.id);

    const ctx = this.buildContext(instance.id, instance.recipeId);

    recipe.validate(instance.params, ctx);
    recipe.start(instance.params, ctx);

    this.running.set(instance.id, { recipe, instance });
    this.logger.info(
      { instanceId: instance.id, recipeId: instance.recipeId },
      "Recipe instance started",
    );
    this.eventBus.emit({
      type: "recipe.instance.started",
      instanceId: instance.id,
      recipeId: instance.recipeId,
    });
  }

  private stopInstance(instanceId: string): void {
    const running = this.running.get(instanceId);
    if (!running) return;

    try {
      running.recipe.stop();
    } catch (err) {
      this.logger.error({ err, instanceId }, "Error stopping recipe instance");
    }

    this.running.delete(instanceId);
    this.logger.info(
      { instanceId, recipeId: running.instance.recipeId },
      "Recipe instance stopped",
    );
    this.eventBus.emit({
      type: "recipe.instance.stopped",
      instanceId,
      recipeId: running.instance.recipeId,
    });
  }

  private buildContext(instanceId: string, recipeId: string): RecipeContext {
    const stateStore = new RecipeStateStore(this.db, instanceId);
    return {
      eventBus: this.eventBus,
      equipmentManager: this.equipmentManager,
      zoneManager: this.zoneManager,
      zoneAggregator: this.zoneAggregator,
      logger: this.logger.child({ instanceId }),
      state: stateStore,
      log: (message: string, level: "info" | "warn" | "error" = "info") => {
        this.writeLog(instanceId, message, level);
      },
      notifyStateChanged: () => {
        this.eventBus.emit({ type: "recipe.instance.state.changed", instanceId, recipeId });
      },
    };
  }

  private writeLog(
    instanceId: string,
    message: string,
    level: "info" | "warn" | "error" = "info",
  ): void {
    try {
      this.stmts.insertLog.run(instanceId, message, level);
    } catch (err) {
      this.logger.error({ err, instanceId }, "Failed to write recipe log");
    }
  }
}

// ============================================================
// Custom error
// ============================================================

export class RecipeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RecipeError";
    this.status = status;
  }
}

// ============================================================
// SQLite row types and mappers
// ============================================================

interface InstanceRow {
  id: string;
  recipe_id: string;
  params: string;
  enabled: number;
  created_at: string;
}

interface LogRow {
  id: number;
  instance_id: string;
  timestamp: string;
  message: string;
  level: string;
}

function rowToInstance(row: InstanceRow): RecipeInstance {
  let params: Record<string, unknown>;
  try {
    params = JSON.parse(row.params);
  } catch {
    params = {};
  }
  return {
    id: row.id,
    recipeId: row.recipe_id,
    params,
    enabled: row.enabled === 1,
    createdAt: toISOUtc(row.created_at),
  };
}

function rowToLogEntry(row: LogRow): RecipeLogEntry {
  return {
    id: row.id,
    instanceId: row.instance_id,
    timestamp: toISOUtc(row.timestamp)!,
    message: row.message,
    level: row.level as "info" | "warn" | "error",
  };
}
