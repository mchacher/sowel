import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentGroup } from "../shared/types.js";

interface CreateGroupInput {
  name: string;
  icon?: string;
  description?: string;
  displayOrder?: number;
}

interface UpdateGroupInput {
  name?: string;
  icon?: string | null;
  description?: string | null;
  displayOrder?: number;
}

export class GroupManager {
  private db: Database.Database;
  private logger: Logger;
  private eventBus: EventBus;
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(db: Database.Database, eventBus: EventBus, logger: Logger) {
    this.db = db;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "group-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insertGroup: this.db.prepare(
        `INSERT INTO equipment_groups (id, name, zone_id, icon, description, display_order)
         VALUES (@id, @name, @zoneId, @icon, @description, @displayOrder)`,
      ),
      getGroupById: this.db.prepare("SELECT * FROM equipment_groups WHERE id = ?"),
      getGroupsByZoneId: this.db.prepare(
        "SELECT * FROM equipment_groups WHERE zone_id = ? ORDER BY display_order, name",
      ),
      updateGroup: this.db.prepare(
        `UPDATE equipment_groups SET name = @name, icon = @icon,
         description = @description, display_order = @displayOrder,
         updated_at = datetime('now') WHERE id = @id`,
      ),
      deleteGroup: this.db.prepare("DELETE FROM equipment_groups WHERE id = ?"),
      zoneExists: this.db.prepare("SELECT id FROM zones WHERE id = ?"),
    };
  }

  create(zoneId: string, input: CreateGroupInput): EquipmentGroup {
    // Validate zone exists
    const zone = this.stmts.zoneExists.get(zoneId);
    if (!zone) {
      throw new GroupError(`Zone not found: ${zoneId}`, 404);
    }

    const id = randomUUID();

    this.stmts.insertGroup.run({
      id,
      name: input.name,
      zoneId,
      icon: input.icon ?? null,
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
    });

    const group = this.getById(id)!;
    this.logger.info({ groupId: id, name: input.name, zoneId }, "Group created");
    this.eventBus.emit({ type: "group.created", group });
    return group;
  }

  getById(id: string): EquipmentGroup | null {
    const row = this.stmts.getGroupById.get(id) as GroupRow | undefined;
    return row ? rowToGroup(row) : null;
  }

  getByZoneId(zoneId: string): EquipmentGroup[] {
    const rows = this.stmts.getGroupsByZoneId.all(zoneId) as GroupRow[];
    return rows.map(rowToGroup);
  }

  update(id: string, input: UpdateGroupInput): EquipmentGroup | null {
    const existing = this.stmts.getGroupById.get(id) as GroupRow | undefined;
    if (!existing) return null;

    this.stmts.updateGroup.run({
      id,
      name: input.name ?? existing.name,
      icon: input.icon !== undefined ? input.icon : existing.icon,
      description: input.description !== undefined ? input.description : existing.description,
      displayOrder: input.displayOrder ?? existing.display_order,
    });

    const group = this.getById(id)!;
    this.logger.info({ groupId: id, name: group.name }, "Group updated");
    this.eventBus.emit({ type: "group.updated", group });
    return group;
  }

  delete(id: string): void {
    const existing = this.getById(id);
    if (!existing) {
      throw new GroupError("Group not found", 404);
    }

    this.stmts.deleteGroup.run(id);
    this.logger.info({ groupId: id, name: existing.name }, "Group deleted");
    this.eventBus.emit({ type: "group.removed", groupId: id, groupName: existing.name });
  }
}

// ============================================================
// Custom error
// ============================================================

export class GroupError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GroupError";
    this.status = status;
  }
}

// ============================================================
// SQLite row types and mappers
// ============================================================

interface GroupRow {
  id: string;
  name: string;
  zone_id: string;
  icon: string | null;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

function rowToGroup(row: GroupRow): EquipmentGroup {
  return {
    id: row.id,
    name: row.name,
    zoneId: row.zone_id,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
