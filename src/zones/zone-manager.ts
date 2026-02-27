import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import { toISOUtc } from "../core/database.js";
import type { Zone, ZoneWithChildren } from "../shared/types.js";
import { ROOT_ZONE_ID } from "../shared/constants.js";

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
      countChildren: this.db.prepare("SELECT COUNT(*) as count FROM zones WHERE parent_id = ?"),
      countEquipments: this.db.prepare(
        "SELECT COUNT(*) as count FROM equipments WHERE zone_id = ?",
      ),
      getSiblings: this.db.prepare(
        "SELECT id, display_order FROM zones WHERE parent_id IS ? ORDER BY display_order, name",
      ),
      getSiblingsNotNull: this.db.prepare(
        "SELECT id, display_order FROM zones WHERE parent_id = ? ORDER BY display_order, name",
      ),
      updateDisplayOrder: this.db.prepare(
        "UPDATE zones SET display_order = ?, updated_at = datetime('now') WHERE id = ?",
      ),
      reparentOrphanZones: this.db.prepare(
        "UPDATE zones SET parent_id = ? WHERE parent_id IS NULL AND id != ?",
      ),
    };
  }

  // ============================================================
  // Root zone bootstrap
  // ============================================================

  /**
   * Ensures the root zone "Maison" exists.
   * If it doesn't, creates it and reparents existing top-level zones under it.
   */
  ensureRootZone(): Zone {
    const existing = this.stmts.getZoneById.get(ROOT_ZONE_ID) as ZoneRow | undefined;
    if (existing) {
      // Reparent any orphan top-level zones under root (safety net)
      this.stmts.reparentOrphanZones.run(ROOT_ZONE_ID, ROOT_ZONE_ID);
      return rowToZone(existing);
    }

    this.stmts.insertZone.run({
      id: ROOT_ZONE_ID,
      name: "Maison",
      parentId: null,
      icon: "home",
      description: null,
      displayOrder: 0,
    });

    // Reparent existing top-level zones under the new root
    this.stmts.reparentOrphanZones.run(ROOT_ZONE_ID, ROOT_ZONE_ID);

    const zone = this.getById(ROOT_ZONE_ID)!;
    this.logger.info("Root zone 'Maison' created");
    return zone;
  }

  // ============================================================
  // Zone CRUD
  // ============================================================

  create(input: CreateZoneInput): Zone {
    const id = randomUUID();

    const parentId = input.parentId ?? null;

    // Validate parent exists if provided
    if (parentId) {
      const parent = this.stmts.getZoneById.get(parentId) as ZoneRow | undefined;
      if (!parent) {
        throw new ZoneError(`Parent zone not found: ${parentId}`, 404);
      }
    }

    this.stmts.insertZone.run({
      id,
      name: input.name,
      parentId,
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
   * Returns all zones as a tree structure with children.
   */
  getTree(): ZoneWithChildren[] {
    const zones = this.getAll();

    // Build tree
    const nodeMap = new Map<string, ZoneWithChildren>();
    for (const zone of zones) {
      nodeMap.set(zone.id, {
        ...zone,
        children: [],
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
   * Returns a single zone with its children.
   */
  getByIdWithChildren(id: string): ZoneWithChildren | null {
    const zone = this.getById(id);
    if (!zone) return null;

    const allZones = this.getAll();

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
          })),
      }));

    return {
      ...zone,
      children,
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
    if (id === ROOT_ZONE_ID) {
      throw new ZoneError("Cannot delete the root zone", 400);
    }

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

    // Guard: no equipments
    const equipmentCount = (this.stmts.countEquipments.get(id) as { count: number }).count;
    if (equipmentCount > 0) {
      throw new ZoneError(
        `Cannot delete zone with ${equipmentCount} equipment${equipmentCount > 1 ? "s" : ""}. Remove or move them first.`,
        400,
      );
    }

    this.stmts.deleteZone.run(id);
    this.logger.info({ zoneId: id, name: existing.name }, "Zone deleted");
    this.eventBus.emit({ type: "zone.removed", zoneId: id, zoneName: existing.name });
  }

  /**
   * Reorder zones within a parent. Pass an array of zone IDs in desired order.
   */
  reorderSiblings(parentId: string | null, orderedIds: string[]): void {
    const siblings =
      parentId === null
        ? (this.stmts.getSiblings.all(null) as { id: string }[])
        : (this.stmts.getSiblingsNotNull.all(parentId) as { id: string }[]);

    const siblingIds = new Set(siblings.map((s) => s.id));

    // Validate: all provided IDs must be siblings of this parent
    for (const id of orderedIds) {
      if (!siblingIds.has(id)) {
        throw new ZoneError(`Zone ${id} is not a child of parent ${parentId ?? "root"}`, 400);
      }
    }

    // Update display_order for each
    for (let i = 0; i < orderedIds.length; i++) {
      this.stmts.updateDisplayOrder.run(i, orderedIds[i]);
    }

    this.logger.info({ parentId, count: orderedIds.length }, "Zones reordered");
  }

  // ============================================================
  // Descendant collection (for zone commands)
  // ============================================================

  /**
   * Returns the given zone ID plus all descendant zone IDs (recursive).
   */
  getDescendantIds(zoneId: string): string[] {
    const all = this.getAll();
    const childrenOf = new Map<string, string[]>();
    for (const z of all) {
      if (z.parentId) {
        const list = childrenOf.get(z.parentId) ?? [];
        list.push(z.id);
        childrenOf.set(z.parentId, list);
      }
    }

    const result: string[] = [];
    const stack = [zoneId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      result.push(id);
      const children = childrenOf.get(id);
      if (children) stack.push(...children);
    }
    return result;
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
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
  };
}
