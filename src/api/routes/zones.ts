import type { FastifyInstance } from "fastify";
import type { ZoneManager } from "../../zones/zone-manager.js";
import type { ZoneAggregator } from "../../zones/zone-aggregator.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { Logger } from "../../core/logger.js";
import { ROOT_ZONE_ID } from "../../shared/constants.js";
import { nameField, descriptionField } from "../schemas.js";

// Input schemas (issue #452) — same rules the handlers checked by hand:
// name required + non-blank + <=100, description <=500. Other fields
// (parentId, icon, displayOrder) stay unconstrained and pass through.
const createZoneBodySchema = {
  type: "object",
  required: ["name"],
  properties: { name: nameField, description: descriptionField },
};

// Allow a null/absent body: the old handler did `request.body ?? {}`, so a
// body-less PUT was a 200 no-op. `type: ["object", "null"]` keeps that.
const updateZoneBodySchema = {
  type: ["object", "null"],
  properties: { name: nameField, description: descriptionField },
};

interface ZonesDeps {
  zoneManager: ZoneManager;
  zoneAggregator: ZoneAggregator;
  equipmentManager: EquipmentManager;
  logger: Logger;
}

export function registerZoneRoutes(app: FastifyInstance, deps: ZonesDeps): void {
  const { zoneManager, zoneAggregator, equipmentManager } = deps;

  // GET /api/v1/zones — List all zones as a tree
  app.get("/api/v1/zones", async () => {
    return zoneManager.getTree();
  });

  // GET /api/v1/zones/aggregation — Get aggregated data for all zones
  app.get("/api/v1/zones/aggregation", async () => {
    return zoneAggregator.getAll();
  });

  // GET /api/v1/zones/:id — Get zone with children
  app.get<{ Params: { id: string } }>("/api/v1/zones/:id", async (request, reply) => {
    const zone = zoneManager.getByIdWithChildren(request.params.id);
    if (!zone) {
      return reply.code(404).send({ error: "Zone not found" });
    }
    return zone;
  });

  // POST /api/v1/zones — Create zone
  app.post<{
    Body: {
      name: string;
      parentId?: string | null;
      icon?: string;
      description?: string;
      displayOrder?: number;
    };
  }>("/api/v1/zones", { schema: { body: createZoneBodySchema } }, async (request, reply) => {
    const { name, parentId, icon, description, displayOrder } = request.body;

    try {
      const zone = zoneManager.create({
        name: name.trim(),
        parentId: parentId || ROOT_ZONE_ID,
        icon,
        description,
        displayOrder,
      });
      return reply.code(201).send(zone);
    } catch (err) {
      return handleZoneError(err, reply);
    }
  });

  // PUT /api/v1/zones/:id — Update zone
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      parentId?: string | null;
      icon?: string | null;
      description?: string | null;
      displayOrder?: number;
    };
  }>("/api/v1/zones/:id", { schema: { body: updateZoneBodySchema } }, async (request, reply) => {
    const body = request.body ?? {};

    // Schema validates name/description; keep the trim (business behaviour).
    if (body.name !== undefined) body.name = body.name.trim();

    try {
      const zone = zoneManager.update(request.params.id, body);
      if (!zone) {
        return reply.code(404).send({ error: "Zone not found" });
      }
      return zone;
    } catch (err) {
      return handleZoneError(err, reply);
    }
  });

  // DELETE /api/v1/zones/:id — Delete zone
  app.delete<{ Params: { id: string } }>("/api/v1/zones/:id", async (request, reply) => {
    try {
      zoneManager.delete(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handleZoneError(err, reply);
    }
  });

  // PUT /api/v1/zones/reorder — Reorder sibling zones
  app.put<{ Body: { parentId: string | null; orderedIds: string[] } }>(
    "/api/v1/zones/reorder",
    async (request, reply) => {
      try {
        const { parentId, orderedIds } = request.body;
        zoneManager.reorderSiblings(parentId, orderedIds);
        return reply.code(204).send();
      } catch (err) {
        return handleZoneError(err, reply);
      }
    },
  );
  // POST /api/v1/zones/:id/orders/:orderKey — Execute zone-level order
  app.post<{ Params: { id: string; orderKey: string }; Body: { value?: unknown } }>(
    "/api/v1/zones/:id/orders/:orderKey",
    async (request, reply) => {
      const { id, orderKey } = request.params;
      const body = (request.body ?? {}) as { value?: unknown };

      const zone = zoneManager.getById(id);
      if (!zone) {
        return reply.code(404).send({ error: "Zone not found" });
      }

      try {
        const zoneIds = zoneManager.getDescendantIds(id);
        const userId = request.auth?.userId ?? "anonymous";
        const result = await equipmentManager.executeZoneOrder(zoneIds, orderKey, body.value, {
          kind: "manual",
          userId,
        });
        return result;
      } catch (err) {
        return handleZoneError(err, reply);
      }
    },
  );
}

function handleZoneError(
  err: unknown,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
) {
  if (err && typeof err === "object" && "status" in err && "message" in err) {
    const zoneErr = err as { status: number; message: string };
    return reply.code(zoneErr.status).send({ error: zoneErr.message });
  }
  throw err;
}
