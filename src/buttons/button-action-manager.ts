import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { ModeManager } from "../modes/mode-manager.js";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { Logger } from "../core/logger.js";
import { toISOUtc } from "../core/database.js";
import type { ButtonActionBinding, ButtonEffectType } from "../shared/types.js";

export class ButtonActionManager {
  private readonly log;
  private readonly stmts;

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    private readonly equipmentManager: EquipmentManager,
    private readonly modeManager: ModeManager,
    private readonly recipeManager: RecipeManager,
    logger: Logger,
  ) {
    this.log = logger.child({ module: "button-action-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(
        `INSERT INTO button_action_bindings (id, equipment_id, action_value, effect_type, config)
         VALUES (?, ?, ?, ?, ?)`,
      ),
      delete: this.db.prepare(`DELETE FROM button_action_bindings WHERE id = ?`),
      getByEquipment: this.db.prepare(
        `SELECT * FROM button_action_bindings WHERE equipment_id = ? ORDER BY created_at`,
      ),
      listAll: this.db.prepare(`SELECT * FROM button_action_bindings`),
    };
  }

  // ── Init ──────────────────────────────────────────────────

  init(): void {
    this.eventBus.on((event) => {
      if (event.type === "equipment.data.changed" && event.alias === "action") {
        try {
          this.handleActionEvent(event.equipmentId, event.value);
        } catch (err) {
          this.log.error({ err, equipmentId: event.equipmentId }, "Error handling button action");
        }
      }
    });

    const bindings = this.stmts.listAll.all() as ButtonActionBindingRow[];
    if (bindings.length > 0) {
      this.log.info({ count: bindings.length }, "Button action bindings loaded");
    }
  }

  // ── CRUD ──────────────────────────────────────────────────

  addBinding(
    equipmentId: string,
    actionValue: string,
    effectType: ButtonEffectType,
    config: Record<string, unknown>,
  ): ButtonActionBinding {
    const id = randomUUID();
    this.stmts.insert.run(id, equipmentId, actionValue, effectType, JSON.stringify(config));
    this.log.info(
      { bindingId: id, equipmentId, actionValue, effectType },
      "Button action binding added",
    );

    const row = this.db
      .prepare(`SELECT * FROM button_action_bindings WHERE id = ?`)
      .get(id) as ButtonActionBindingRow;
    return rowToBinding(row);
  }

  removeBinding(bindingId: string): void {
    this.stmts.delete.run(bindingId);
    this.log.info({ bindingId }, "Button action binding removed");
  }

  getBindingsByEquipment(equipmentId: string): ButtonActionBinding[] {
    const rows = this.stmts.getByEquipment.all(equipmentId) as ButtonActionBindingRow[];
    return rows.map(rowToBinding);
  }

  // ── Effect Execution ──────────────────────────────────────

  private handleActionEvent(equipmentId: string, value: unknown): void {
    const rows = this.stmts.getByEquipment.all(equipmentId) as ButtonActionBindingRow[];
    const actionValue = String(value);

    for (const row of rows) {
      if (row.action_value !== actionValue) continue;

      const config = JSON.parse(row.config) as Record<string, unknown>;
      this.log.info(
        { bindingId: row.id, equipmentId, actionValue, effectType: row.effect_type },
        "Button action binding matched",
      );

      try {
        this.executeEffect(row.effect_type as ButtonEffectType, config);
      } catch (err) {
        this.log.warn(
          { err, bindingId: row.id, effectType: row.effect_type },
          "Failed to execute button action effect",
        );
      }
    }
  }

  private executeEffect(effectType: ButtonEffectType, config: Record<string, unknown>): void {
    switch (effectType) {
      case "mode_activate": {
        const modeId = config.modeId as string;
        this.modeManager.activateMode(modeId);
        break;
      }

      case "mode_toggle": {
        const modeAId = config.modeAId as string;
        const modeBId = config.modeBId as string;
        const modeA = this.modeManager.getMode(modeAId);

        if (modeA?.active) {
          this.modeManager.deactivateMode(modeAId);
          this.modeManager.activateMode(modeBId);
        } else {
          if (modeBId) {
            const modeB = this.modeManager.getMode(modeBId);
            if (modeB?.active) {
              this.modeManager.deactivateMode(modeBId);
            }
          }
          this.modeManager.activateMode(modeAId);
        }
        break;
      }

      case "equipment_order": {
        const targetEquipmentId = config.equipmentId as string;
        const orderAlias = config.orderAlias as string;
        const orderValue = config.value;
        this.equipmentManager.executeOrder(targetEquipmentId, orderAlias, orderValue);
        break;
      }

      case "recipe_toggle": {
        const instanceId = config.instanceId as string;
        const enabled = config.enabled as boolean;
        if (enabled) {
          this.recipeManager.enableInstance(instanceId);
        } else {
          this.recipeManager.disableInstance(instanceId);
        }
        break;
      }
    }
  }
}

// ── Row types & mappers ──────────────────────────────────────

interface ButtonActionBindingRow {
  id: string;
  equipment_id: string;
  action_value: string;
  effect_type: string;
  config: string;
  created_at: string;
}

function rowToBinding(row: ButtonActionBindingRow): ButtonActionBinding {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    actionValue: row.action_value,
    effectType: row.effect_type as ButtonEffectType,
    config: JSON.parse(row.config) as Record<string, unknown>,
    createdAt: toISOUtc(row.created_at),
  };
}
