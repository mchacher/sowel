import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { Logger } from "../core/logger.js";
import { toISOUtc } from "../core/database.js";
import type {
  Mode,
  ModeEventTrigger,
  ModeWithDetails,
  ZoneModeImpact,
  ZoneModeImpactAction,
} from "../shared/types.js";

export class ModeManager {
  private readonly log;
  private readonly stmts;

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    private readonly equipmentManager: EquipmentManager,
    private readonly recipeManager: RecipeManager,
    logger: Logger,
  ) {
    this.log = logger.child({ module: "mode-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insertMode: this.db.prepare(
        `INSERT INTO modes (id, name, icon, description, active) VALUES (?, ?, ?, ?, 0)`,
      ),
      updateMode: this.db.prepare(
        `UPDATE modes SET name = ?, icon = ?, description = ?, updated_at = datetime('now') WHERE id = ?`,
      ),
      deleteMode: this.db.prepare(`DELETE FROM modes WHERE id = ?`),
      getMode: this.db.prepare(`SELECT * FROM modes WHERE id = ?`),
      listModes: this.db.prepare(`SELECT * FROM modes ORDER BY name`),
      setActive: this.db.prepare(
        `UPDATE modes SET active = ?, updated_at = datetime('now') WHERE id = ?`,
      ),
      // Event triggers
      insertTrigger: this.db.prepare(
        `INSERT INTO mode_event_triggers (id, mode_id, equipment_id, alias, value) VALUES (?, ?, ?, ?, ?)`,
      ),
      deleteTrigger: this.db.prepare(`DELETE FROM mode_event_triggers WHERE id = ?`),
      getTriggersByMode: this.db.prepare(
        `SELECT * FROM mode_event_triggers WHERE mode_id = ?`,
      ),
      listAllTriggers: this.db.prepare(`SELECT * FROM mode_event_triggers`),
      // Zone impacts
      upsertImpact: this.db.prepare(
        `INSERT INTO zone_mode_impacts (id, mode_id, zone_id, actions)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(mode_id, zone_id) DO UPDATE SET actions = excluded.actions`,
      ),
      deleteImpact: this.db.prepare(`DELETE FROM zone_mode_impacts WHERE id = ?`),
      deleteImpactByModeZone: this.db.prepare(
        `DELETE FROM zone_mode_impacts WHERE mode_id = ? AND zone_id = ?`,
      ),
      getImpactsByMode: this.db.prepare(
        `SELECT * FROM zone_mode_impacts WHERE mode_id = ?`,
      ),
      getImpactsByZone: this.db.prepare(
        `SELECT * FROM zone_mode_impacts WHERE zone_id = ?`,
      ),
    };
  }

  // ── Init ──────────────────────────────────────────────────

  init(): void {
    // Listen for equipment data changes to match event triggers
    this.eventBus.on((event) => {
      if (event.type === "equipment.data.changed") {
        try {
          this.handleEquipmentDataChanged(
            event.equipmentId,
            event.alias,
            event.value,
          );
        } catch (err) {
          this.log.error({ err }, "Error handling event trigger");
        }
      }
    });

    const modes = this.listModes();
    const activeModes = modes.filter((m) => m.active);
    if (activeModes.length > 0) {
      this.log.info(
        { count: activeModes.length },
        "Active modes restored from DB",
      );
    }

    const triggers = this.stmts.listAllTriggers.all() as ModeEventTriggerRow[];
    if (triggers.length > 0) {
      this.log.info(
        { count: triggers.length },
        "Event triggers registered",
      );
    }
  }

  // ── Mode CRUD ─────────────────────────────────────────────

  createMode(name: string, icon?: string, description?: string): Mode {
    const id = randomUUID();
    this.stmts.insertMode.run(id, name, icon ?? null, description ?? null);
    const mode = this.getMode(id)!;
    this.eventBus.emit({ type: "mode.created", mode });
    this.log.info({ modeId: id, name }, "Mode created");
    return mode;
  }

  updateMode(
    id: string,
    updates: { name?: string; icon?: string; description?: string },
  ): Mode {
    const existing = this.getMode(id);
    if (!existing) throw new ModeError(`Mode not found: ${id}`, 404);

    this.stmts.updateMode.run(
      updates.name ?? existing.name,
      updates.icon !== undefined ? updates.icon : existing.icon ?? null,
      updates.description !== undefined ? updates.description : existing.description ?? null,
      id,
    );

    const mode = this.getMode(id)!;
    this.eventBus.emit({ type: "mode.updated", mode });
    this.log.info({ modeId: id }, "Mode updated");
    return mode;
  }

  deleteMode(id: string): void {
    const existing = this.getMode(id);
    if (!existing) throw new ModeError(`Mode not found: ${id}`, 404);

    this.stmts.deleteMode.run(id);
    this.eventBus.emit({ type: "mode.removed", modeId: id, modeName: existing.name });
    this.log.info({ modeId: id, name: existing.name }, "Mode deleted");
  }

  getMode(id: string): Mode | null {
    const row = this.stmts.getMode.get(id) as ModeRow | undefined;
    return row ? rowToMode(row) : null;
  }

  getModeWithDetails(id: string): ModeWithDetails | null {
    const mode = this.getMode(id);
    if (!mode) return null;
    return {
      ...mode,
      eventTriggers: this.getEventTriggers(mode.id),
      impacts: this.getImpactsByMode(mode.id),
    };
  }

  listModes(): Mode[] {
    const rows = this.stmts.listModes.all() as ModeRow[];
    return rows.map(rowToMode);
  }

  listModesWithDetails(): ModeWithDetails[] {
    return this.listModes().map((mode) => ({
      ...mode,
      eventTriggers: this.getEventTriggers(mode.id),
      impacts: this.getImpactsByMode(mode.id),
    }));
  }

  // ── Activation ────────────────────────────────────────────

  activateMode(id: string): void {
    const mode = this.getMode(id);
    if (!mode) throw new ModeError(`Mode not found: ${id}`, 404);

    if (mode.active) {
      this.log.info({ modeId: id, name: mode.name }, "Mode already active, skipping");
      return;
    }

    // Set active flag
    this.stmts.setActive.run(1, id);

    // Execute all zone impacts
    const impacts = this.getImpactsByMode(id);
    for (const impact of impacts) {
      this.executeImpact(impact, mode.name);
    }

    this.eventBus.emit({ type: "mode.activated", modeId: id, modeName: mode.name });
    this.log.info(
      { modeId: id, name: mode.name, impactCount: impacts.length },
      "Mode activated",
    );
  }

  applyModeToZone(modeId: string, zoneId: string): void {
    const mode = this.getMode(modeId);
    if (!mode) throw new ModeError(`Mode not found: ${modeId}`, 404);

    const impacts = this.getImpactsByMode(modeId);
    const zoneImpact = impacts.find((imp) => imp.zoneId === zoneId);
    if (!zoneImpact) {
      throw new ModeError(`No impacts configured for mode ${modeId} on zone ${zoneId}`, 404);
    }

    this.executeImpact(zoneImpact, mode.name);
    this.log.info(
      { modeId, zoneId, actionCount: zoneImpact.actions.length, modeName: mode.name },
      "Mode applied to zone (local)",
    );
  }

  deactivateMode(id: string): void {
    const mode = this.getMode(id);
    if (!mode) throw new ModeError(`Mode not found: ${id}`, 404);

    if (!mode.active) {
      this.log.info({ modeId: id, name: mode.name }, "Mode already inactive, skipping");
      return;
    }

    this.stmts.setActive.run(0, id);
    this.eventBus.emit({ type: "mode.deactivated", modeId: id, modeName: mode.name });
    this.log.info({ modeId: id, name: mode.name }, "Mode deactivated");
  }

  private executeImpact(impact: ZoneModeImpact, modeName: string): void {
    for (const action of impact.actions) {
      try {
        this.executeAction(action, modeName);
      } catch (err) {
        this.log.warn(
          { err, action, zoneId: impact.zoneId, modeName },
          "Failed to execute mode impact action",
        );
      }
    }
  }

  private executeAction(action: ZoneModeImpactAction, modeName: string): void {
    switch (action.type) {
      case "order":
        this.equipmentManager.executeOrder(
          action.equipmentId,
          action.orderAlias,
          action.value,
        );
        this.log.debug(
          { equipmentId: action.equipmentId, alias: action.orderAlias, value: action.value, modeName },
          "Mode order executed",
        );
        break;

      case "recipe_toggle":
        if (action.enabled) {
          this.recipeManager.enableInstance(action.instanceId);
        } else {
          this.recipeManager.disableInstance(action.instanceId);
        }
        this.log.debug(
          { instanceId: action.instanceId, enabled: action.enabled, modeName },
          "Mode recipe toggle executed",
        );
        break;

      case "recipe_params":
        this.recipeManager.updateInstanceParams(action.instanceId, action.params);
        this.log.debug(
          { instanceId: action.instanceId, params: action.params, modeName },
          "Mode recipe params updated",
        );
        break;
    }
  }

  // ── Event Triggers ────────────────────────────────────────

  addEventTrigger(
    modeId: string,
    equipmentId: string,
    alias: string,
    value: unknown,
  ): ModeEventTrigger {
    const mode = this.getMode(modeId);
    if (!mode) throw new ModeError(`Mode not found: ${modeId}`, 404);

    const id = randomUUID();
    this.stmts.insertTrigger.run(id, modeId, equipmentId, alias, JSON.stringify(value));
    this.log.info({ triggerId: id, modeId, equipmentId, alias }, "Event trigger added");

    return { id, modeId, equipmentId, alias, value };
  }

  removeEventTrigger(triggerId: string): void {
    this.stmts.deleteTrigger.run(triggerId);
    this.log.info({ triggerId }, "Event trigger removed");
  }

  getEventTriggers(modeId: string): ModeEventTrigger[] {
    const rows = this.stmts.getTriggersByMode.all(modeId) as ModeEventTriggerRow[];
    return rows.map(rowToEventTrigger);
  }

  private handleEquipmentDataChanged(
    equipmentId: string,
    alias: string,
    value: unknown,
  ): void {
    const triggers = this.stmts.listAllTriggers.all() as ModeEventTriggerRow[];

    for (const trigger of triggers) {
      if (
        trigger.equipment_id === equipmentId &&
        trigger.alias === alias
      ) {
        const triggerValue = JSON.parse(trigger.value);
        if (triggerValue === value || JSON.stringify(triggerValue) === JSON.stringify(value)) {
          this.log.info(
            { modeId: trigger.mode_id, triggerId: trigger.id, equipmentId, alias, value },
            "Event trigger matched — activating mode",
          );
          this.activateMode(trigger.mode_id);
        }
      }
    }
  }

  // ── Zone Impacts ──────────────────────────────────────────

  setZoneImpact(
    modeId: string,
    zoneId: string,
    actions: ZoneModeImpactAction[],
  ): ZoneModeImpact {
    const mode = this.getMode(modeId);
    if (!mode) throw new ModeError(`Mode not found: ${modeId}`, 404);

    const id = randomUUID();
    this.stmts.upsertImpact.run(id, modeId, zoneId, JSON.stringify(actions));
    this.log.info({ modeId, zoneId, actionCount: actions.length }, "Zone impact set");

    return { id, modeId, zoneId, actions };
  }

  removeZoneImpact(modeId: string, zoneId: string): void {
    this.stmts.deleteImpactByModeZone.run(modeId, zoneId);
    this.log.info({ modeId, zoneId }, "Zone impact removed");
  }

  getImpactsByMode(modeId: string): ZoneModeImpact[] {
    const rows = this.stmts.getImpactsByMode.all(modeId) as ZoneModeImpactRow[];
    return rows.map(rowToImpact);
  }

  getImpactsByZone(zoneId: string): ZoneModeImpact[] {
    const rows = this.stmts.getImpactsByZone.all(zoneId) as ZoneModeImpactRow[];
    return rows.map(rowToImpact);
  }
}

// ── Row types & mappers ──────────────────────────────────────

interface ModeRow {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function rowToMode(row: ModeRow): Mode {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    active: row.active === 1,
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
  };
}

interface ModeEventTriggerRow {
  id: string;
  mode_id: string;
  equipment_id: string;
  alias: string;
  value: string;
}

function rowToEventTrigger(row: ModeEventTriggerRow): ModeEventTrigger {
  return {
    id: row.id,
    modeId: row.mode_id,
    equipmentId: row.equipment_id,
    alias: row.alias,
    value: JSON.parse(row.value),
  };
}

interface ZoneModeImpactRow {
  id: string;
  mode_id: string;
  zone_id: string;
  actions: string;
}

function rowToImpact(row: ZoneModeImpactRow): ZoneModeImpact {
  return {
    id: row.id,
    modeId: row.mode_id,
    zoneId: row.zone_id,
    actions: JSON.parse(row.actions) as ZoneModeImpactAction[],
  };
}

// ── Error ────────────────────────────────────────────────────

export class ModeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ModeError";
  }
}
