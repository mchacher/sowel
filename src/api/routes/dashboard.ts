import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { toISOUtc } from "../../core/database.js";
import type { DashboardWidget, WidgetConfig, WidgetFamily } from "../../shared/types.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { nonEmptyString } from "../schemas.js";

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

const VALID_FAMILIES = ["lights", "shutters", "heating", "sensors"] as const;

// ── Body schemas (#597, #482 Lot C) ─────────────────────────────────────
//
// Deferred from #482 because the create body is conditional: `equipmentId` is
// required iff `type === "equipment"`, `zoneId` and `family` iff
// `type === "zone"`. `if`/`then` expresses that. What a schema cannot express
// is the existence lookup, so "Equipment not found" stays in the handler, and
// keeps its original 400 rather than becoming a 404: #482 converts shape
// checks, it does not renumber answers a client may already depend on.
//
// `additionalProperties` is left at its default so unknown fields are ignored
// exactly as they were.
//
// NOTE for the OpenAPI track (#481): @fastify/swagger emits 3.0.3 here, which
// defines neither `if`/`then` nor `type: [..., "null"]` (3.0 wants
// `nullable: true`). A codegen consumer will drop or choke on this requestBody
// until the document moves to 3.1.
const widgetCreateSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: ["equipment", "zone"] },
    equipmentId: nonEmptyString,
    zoneId: nonEmptyString,
    family: { enum: [...VALID_FAMILIES] },
    // Nullable on purpose. The old code type-checked neither, and stored
    // `label ?? null`, so an explicit null was accepted and meant "no label".
    // Rejecting it here would be an undeclared behaviour change on a field the
    // conversion is not about.
    label: { type: ["string", "null"] },
    icon: { type: ["string", "null"] },
  },
  allOf: [
    {
      if: { properties: { type: { const: "equipment" } }, required: ["type"] },
      then: { required: ["equipmentId"] },
    },
    {
      if: { properties: { type: { const: "zone" } }, required: ["type"] },
      then: { required: ["zoneId", "family"] },
    },
  ],
} as const;

// Every field is optional and nullable: `undefined` means "leave alone" and
// `null` means "clear", a distinction the handler reads and the schema keeps.
// `config` is an opaque object the route only stringifies.
const widgetPatchSchema = {
  // `["object", "null"]`, not `"object"`: a PATCH with no body at all used to
  // answer 200 with the widget unchanged, and a client polling a widget's
  // current state with a bare `curl -X PATCH` would otherwise start getting a
  // 400 about a body it never sent.
  type: ["object", "null"],
  properties: {
    label: { type: ["string", "null"] },
    icon: { type: ["string", "null"] },
    config: { type: ["object", "null"] },
  },
} as const;

// TIGHTENING, deliberate: `items` was previously unconstrained, so
// `{ order: [1, 2] }` reached the UPDATE and silently matched no row. An
// element that is not a widget id was never meaningful here.
const widgetOrderSchema = {
  type: "object",
  required: ["order"],
  properties: { order: { type: "array", items: nonEmptyString } },
} as const;

export function registerDashboardRoutes(app: FastifyInstance, deps: DashboardDeps): void {
  const { db } = deps;

  // Every write is admin-only; GET is not. The hook runs before body-schema
  // validation, so 403 still precedes 400 for a non-admin sending a malformed
  // body. Bounded to the widget paths and to non-GET methods so it can neither
  // over-match a sibling route nor lock out the read.
  app.addHook("onRequest", async (request, reply) => {
    // HEAD as well as GET: Fastify auto-exposes a HEAD route for every GET, so
    // gating it would break a cheap liveness probe for a standard user that
    // could read the list a moment earlier.
    //
    // Exempting a METHOD makes this guard fail-open where the global one
    // (isMutationDeniedForStandard) is fail-closed. It is a decision about
    // THIS route, whose GET is deliberately open to everyone, not a template:
    // a future admin-only GET under this prefix would need naming here.
    if (request.method === "GET" || request.method === "HEAD") return;
    const path = request.url.split("?")[0];
    if (path === "/api/v1/dashboard/widgets" || path.startsWith("/api/v1/dashboard/widgets/")) {
      requireAdmin(request, reply);
    }
  });

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
  }>(
    "/api/v1/dashboard/widgets",
    { schema: { body: widgetCreateSchema } },
    async (request, reply) => {
      const { type, equipmentId, zoneId, family, label, icon } = request.body;

      // The schema has settled the shape by here; what is left is existence,
      // which it cannot express. Both keep their original 400.
      if (type === "equipment") {
        const eq = db.prepare("SELECT id FROM equipments WHERE id = ?").get(equipmentId);
        if (!eq) {
          return reply.code(400).send({ error: "Equipment not found" });
        }
      }

      if (type === "zone") {
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
    },
  );

  // PATCH /api/v1/dashboard/widgets/:id — Update label, icon (admin only)
  app.patch<{
    Params: { id: string };
    Body: { label?: string | null; icon?: string | null; config?: WidgetConfig | null };
  }>(
    "/api/v1/dashboard/widgets/:id",
    {
      schema: { body: widgetPatchSchema },
      // preValidation runs before body validation, so a PATCH against a widget
      // that does not exist still answers 404 rather than complaining about the
      // shape of a body nobody will read.
      preValidation: async (request, reply) => {
        const params = request.params as { id: string };
        const row = db.prepare("SELECT id FROM dashboard_widgets WHERE id = ?").get(params.id);
        if (!row) {
          return reply.code(404).send({ error: "Widget not found" });
        }
      },
    },
    async (request, reply) => {
      // Re-read rather than trust the hook's row: an event-loop turn separates
      // them, every DB call here is synchronous, and a concurrent DELETE in
      // that window would otherwise crash on an undefined row. Two admin tabs,
      // one deleting while the other renames, is all it takes. The hook is
      // still what gives 404 its precedence over the schema 400; this is the
      // race guard.
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
        return reply.send(rowToWidget(existing));
      }

      values.push(request.params.id);
      db.prepare(`UPDATE dashboard_widgets SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      const row = db
        .prepare("SELECT * FROM dashboard_widgets WHERE id = ?")
        .get(request.params.id) as WidgetRow | undefined;
      if (!row) {
        return reply.code(404).send({ error: "Widget not found" });
      }
      return reply.send(rowToWidget(row));
    },
  );

  // DELETE /api/v1/dashboard/widgets/:id — Delete a widget (admin only)
  app.delete<{ Params: { id: string } }>(
    "/api/v1/dashboard/widgets/:id",
    async (request, reply) => {
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
  }>(
    "/api/v1/dashboard/widgets/order",
    { schema: { body: widgetOrderSchema } },
    async (request) => {
      const { order } = request.body;

      const updateStmt = db.prepare("UPDATE dashboard_widgets SET display_order = ? WHERE id = ?");
      const reorder = db.transaction(() => {
        for (let i = 0; i < order.length; i++) {
          updateStmt.run(i, order[i]);
        }
      });
      reorder();

      return { ok: true };
    },
  );
}
