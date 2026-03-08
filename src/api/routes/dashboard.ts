import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { toISOUtc } from "../../core/database.js";
import type { DashboardWidget, WidgetConfig, WidgetFamily } from "../../shared/types.js";

interface DashboardDeps {
  db: Database.Database;
}

interface WidgetRow {
  id: string;
  type: string;
  label: string | null;
  icon: string | null;
  equipment_id: string | null;
  zone_id: string | null;
  family: string | null;
  config: string | null;
  display_order: number;
  created_at: string;
}

function rowToWidget(row: WidgetRow): DashboardWidget {
  const widget: DashboardWidget = {
    id: row.id,
    type: row.type as "equipment" | "zone",
    displayOrder: row.display_order,
    createdAt: toISOUtc(row.created_at),
  };
  if (row.label) widget.label = row.label;
  if (row.icon) widget.icon = row.icon;
  if (row.equipment_id) widget.equipmentId = row.equipment_id;
  if (row.zone_id) widget.zoneId = row.zone_id;
  if (row.family) widget.family = row.family as WidgetFamily;
  if (row.config) {
    try {
      widget.config = JSON.parse(row.config) as WidgetConfig;
    } catch {
      /* ignore bad JSON */
    }
  }
  return widget;
}

const VALID_FAMILIES = new Set(["lights", "shutters", "heating", "sensors"]);

export function registerDashboardRoutes(app: FastifyInstance, deps: DashboardDeps): void {
  const { db } = deps;

  // GET /api/v1/dashboard/widgets — List all widgets ordered by displayOrder
  app.get("/api/v1/dashboard/widgets", async () => {
    const rows = db
      .prepare("SELECT * FROM dashboard_widgets ORDER BY display_order ASC, created_at ASC")
      .all() as WidgetRow[];
    return rows.map(rowToWidget);
  });

  // POST /api/v1/dashboard/widgets — Create a widget (admin only)
  app.post<{
    Body: {
      type: "equipment" | "zone";
      equipmentId?: string;
      zoneId?: string;
      family?: WidgetFamily;
      label?: string;
      icon?: string;
    };
  }>("/api/v1/dashboard/widgets", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const { type, equipmentId, zoneId, family, label, icon } = request.body ?? {};

    if (type !== "equipment" && type !== "zone") {
      return reply.code(400).send({ error: "type must be 'equipment' or 'zone'" });
    }

    if (type === "equipment") {
      if (!equipmentId) {
        return reply.code(400).send({ error: "equipmentId is required for equipment widgets" });
      }
      // Verify equipment exists
      const eq = db.prepare("SELECT id FROM equipments WHERE id = ?").get(equipmentId);
      if (!eq) {
        return reply.code(400).send({ error: "Equipment not found" });
      }
    }

    if (type === "zone") {
      if (!zoneId) {
        return reply.code(400).send({ error: "zoneId is required for zone widgets" });
      }
      if (!family || !VALID_FAMILIES.has(family)) {
        return reply
          .code(400)
          .send({ error: "family must be one of: lights, shutters, heating, sensors" });
      }
      // Verify zone exists
      const z = db.prepare("SELECT id FROM zones WHERE id = ?").get(zoneId);
      if (!z) {
        return reply.code(400).send({ error: "Zone not found" });
      }
    }

    // Get next display_order
    const maxRow = db
      .prepare("SELECT COALESCE(MAX(display_order), -1) AS max_order FROM dashboard_widgets")
      .get() as { max_order: number };
    const nextOrder = maxRow.max_order + 1;

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO dashboard_widgets (id, type, label, icon, equipment_id, zone_id, family, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      type,
      label ?? null,
      icon ?? null,
      type === "equipment" ? equipmentId! : null,
      type === "zone" ? zoneId! : null,
      type === "zone" ? family! : null,
      nextOrder,
    );

    const row = db.prepare("SELECT * FROM dashboard_widgets WHERE id = ?").get(id) as WidgetRow;
    return reply.code(201).send(rowToWidget(row));
  });

  // PATCH /api/v1/dashboard/widgets/:id — Update label, icon (admin only)
  app.patch<{
    Params: { id: string };
    Body: { label?: string | null; icon?: string | null; config?: WidgetConfig | null };
  }>("/api/v1/dashboard/widgets/:id", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const existing = db
      .prepare("SELECT * FROM dashboard_widgets WHERE id = ?")
      .get(request.params.id) as WidgetRow | undefined;
    if (!existing) {
      return reply.code(404).send({ error: "Widget not found" });
    }

    const { label, icon, config } = request.body ?? {};
    const updates: string[] = [];
    const values: unknown[] = [];

    if (label !== undefined) {
      updates.push("label = ?");
      values.push(label);
    }
    if (icon !== undefined) {
      updates.push("icon = ?");
      values.push(icon);
    }
    if (config !== undefined) {
      updates.push("config = ?");
      values.push(config ? JSON.stringify(config) : null);
    }

    if (updates.length === 0) {
      return rowToWidget(existing);
    }

    values.push(request.params.id);
    db.prepare(`UPDATE dashboard_widgets SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const row = db
      .prepare("SELECT * FROM dashboard_widgets WHERE id = ?")
      .get(request.params.id) as WidgetRow;
    return rowToWidget(row);
  });

  // DELETE /api/v1/dashboard/widgets/:id — Delete a widget (admin only)
  app.delete<{ Params: { id: string } }>(
    "/api/v1/dashboard/widgets/:id",
    async (request, reply) => {
      if (!request.auth || request.auth.role !== "admin") {
        return reply.code(403).send({ error: "Admin access required" });
      }

      const result = db
        .prepare("DELETE FROM dashboard_widgets WHERE id = ?")
        .run(request.params.id);
      if (result.changes === 0) {
        return reply.code(404).send({ error: "Widget not found" });
      }
      return reply.code(204).send();
    },
  );

  // PUT /api/v1/dashboard/widgets/order — Reorder widgets (admin only)
  app.put<{
    Body: { order: string[] };
  }>("/api/v1/dashboard/widgets/order", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const { order } = request.body ?? {};
    if (!Array.isArray(order)) {
      return reply.code(400).send({ error: "order must be an array of widget IDs" });
    }

    const updateStmt = db.prepare("UPDATE dashboard_widgets SET display_order = ? WHERE id = ?");
    const reorder = db.transaction(() => {
      for (let i = 0; i < order.length; i++) {
        updateStmt.run(i, order[i]);
      }
    });
    reorder();

    return { ok: true };
  });
}
