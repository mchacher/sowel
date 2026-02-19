import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { Zone, ZoneWithChildren, EquipmentGroup } from "../shared/types.js";

interface CreateZoneInput {
  name: string;
  parentId?: string | null;
  icon?: string;
  description?: string;
  displayOrder?: number;
}

interface UpdateZoneInput {
  name?: string;
  parentId?: string | null;
  icon?: string | null;
  description?: string | null;
  displayOrder?: number;
}

export class ZoneManager {
  private db: Database.Database;
  private logger: Logger;
  private eventBus: EventBus;
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(db: Database.Database, eventBus: EventBus, logger: Logger) {
    this.db = db;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "zone-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insertZone: this.db.prepare(
        `INSERT INTO zones (id, name, parent_id, icon, description, display_order)
         VALUES (@id, @name, @parentId, @icon, @description, @displayOrder)`,
      ),
      getZoneById: this.db.prepare("SELECT * FROM zones WHERE id = ?"),
      getAllZones: this.db.prepare("SELECT * FROM zones ORDER BY display_order, name"),
      updateZone: this.db.prepare(
        `UPDATE zones SET name = @name, parent_id = @parentId, icon = @icon,
         description = @description, display_order = @displayOrder,
         updated_at = datetime('now') WHERE id = @id`,
      ),
      deleteZone: this.db.prepare("DELETE FROM zones WHERE id = ?"),
      countChildren: this.db.prepare(
        "SELECT COUNT(*) as count FROM zones WHERE parent_id = ?",
      ),
      countGroups: this.db.prepare(
        "SELECT COUNT(*) as count FROM equipment_groups WHERE zone_id = ?",
      ),
      getGroupsByZoneId: this.db.prepare(
        "SELECT * FROM equipment_groups WHERE zone_id = ? ORDER BY display_order, name",
      ),
      getAllGroups: this.db.prepare(
        "SELECT * FROM equipment_groups ORDER BY display_order, name",
      ),
    };
  }

  // ============================================================
  // Zone CRUD
  // ============================================================

  create(input: CreateZoneInput): Zone {
    const id = randomUUID();

    // Validate parent exists if provided
    if (input.parentId) {
      const parent = this.stmts.getZoneById.get(input.parentId) as ZoneRow | undefined;
      if (!parent) {
        throw new ZoneError(`Parent zone not found: ${input.parentId}`, 404);
      }
    }

    this.stmts.insertZone.run({
      id,
      name: input.name,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
    });

    const zone = this.getById(id)!;
    this.logger.info({ zoneId: id, name: input.name }, "Zone created");
    this.eventBus.emit({ type: "zone.created", zone });
    return zone;
  }

  getById(id: string): Zone | null {
    const row = this.stmts.getZoneById.get(id) as ZoneRow | undefined;
    return row ? rowToZone(row) : null;
  }

  getAll(): Zone[] {
    const rows = this.stmts.getAllZones.all() as ZoneRow[];
    return rows.map(rowToZone);
  }

  /**
   * Returns all zones as a tree structure with children and groups.
   */
  getTree(): ZoneWithChildren[] {
    const zones = this.getAll();
    const groups = (this.stmts.getAllGroups.all() as GroupRow[]).map(rowToGroup);

    // Index groups by zoneId
    const groupsByZone = new Map<string, EquipmentGroup[]>();
    for (const group of groups) {
      const list = groupsByZone.get(group.zoneId) ?? [];
      list.push(group);
      groupsByZone.set(group.zoneId, list);
    }

    // Build tree
    const nodeMap = new Map<string, ZoneWithChildren>();
    for (const zone of zones) {
      nodeMap.set(zone.id, {
        ...zone,
        children: [],
        groups: groupsByZone.get(zone.id) ?? [],
      });
    }

    const roots: ZoneWithChildren[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Returns a single zone with its children and groups.
   */
  getByIdWithChildren(id: string): ZoneWithChildren | null {
    const zone = this.getById(id);
    if (!zone) return null;

    const allZones = this.getAll();
    const groups = (this.stmts.getGroupsByZoneId.all(id) as GroupRow[]).map(rowToGroup);

    // Get direct children
    const children: ZoneWithChildren[] = allZones
      .filter((z) => z.parentId === id)
      .map((child) => ({
        ...child,
        children: allZones
          .filter((z) => z.parentId === child.id)
          .map((grandchild) => ({
            ...grandchild,
            children: [],
            groups: (this.stmts.getGroupsByZoneId.all(grandchild.id) as GroupRow[]).map(rowToGroup),
          })),
        groups: (this.stmts.getGroupsByZoneId.all(child.id) as GroupRow[]).map(rowToGroup),
      }));

    return {
      ...zone,
      children,
      groups,
    };
  }

  update(id: string, input: UpdateZoneInput): Zone | null {
    const existing = this.stmts.getZoneById.get(id) as ZoneRow | undefined;
    if (!existing) return null;

    // If changing parentId, validate
    const newParentId = input.parentId !== undefined ? input.parentId : existing.parent_id;
    if (newParentId) {
      // Parent must exist
      const parent = this.stmts.getZoneById.get(newParentId) as ZoneRow | undefined;
      if (!parent) {
        throw new ZoneError(`Parent zone not found: ${newParentId}`, 404);
      }
      // Cannot be own parent
      if (newParentId === id) {
        throw new ZoneError("A zone cannot be its own parent", 400);
      }
      // Check for circular reference
      if (this.wouldCreateCycle(id, newParentId)) {
        throw new ZoneError("Moving this zone would create a circular reference", 400);
      }
    }

    this.stmts.updateZone.run({
      id,
      name: input.name ?? existing.name,
      parentId: input.parentId !== undefined ? input.parentId : existing.parent_id,
      icon: input.icon !== undefined ? input.icon : existing.icon,
      description: input.description !== undefined ? input.description : existing.description,
      displayOrder: input.displayOrder ?? existing.display_order,
    });

    const zone = this.getById(id)!;
    this.logger.info({ zoneId: id, name: zone.name }, "Zone updated");
    this.eventBus.emit({ type: "zone.updated", zone });
    return zone;
  }

  delete(id: string): void {
    const existing = this.getById(id);
    if (!existing) {
      throw new ZoneError("Zone not found", 404);
    }

    // Guard: no children
    const childCount = (this.stmts.countChildren.get(id) as { count: number }).count;
    if (childCount > 0) {
      throw new ZoneError(
        `Cannot delete zone with ${childCount} child zone${childCount > 1 ? "s" : ""}. Remove or move them first.`,
        400,
      );
    }

    // Guard: no groups
    const groupCount = (this.stmts.countGroups.get(id) as { count: number }).count;
    if (groupCount > 0) {
      throw new ZoneError(
        `Cannot delete zone with ${groupCount} group${groupCount > 1 ? "s" : ""}. Remove them first.`,
        400,
      );
    }

    this.stmts.deleteZone.run(id);
    this.logger.info({ zoneId: id, name: existing.name }, "Zone deleted");
    this.eventBus.emit({ type: "zone.removed", zoneId: id, zoneName: existing.name });
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Check if setting `zoneId`'s parent to `newParentId` would create a cycle.
   * Walks up from newParentId — if we reach zoneId, it's a cycle.
   */
  private wouldCreateCycle(zoneId: string, newParentId: string): boolean {
    let currentId: string | null = newParentId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === zoneId) return true;
      if (visited.has(currentId)) return false; // Already visited (broken chain)
      visited.add(currentId);

      const row = this.stmts.getZoneById.get(currentId) as ZoneRow | undefined;
      currentId = row?.parent_id ?? null;
    }

    return false;
  }
}

// ============================================================
// Custom error
// ============================================================

export class ZoneError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ZoneError";
    this.status = status;
  }
}

// ============================================================
// SQLite row types and mappers
// ============================================================

interface ZoneRow {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

function rowToZone(row: ZoneRow): Zone {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
