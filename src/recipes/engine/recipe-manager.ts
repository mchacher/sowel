import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { ZoneAggregator } from "../../zones/zone-aggregator.js";
import type { ZoneManager } from "../../zones/zone-manager.js";
import type { SunlightManager } from "../../zones/sunlight-manager.js";
import {
  isWithinSlot,
  schedulesOn,
  type TariffClassifier,
} from "../../energy/tariff-classifier.js";
import type { CapacityArbiter } from "../../energy/capacity-arbiter.js";
import type {
  RecipeInfo,
  RecipeInstance,
  RecipeLogEntry,
  RecipeDefinition,
  RecipeInstanceHandle,
  RecipeHelpers,
  RecipeSlotDef,
  RecipeActionDef,
  RecipeLangPack,
  RecipeTariff,
  RecipeEnergyHelpers,
  CapacityClaimHandle,
  CapacityClaimRequest,
  TariffConfig,
  TariffSlot,
  OrderSource,
  RecipeEquipmentDataHelpers,
} from "../../shared/types.js";
import {
  checkPublishDeclaration,
  type RecipeOutputTarget,
} from "../../equipments/recipe-outputs.js";
import { Recipe, type RecipeContext } from "./recipe.js";
import { toISOUtc } from "../../core/database.js";
import { RecipeStateStore } from "./recipe-state-store.js";
import { isAnyLightOn, turnOnLights, turnOffLights, setLightsBrightness } from "./light-helpers.js";
import { createRecipeHistory } from "./recipe-history.js";
import type { InfluxClient } from "../../core/influx-client.js";
import { parseDuration, formatDuration } from "./duration.js";

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
  /** Spec 214 — the publishing token of each instance's current start. */
  private publishTokens = new Map<string, object>();
  private running = new Map<string, RunningInstance>();
  private db: Database.Database;
  private eventBus: EventBus;
  private equipmentManager: EquipmentManager;
  private zoneManager: ZoneManager;
  private zoneAggregator: ZoneAggregator;
  private sunlightManager: SunlightManager;
  /** Spec 138 — read-only source for `ctx.helpers.getTariff()`. Null when the
   *  energy stack is unavailable; recipes then see `configured: false`. */
  private tariffClassifier: TariffClassifier | null;
  private logger: Logger;
  private stmts: ReturnType<typeof this.prepareStatements>;
  /** Spec 124 — when true, `startInstance` is a no-op so no recipe
   * ever emits an order while the shadow instance is up. */
  private readonly shadowMode: boolean;
  /** Spec 140 — capacity arbiter behind `ctx.helpers.energy`. Null in tests
   *  and shadow contexts: the helper then denies `arbiter-disabled`. */
  private capacityArbiter: CapacityArbiter | null;
  /** Spec 211 — source of `ctx.helpers.history`. Null in most tests: the
   *  helper is then absent. (In shadow mode no instance starts, spec 124.) */
  private influxClient: InfluxClient | null;

  constructor(
    db: Database.Database,
    eventBus: EventBus,
    equipmentManager: EquipmentManager,
    zoneManager: ZoneManager,
    zoneAggregator: ZoneAggregator,
    sunlightManager: SunlightManager,
    tariffClassifier: TariffClassifier | null,
    logger: Logger,
    shadowMode = false,
    capacityArbiter: CapacityArbiter | null = null, // spec 140 — ctx.helpers.energy
    influxClient: InfluxClient | null = null, // spec 211 — ctx.helpers.history
  ) {
    this.db = db;
    this.eventBus = eventBus;
    this.equipmentManager = equipmentManager;
    this.zoneManager = zoneManager;
    this.zoneAggregator = zoneAggregator;
    this.sunlightManager = sunlightManager;
    this.tariffClassifier = tariffClassifier;
    this.logger = logger.child({ module: "recipe-manager" });
    this.stmts = this.prepareStatements();
    this.shadowMode = shadowMode;
    this.capacityArbiter = capacityArbiter;
    this.influxClient = influxClient;
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

  /**
   * Register an external recipe from a recipe package.
   * Wraps the RecipeDefinition factory into the internal RegisteredRecipe format.
   */
  registerExternal(definition: RecipeDefinition, meta: { icon?: string } = {}): void {
    // Spec 214 — a declaration the core cannot honour keeps the recipe out,
    // rather than failing on every instance later.
    if (definition.publishes && definition.publishes.length > 0) {
      const equipmentSlots = new Set(
        definition.slots.filter((slot) => slot.type === "equipment").map((slot) => slot.id),
      );
      const invalid = checkPublishDeclaration(definition.publishes, equipmentSlots);
      if (invalid) throw new Error(`Recipe "${definition.id}" ${invalid}`);
    }
    this.registry.set(definition.id, {
      info: {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        slots: definition.slots,
        ...(definition.actions && definition.actions.length > 0
          ? { actions: definition.actions }
          : {}),
        ...(definition.publishes && definition.publishes.length > 0
          ? { publishes: definition.publishes }
          : {}),
        // Spec 169 — carried verbatim, and only when declared: its absence is
        // what tells the Dashboard this recipe is not pinnable.
        ...(definition.tile ? { tile: definition.tile } : {}),
        ...(definition.i18n && Object.keys(definition.i18n).length > 0
          ? { i18n: definition.i18n }
          : {}),
        // Spec 198 — the manifest's icon, shown on the zone page's recipe row.
        ...(typeof meta.icon === "string" && meta.icon.length > 0 ? { icon: meta.icon } : {}),
      },
      create: () => new ExternalRecipeAdapter(definition),
    });
    this.logger.info({ recipeId: definition.id }, "External recipe registered");
  }

  /**
   * Restart every enabled instance of a recipe with the currently registered
   * definition (issue #349). Called by the RecipeLoader after a package
   * update re-registers the definition: without this, running instances keep
   * executing the previous version's closure until manually toggled, while
   * the UI already shows the new version. Instance state (ctx.state) is
   * persisted and survives, exactly as with enable/disable.
   */
  restartInstancesOfRecipe(recipeId: string): number {
    const registered = this.registry.get(recipeId);
    if (!registered) return 0;

    const rows = this.stmts.getAllInstances.all() as InstanceRow[];
    let restarted = 0;
    for (const row of rows) {
      if (row.recipe_id !== recipeId || row.enabled !== 1) continue;
      this.stopInstance(row.id);
      const instance = rowToInstance(row);
      try {
        const recipe = registered.create();
        this.startInstance(recipe, instance);
        restarted++;
        this.writeLog(row.id, "Restarted with updated recipe package", "info");
      } catch (err) {
        this.logger.error(
          { err, instanceId: row.id, recipeId },
          "Failed to restart instance after recipe update",
        );
        this.writeLog(
          row.id,
          `Failed to restart after update: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    }
    if (restarted > 0) {
      this.logger.info({ recipeId, restarted }, "Recipe instances restarted after package update");
    }
    return restarted;
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
        this.logger.error(
          { err, instanceId: row.id, recipeId: row.recipe_id, recipeName: registered.info.name },
          "Failed to restore recipe instance",
        );
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

  /**
   * Lightweight metadata resolver for the activity buffer (spec 101).
   * Returns recipe name + zoneId (from a slot of type "zone", if any).
   */
  getInstanceMeta(
    instanceId: string,
  ): { recipeId: string; recipeName: string; zoneId: string | null } | null {
    const row = this.stmts.getInstanceById.get(instanceId) as InstanceRow | undefined;
    if (!row) return null;
    const registered = this.registry.get(row.recipe_id);
    const recipeName = registered?.info.name ?? row.recipe_id;
    let zoneId: string | null = null;
    if (registered) {
      const params = JSON.parse(row.params) as Record<string, unknown>;
      const zoneSlot = registered.info.slots.find(
        (s) => s.type === "zone" && !s.constraints?.crossZone,
      );
      if (zoneSlot && typeof params[zoneSlot.id] === "string") {
        zoneId = params[zoneSlot.id] as string;
      }
    }
    return { recipeId: row.recipe_id, recipeName, zoneId };
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
    this.assertPublishable(null, registered.info, params);

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
      this.logger.error(
        { err, instanceId: id, recipeId, recipeName: registered.info.name },
        "Failed to start recipe instance",
      );
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

    const recipeName = this.registry.get(row.recipe_id)?.info.name;
    this.logger.info(
      { instanceId, recipeId: row.recipe_id, recipeName },
      "Recipe instance deleted",
    );
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
    this.assertPublishable(instanceId, registered.info, params);

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
        this.logger.error(
          { err, instanceId, recipeId: row.recipe_id, recipeName: registered.info.name },
          "Failed to restart recipe instance after update",
        );
        this.writeLog(
          instanceId,
          `Failed to restart: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    }

    this.logger.info(
      { instanceId, recipeId: row.recipe_id, recipeName: registered.info.name },
      "Recipe instance updated",
    );
    return instance;
  }

  enableInstance(instanceId: string): void {
    const row = this.stmts.getInstanceById.get(instanceId) as InstanceRow | undefined;
    if (!row) throw new RecipeError("Instance not found", 404);
    if (row.enabled === 1) return;

    // Spec 214 — refused before the flag is written, so the caller gets the 400
    // and the instance does not stay enabled-but-stopped.
    const enablingInfo = this.registry.get(row.recipe_id)?.info;
    if (enablingInfo) this.assertPublishable(instanceId, enablingInfo, rowToInstance(row).params);

    this.stmts.setInstanceEnabled.run(1, instanceId);
    const instance = rowToInstance({ ...row, enabled: 1 });

    const registered = this.registry.get(row.recipe_id);
    if (registered) {
      try {
        const recipe = registered.create();
        this.startInstance(recipe, instance);
      } catch (err) {
        this.logger.error(
          { err, instanceId, recipeId: row.recipe_id, recipeName: registered?.info.name },
          "Failed to start recipe after enable",
        );
      }
    }

    const enabledRecipeName = this.registry.get(row.recipe_id)?.info.name;
    this.logger.info(
      { instanceId, recipeId: row.recipe_id, recipeName: enabledRecipeName },
      "Recipe instance enabled",
    );
    // startInstance already emitted `recipe.instance.started` when the runner
    // came up; emitting it again put the start twice in the activity feed
    // (#1122). A runner that did not come up (start threw, recipe not
    // registered, shadow mode) still flipped the enabled flag, so clients are
    // told to refresh without the feed claiming a start that did not happen.
    if (!this.running.has(instanceId)) {
      this.eventBus.emit({
        type: "recipe.instance.state.changed",
        instanceId,
        recipeId: row.recipe_id,
      });
    }
  }

  disableInstance(instanceId: string): void {
    const row = this.stmts.getInstanceById.get(instanceId) as InstanceRow | undefined;
    if (!row) throw new RecipeError("Instance not found", 404);

    // Always stop in-memory runner even if DB says disabled — prevents orphaned runners
    const wasRunning = this.running.has(instanceId);
    this.stopInstance(instanceId);

    if (row.enabled === 0) return;

    this.stmts.setInstanceEnabled.run(0, instanceId);

    const disabledRecipeName = this.registry.get(row.recipe_id)?.info.name;
    this.logger.info(
      { instanceId, recipeId: row.recipe_id, recipeName: disabledRecipeName },
      "Recipe instance disabled",
    );
    // Same as enableInstance: stopInstance already emitted
    // `recipe.instance.stopped` for a running instance (#1122).
    if (!wasRunning) {
      this.eventBus.emit({
        type: "recipe.instance.state.changed",
        instanceId,
        recipeId: row.recipe_id,
      });
    }
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
    // Spec 124 — central choke point. Every code path that activates
    // a recipe (init restore, create, update, enable, mode change)
    // funnels through here. Gating here ensures the shadow never
    // emits an order to a real device, regardless of how the user
    // shapes the recipe DB rows from the UI.
    if (this.shadowMode) {
      this.logger.warn(
        { instanceId: instance.id, recipeId: instance.recipeId, module: "shadow-mode" },
        "Shadow mode: refusing to start recipe instance",
      );
      return;
    }

    // Stop any existing runner for this instance first (prevents orphaned subscriptions)
    this.stopInstance(instance.id);
    // Spec 140 — release any capacity claim left by a PRIOR start of this
    // instance that threw before `running` was set (stopInstance above would
    // early-return in that case and never release it).
    this.capacityArbiter?.releaseAllFor(instance.id);

    // Spec 214 — this start's publishing token: a closure left over from a
    // previous start of the same instance publishes nothing.
    const publishToken = {};
    this.publishTokens.set(instance.id, publishToken);
    const ctx = this.buildContext(instance.id, instance.recipeId, publishToken);
    const info = this.registry.get(instance.recipeId)?.info;
    // Spec 214 — refused here too on the enable and boot paths, which have no
    // request to answer: the caller logs it and the instance stays stopped.
    const outputs = info ? this.assertPublishable(instance.id, info, instance.params, false) : [];

    try {
      recipe.validate(instance.params, ctx);
      if (outputs.length > 0) {
        this.equipmentManager.attachRecipeOutputs(instance.id, info?.name ?? "", outputs);
      }
      recipe.start(instance.params, ctx);
    } catch (err) {
      // A recipe that claimed capacity in start() and then threw must not
      // leak the claim (which would block the equipment until restart).
      this.capacityArbiter?.releaseAllFor(instance.id);
      // Nor leave data on its equipments (spec 214).
      if (outputs.length > 0) this.equipmentManager.detachRecipeOutputs(instance.id);
      throw err;
    }

    this.running.set(instance.id, { recipe, instance });
    const startedRecipeName = this.registry.get(instance.recipeId)?.info.name;
    this.logger.info(
      { instanceId: instance.id, recipeId: instance.recipeId, recipeName: startedRecipeName },
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

    // Spec 140 — a stopping instance never leaves claims behind.
    this.capacityArbiter?.releaseAllFor(instanceId);

    try {
      running.recipe.stop();
    } catch (err) {
      this.logger.error({ err, instanceId }, "Error stopping recipe instance");
    }
    // Spec 214 — a stopped instance publishes nothing any more. Unconditional:
    // a package update may have dropped the declaration the outputs came from.
    this.publishTokens.delete(instanceId);
    this.equipmentManager.detachRecipeOutputs(instanceId);

    this.running.delete(instanceId);
    const stoppedRecipeName = this.registry.get(running.instance.recipeId)?.info.name;
    this.logger.info(
      { instanceId, recipeId: running.instance.recipeId, recipeName: stoppedRecipeName },
      "Recipe instance stopped",
    );
    this.eventBus.emit({
      type: "recipe.instance.stopped",
      instanceId,
      recipeId: running.instance.recipeId,
    });
  }

  // `energy` is per-instance (the claim must be owned, spec 140), as are
  // `equipmentData` (spec 214) and `history` (spec 211, its rate limit is per
  // context), so the shared object carries everything BUT them; buildContext
  // adds them.
  private readonly helpers: Omit<RecipeHelpers, "energy" | "equipmentData" | "history"> = {
    isAnyLightOn,
    turnOnLights,
    turnOffLights,
    setLightsBrightness,
    parseDuration,
    formatDuration,
    // Arrow keeps the read lazy: `sunlightManager` is assigned in the
    // constructor body, but getSunlight is only ever called at recipe runtime.
    getSunlight: () => this.sunlightManager.getSunlightData(),
    getTariff: () => this.buildTariffSnapshot(),
  };

  /**
   * Spec 140 — per-instance capacity helper. Always present on this core;
   * claims are denied `arbiter-disabled` when no arbiter is wired (tests)
   * or the arbiter is off, so recipes never need to probe.
   */
  private buildEnergyHelpers(instanceId: string): RecipeEnergyHelpers {
    return {
      claimCapacity: (req: CapacityClaimRequest): CapacityClaimHandle => {
        if (!this.capacityArbiter) {
          return {
            id: randomUUID(),
            status: () => "denied",
            deniedReason: "arbiter-disabled",
            release: () => {},
            // Spec 166 — a denied claim describes nothing, so a recipe keeping
            // its declaration current is a no-op rather than a special case it
            // has to guard against.
            reportNeed: () => {},
            budgetW: () => null,
          };
        }
        return this.capacityArbiter.claim(instanceId, req);
      },
      getCapacityState: () => {
        if (!this.capacityArbiter) {
          return { enabled: false, availableSurplusW: null, grants: [] };
        }
        const pub = this.capacityArbiter.getPublicState();
        return {
          enabled: pub.enabled,
          availableSurplusW: pub.availableSurplusW,
          grants: pub.grants.map((g) => ({
            equipmentId: g.equipmentId,
            watts: g.watts,
            sinceIso: g.sinceIso,
            ...(g.budgetW !== undefined ? { budgetW: g.budgetW } : {}),
          })),
        };
      },
    };
  }

  /**
   * Build the recipe-facing tariff snapshot (spec 138).
   *
   * `TariffClassifier.getConfig()` returns its *cached* object by reference, so
   * handing it straight to a recipe package would let third-party code mutate
   * the schedule that energy billing runs on. Everything below is copied out by
   * value; there is no path from a recipe back into that cache, and no setter.
   *
   * `config.prices` is read but never copied out — see RecipeTariff.
   */
  private buildTariffSnapshot(): RecipeTariff {
    const empty: RecipeTariff = {
      configured: false,
      offPeakToday: [],
      isOffPeakNow: null,
    };

    let config: TariffConfig | null;
    try {
      config = this.tariffClassifier?.getConfig() ?? null;
    } catch (err) {
      this.logger.warn({ err }, "Failed to read tariff config for recipes");
      return empty;
    }
    if (!config) return empty;

    const now = new Date();
    // Spec 204 — the schedule of today's season.
    const schedule = schedulesOn(config, now).find((s) => s.days.includes(now.getDay()));
    const offPeakToday: TariffSlot[] = (schedule?.slots ?? [])
      .filter((s) => s.tariff === "hc")
      .map((s) => ({ start: s.start, end: s.end, tariff: s.tariff }));

    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    return {
      configured: true,
      offPeakToday,
      isOffPeakNow: offPeakToday.some((s) => isWithinSlot(minuteOfDay, s)),
    };
  }

  private buildContext(instanceId: string, recipeId: string, publishToken?: object): RecipeContext {
    const onChanged = () => {
      this.eventBus.emit({ type: "recipe.instance.state.changed", instanceId, recipeId });
    };
    const stateStore = new RecipeStateStore(this.db, instanceId, onChanged);
    const recipeName = this.registry.get(recipeId)?.info.name ?? recipeId;
    const orderSource: OrderSource = { kind: "recipe", instanceId, recipeName, recipeId };
    return {
      eventBus: this.eventBus,
      equipmentManager: this.equipmentManager,
      zoneManager: this.zoneManager,
      zoneAggregator: this.zoneAggregator,
      logger: this.logger.child({ instanceId }),
      state: stateStore,
      log: (message: string, level: "info" | "warn" | "error" = "info") => {
        this.writeLog(instanceId, message, level);
        const childLogger = this.logger.child({ instanceId, recipeId, recipeName });
        childLogger[level]({ instanceId, recipeId, recipeName }, message);
      },
      helpers: {
        ...this.helpers,
        energy: this.buildEnergyHelpers(instanceId),
        equipmentData: this.buildEquipmentDataHelpers(instanceId, publishToken),
        // Spec 211 — a fresh helper per context: its rate-limit counter lives
        // and dies with it, and a validate() context never drains an instance's.
        history: this.influxClient
          ? createRecipeHistory({
              influxClient: this.influxClient,
              equipmentManager: this.equipmentManager,
              logger: this.logger,
              instanceId,
              // Bound to this start, like equipmentData: a closure left over
              // from a stopped or earlier start reads nothing.
              isCurrent:
                publishToken === undefined
                  ? undefined
                  : () => this.publishTokens.get(instanceId) === publishToken,
            })
          : undefined,
      },
      dispatchOrder: (equipmentId, alias, value) =>
        this.equipmentManager.executeOrder(equipmentId, alias, value, orderSource),
    };
  }

  /**
   * Spec 214 — the instance's publishing channel, bound to one start. A
   * validation context (no token) or a closure from an earlier start of the
   * same instance publishes nothing.
   */
  private buildEquipmentDataHelpers(
    instanceId: string,
    publishToken: object | undefined,
  ): RecipeEquipmentDataHelpers {
    return {
      publish: (equipmentId, alias, value) =>
        publishToken === undefined || this.publishTokens.get(instanceId) !== publishToken
          ? { ok: false, reason: "not running" }
          : this.equipmentManager.publishRecipeData(instanceId, equipmentId, alias, value),
    };
  }

  /** Spec 214 — declarations × the equipment ids their slot holds in `params`. */
  private resolvePublishTargets(
    info: RecipeInfo,
    params: Record<string, unknown>,
  ): RecipeOutputTarget[] {
    const targets: RecipeOutputTarget[] = [];
    for (const def of info.publishes ?? []) {
      const value = params[def.slot];
      const ids = Array.isArray(value) ? value : [value];
      for (const id of ids) {
        if (typeof id === "string" && id !== "") targets.push({ equipmentId: id, def });
      }
    }
    return targets;
  }

  /**
   * Spec 214 FR2 — the outputs an instance may take, or a 400 RecipeError
   * naming the conflict: devices, the core's own derived aliases, running
   * instances, and — on a user's request (create, update, enable) — every
   * other ENABLED instance in the database, running or not. A start (boot,
   * restart) checks only what runs: two enabled instances left in conflict
   * (a package update that added a declaration) keep the first one started,
   * rather than refusing both.
   */
  private assertPublishable(
    instanceId: string | null,
    info: RecipeInfo,
    params: Record<string, unknown>,
    againstEnabled = true,
  ): RecipeOutputTarget[] {
    const targets = this.resolvePublishTargets(info, params);
    if (targets.length === 0) return [];
    if (againstEnabled) this.assertNoEnabledConflict(instanceId, targets);
    try {
      return this.equipmentManager.checkPublishable(instanceId ?? "", targets);
    } catch (err) {
      throw new RecipeError(err instanceof Error ? err.message : String(err), 400);
    }
  }

  private assertNoEnabledConflict(
    instanceId: string | null,
    targets: readonly RecipeOutputTarget[],
  ): void {
    const wanted = new Set(targets.map((t) => `${t.equipmentId}\u0000${t.def.alias}`));
    for (const row of this.stmts.getAllInstances.all() as InstanceRow[]) {
      if (row.id === instanceId || row.enabled !== 1) continue;
      const other = this.registry.get(row.recipe_id)?.info;
      if (!other?.publishes) continue;
      for (const t of this.resolvePublishTargets(other, rowToInstance(row).params)) {
        if (wanted.has(`${t.equipmentId}\u0000${t.def.alias}`)) {
          const name = this.equipmentManager.getById(t.equipmentId)?.name ?? t.equipmentId;
          throw new RecipeError(
            `"${name}" already gets "${t.def.alias}" from recipe instance ${row.id} (${other.name})`,
            400,
          );
        }
      }
    }
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
// External recipe adapter — wraps RecipeDefinition into Recipe
// ============================================================

class ExternalRecipeAdapter extends Recipe {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly slots: RecipeSlotDef[];
  override readonly actions: RecipeActionDef[];
  override readonly i18n: Record<string, RecipeLangPack>;

  private definition: RecipeDefinition;
  private handle: RecipeInstanceHandle | null = null;

  constructor(definition: RecipeDefinition) {
    super();
    this.definition = definition;
    this.id = definition.id;
    this.name = definition.name;
    this.description = definition.description;
    this.slots = definition.slots;
    this.actions = definition.actions ?? [];
    this.i18n = definition.i18n ?? {};
  }

  validate(params: Record<string, unknown>, ctx: RecipeContext): void {
    this.definition.validate(params, ctx);
  }

  start(params: Record<string, unknown>, ctx: RecipeContext): void {
    this.handle = this.definition.createInstance(params, ctx);
  }

  stop(): void {
    if (this.handle) {
      this.handle.stop();
      this.handle = null;
    }
  }

  override onAction(action: string, payload?: Record<string, unknown>): void {
    this.handle?.onAction?.(action, payload);
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
