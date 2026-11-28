import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { Logger } from "../core/logger.js";
import { toISOUtc } from "../core/database.js";
import type {
  Mode,
  ModeWithDetails,
  ZoneModeImpact,
  ZoneModeImpactAction,
  OrderSource,
} from "../shared/types.js";

export class ModeManager {
  private readonly logger;
  private readonly stmts;

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    private readonly equipmentManager: EquipmentManager,
    private readonly recipeManager: RecipeManager,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "mode-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insertMode: this.db.prepare(
        `INSERT INTO modes (id, name, icon, description, group_name, active) VALUES (?, ?, ?, ?, ?, 0)`,
      ),
      updateMode: this.db.prepare(
        `UPDATE modes SET name = ?, icon = ?, description = ?, group_name = ?, updated_at = datetime('now') WHERE id = ?`,
      ),
      deleteMode: this.db.prepare(`DELETE FROM modes WHERE id = ?`),
      getMode: this.db.prepare(`SELECT * FROM modes WHERE id = ?`),
      listModes: this.db.prepare(`SELECT * FROM modes ORDER BY name`),
      setActive: this.db.prepare(
        `UPDATE modes SET active = ?, updated_at = datetime('now') WHERE id = ?`,
      ),
      setActivated: this.db.prepare(
        `UPDATE modes SET active = 1, activated_at = ?, updated_at = datetime('now') WHERE id = ?`,
      ),
      listActiveInGroup: this.db.prepare(`SELECT * FROM modes WHERE group_name = ? AND active = 1`),
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
      getImpactsByMode: this.db.prepare(`SELECT * FROM zone_mode_impacts WHERE mode_id = ?`),
      getImpactsByZone: this.db.prepare(`SELECT * FROM zone_mode_impacts WHERE zone_id = ?`),
    };
  }

  // ── Init ──────────────────────────────────────────────────

  init(): void {
    const modes = this.listModes();
    const activeModes = modes.filter((m) => m.active);
    if (activeModes.length > 0) {
      this.logger.info({ count: activeModes.length }, "Active modes restored from DB");
    }
  }

  // ── Mode CRUD ─────────────────────────────────────────────

  createMode(name: string, icon?: string, description?: string, group?: string | null): Mode {
    const groupName = normalizeGroup(group);
    const id = randomUUID();
    this.stmts.insertMode.run(id, name, icon ?? null, description ?? null, groupName);
    const mode = this.getMode(id)!;
    this.eventBus.emit({ type: "mode.created", mode });
    this.logger.info({ modeId: id, name, group: groupName }, "Mode created");
    return mode;
  }

  updateMode(
    id: string,
    updates: { name?: string; icon?: string; description?: string; group?: string | null },
  ): Mode {
    const existing = this.getMode(id);
    if (!existing) throw new ModeError(`Mode not found: ${id}`, 404);
    const groupName =
      updates.group !== undefined ? normalizeGroup(updates.group) : (existing.group ?? null);

    this.stmts.updateMode.run(
      updates.name ?? existing.name,
      updates.icon !== undefined ? updates.icon : (existing.icon ?? null),
      updates.description !== undefined ? updates.description : (existing.description ?? null),
      groupName,
      id,
    );

    // Spec 219 — an active mode moved into a group that already has an active
    // mode: the most recently activated stays, the others are switched off.
    if (existing.active && groupName !== null && groupName !== (existing.group ?? null)) {
      this.resolveGroupConflict(groupName, id);
    }

    const mode = this.getMode(id)!;
    this.eventBus.emit({ type: "mode.updated", mode });
    this.logger.info({ modeId: id }, "Mode updated");
    return mode;
  }

  deleteMode(id: string): void {
    const existing = this.getMode(id);
    if (!existing) throw new ModeError(`Mode not found: ${id}`, 404);

    this.stmts.deleteMode.run(id);
    this.eventBus.emit({ type: "mode.removed", modeId: id, modeName: existing.name });
    this.logger.info({ modeId: id, name: existing.name }, "Mode deleted");
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
      impacts: this.getImpactsByMode(mode.id),
    }));
  }

  // ── Activation ────────────────────────────────────────────

  activateMode(id: string): void {
    const mode = this.getMode(id);
    if (!mode) throw new ModeError(`Mode not found: ${id}`, 404);

    if (mode.active) {
      this.logger.info({ modeId: id, name: mode.name }, "Mode already active, skipping");
      return;
    }

    // Spec 219 — within a group, the other active modes are switched off
    // first, in the same transaction as the activation.
    const siblings = mode.group
      ? (this.stmts.listActiveInGroup.all(mode.group) as ModeRow[])
          .map(rowToMode)
          .filter((m) => m.id !== id)
      : [];
    this.db.transaction(() => {
      for (const sibling of siblings) this.stmts.setActive.run(0, sibling.id);
      this.stmts.setActivated.run(new Date().toISOString(), id);
    })();
    for (const sibling of siblings) {
      this.eventBus.emit({ type: "mode.deactivated", modeId: sibling.id, modeName: sibling.name });
      this.logger.info(
        { modeId: sibling.id, name: sibling.name, group: mode.group, replacedBy: mode.name },
        "Mode deactivated by its group",
      );
    }

    // Execute all zone impacts
    const impacts = this.getImpactsByMode(id);
    const source: OrderSource = { kind: "mode", modeId: id, modeName: mode.name };
    for (const impact of impacts) {
      this.executeImpact(impact, mode.name, source);
    }

    this.eventBus.emit({ type: "mode.activated", modeId: id, modeName: mode.name });
    this.logger.info(
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

    const source: OrderSource = { kind: "mode", modeId, modeName: mode.name };
    this.executeImpact(zoneImpact, mode.name, source);
    this.logger.info(
      { modeId, zoneId, actionCount: zoneImpact.actions.length, modeName: mode.name },
      "Mode applied to zone (local)",
    );
  }

  deactivateMode(id: string): void {
    const mode = this.getMode(id);
    if (!mode) throw new ModeError(`Mode not found: ${id}`, 404);

    if (!mode.active) {
      this.logger.info({ modeId: id, name: mode.name }, "Mode already inactive, skipping");
      return;
    }

    this.stmts.setActive.run(0, id);
    this.eventBus.emit({ type: "mode.deactivated", modeId: id, modeName: mode.name });
    this.logger.info({ modeId: id, name: mode.name }, "Mode deactivated");
  }

  /**
   * Keeps the most recently activated active mode of `group` (a mode never
   * activated since spec 219 counts as the oldest; a tie goes to `preferId`)
   * and deactivates the others.
   */
  private resolveGroupConflict(group: string, preferId: string): void {
    const active = (this.stmts.listActiveInGroup.all(group) as ModeRow[]).map(rowToMode);
    if (active.length < 2) return;
    const rank = (m: Mode) => m.activatedAt ?? "";
    const keep = active.reduce((best, m) => {
      const diff = rank(m).localeCompare(rank(best));
      if (diff > 0) return m;
      if (diff === 0 && m.id === preferId) return m;
      return best;
    });
    for (const m of active) {
      if (m.id === keep.id) continue;
      this.stmts.setActive.run(0, m.id);
      this.eventBus.emit({ type: "mode.deactivated", modeId: m.id, modeName: m.name });
      this.logger.info(
        { modeId: m.id, name: m.name, group, kept: keep.name },
        "Mode deactivated by its group",
      );
    }
  }

  private executeImpact(impact: ZoneModeImpact, modeName: string, source: OrderSource): void {
    for (const action of impact.actions) {
      try {
        this.executeAction(action, modeName, source);
      } catch (err) {
        this.logger.warn(
          { err, action, zoneId: impact.zoneId, modeName },
          "Failed to execute mode impact action",
        );
      }
    }
  }

  private executeAction(action: ZoneModeImpactAction, modeName: string, source: OrderSource): void {
    switch (action.type) {
      case "order": {
        const eq = this.equipmentManager.getById(action.equipmentId);
        this.equipmentManager
          .executeOrder(action.equipmentId, action.orderAlias, action.value, source)
          .then((result) => {
            if (!result.success) {
              this.logger.warn(
                {
                  equipmentId: action.equipmentId,
                  alias: action.orderAlias,
                  error: result.error,
                  modeName,
                },
                "Mode order dispatch failed",
              );
            }
          })
          .catch((err) => {
            this.logger.warn(
              { err, equipmentId: action.equipmentId, modeName },
              "Mode order failed",
            );
          });
        this.logger.debug(
          {
            equipmentId: action.equipmentId,
            equipmentName: eq?.name,
            alias: action.orderAlias,
            value: action.value,
            modeName,
          },
          "Mode order dispatched",
        );
        break;
      }

      case "recipe_toggle":
        if (action.enabled) {
          this.recipeManager.enableInstance(action.instanceId);
        } else {
          this.recipeManager.disableInstance(action.instanceId);
        }
        this.logger.debug(
          { instanceId: action.instanceId, enabled: action.enabled, modeName },
          "Mode recipe toggle executed",
        );
        break;

      case "recipe_params":
        this.recipeManager.updateInstanceParams(action.instanceId, action.params);
        this.logger.debug(
          { instanceId: action.instanceId, params: action.params, modeName },
          "Mode recipe params updated",
        );
        break;
    }
  }

  // ── Zone Impacts ──────────────────────────────────────────

  setZoneImpact(modeId: string, zoneId: string, actions: ZoneModeImpactAction[]): ZoneModeImpact {
    const mode = this.getMode(modeId);
    if (!mode) throw new ModeError(`Mode not found: ${modeId}`, 404);

    const id = randomUUID();
    this.stmts.upsertImpact.run(id, modeId, zoneId, JSON.stringify(actions));
    this.logger.info({ modeId, zoneId, actionCount: actions.length }, "Zone impact set");

    return { id, modeId, zoneId, actions };
  }

  removeZoneImpact(modeId: string, zoneId: string): void {
    this.stmts.deleteImpactByModeZone.run(modeId, zoneId);
    this.logger.info({ modeId, zoneId }, "Zone impact removed");
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
  group_name: string | null;
  active: number;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMode(row: ModeRow): Mode {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    group: row.group_name ?? undefined,
    active: row.active === 1,
    activatedAt: row.activated_at ? toISOUtc(row.activated_at) : undefined,
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
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

/** Spec 219 — trimmed group name, `null` for none; at most 50 characters. */
export const MODE_GROUP_MAX_LENGTH = 50;

function normalizeGroup(group: string | null | undefined): string | null {
  if (group === undefined || group === null) return null;
  if (typeof group !== "string") throw new ModeError("Mode group must be a string", 400);
  const trimmed = group.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MODE_GROUP_MAX_LENGTH) {
    throw new ModeError(`Mode group longer than ${MODE_GROUP_MAX_LENGTH} characters`, 400);
  }
  return trimmed;
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
