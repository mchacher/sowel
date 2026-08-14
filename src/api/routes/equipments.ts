import type { FastifyInstance } from "fastify";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import { EquipmentError } from "../../equipments/equipment-manager.js";
import type { EnergyLoadProfile, EquipmentType } from "../../shared/types.js";
import type { Logger } from "../../core/logger.js";

interface EquipmentsDeps {
  equipmentManager: EquipmentManager;
  logger: Logger;
}

// Input schemas (issue #452). They encode the same rules the handlers checked
// by hand: name required and non-blank (<=100), type/zoneId required,
// description <=500, and the energy-profile bounds. Unknown fields stay
// unconstrained (additionalProperties defaults to allowed), so extra keys pass
// through and are ignored, exactly as before. The energyProfile rounding and
// the core-owned `learned` merge stay in the handler — they are business logic,
// not validation.
const createEquipmentBodySchema = {
  type: "object",
  required: ["name", "type", "zoneId"],
  properties: {
    name: { type: "string", pattern: "\\S", maxLength: 100 },
    type: { type: "string", minLength: 1 },
    zoneId: { type: "string", minLength: 1 },
    // null is allowed (create with no description), matching the old check that
    // only rejected an over-long non-empty string.
    description: { type: ["string", "null"], maxLength: 500 },
  },
};

const updateEquipmentBodySchema = {
  type: "object",
  properties: {
    name: { type: "string", pattern: "\\S", maxLength: 100 },
    description: { type: ["string", "null"], maxLength: 500 },
    energyProfile: {
      type: ["object", "null"],
      required: ["class", "nominalPowerW", "minOnS", "minOffS"],
      properties: {
        class: { enum: ["comfort", "deferrable"] },
        nominalPowerW: { type: "number", exclusiveMinimum: 0, maximum: 30000 },
        minOnS: { type: "number", minimum: 0 },
        minOffS: { type: "number", minimum: 0 },
      },
    },
    requireConfirmation: { type: "boolean" },
  },
};

// Binding bodies (issue #452). Old guards: `!deviceDataId` / `!deviceOrderId`
// (bare truthiness, so minLength 1) and `!alias?.trim()` (rejects a blank or
// whitespace-only alias). The alias uses a `\S` pattern (a non-blank char) but,
// unlike name, NO maxLength — the old check never capped its length. The handler
// keeps `alias.trim()` normalization.
const nonBlankAlias = { type: "string", pattern: "\\S" };
const addDataBindingBodySchema = {
  type: "object",
  required: ["deviceDataId", "alias"],
  properties: { deviceDataId: { type: "string", minLength: 1 }, alias: nonBlankAlias },
};
const addOrderBindingBodySchema = {
  type: "object",
  required: ["deviceOrderId", "alias"],
  properties: { deviceOrderId: { type: "string", minLength: 1 }, alias: nonBlankAlias },
};

export function registerEquipmentRoutes(app: FastifyInstance, deps: EquipmentsDeps): void {
  const { equipmentManager } = deps;

  // GET /api/v1/equipments — List all equipments with bindings and current data.
  // Optional ?type=<EquipmentType> narrows the response to a single type
  // (e.g. ?type=energy_meter for clients that only render submeter clamps).
  // Unknown values yield an empty list rather than 400 so callers can
  // safely pass-through user input without their own validation.
  app.get<{ Querystring: { type?: string } }>("/api/v1/equipments", async (request) => {
    const all = equipmentManager.getAllWithDetails();
    const typeFilter = request.query.type;
    return typeFilter ? all.filter((eq) => eq.type === typeFilter) : all;
  });

  // GET /api/v1/equipments/:id — Get equipment with bindings and current data
  app.get<{ Params: { id: string } }>("/api/v1/equipments/:id", async (request, reply) => {
    const equipment = equipmentManager.getByIdWithDetails(request.params.id);
    if (!equipment) {
      return reply.code(404).send({ error: "Equipment not found" });
    }
    return equipment;
  });

  // POST /api/v1/equipments — Create equipment (with optional auto-binding from devices)
  app.post<{
    Body: {
      name: string;
      type: EquipmentType;
      zoneId: string;
      icon?: string;
      description?: string;
      deviceIds?: string[];
    };
  }>(
    "/api/v1/equipments",
    { schema: { body: createEquipmentBodySchema } },
    async (request, reply) => {
      const { name, type, zoneId, icon, description, deviceIds } = request.body;

      try {
        if (deviceIds && deviceIds.length > 0) {
          const equipment = equipmentManager.createWithAutoBindings({
            name: name.trim(),
            type,
            zoneId,
            icon,
            description,
            deviceIds,
          });
          return reply.code(201).send(equipment);
        }

        const equipment = equipmentManager.create({
          name: name.trim(),
          type,
          zoneId,
          icon,
          description,
        });
        return reply.code(201).send(equipment);
      } catch (err) {
        return handleEquipmentError(reply, err);
      }
    },
  );

  // PUT /api/v1/equipments/:id — Update equipment
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      type?: EquipmentType;
      zoneId?: string;
      icon?: string | null;
      description?: string | null;
      enabled?: boolean;
      energyProfile?: EnergyLoadProfile | null;
      requireConfirmation?: boolean;
    };
  }>(
    "/api/v1/equipments/:id",
    { schema: { body: updateEquipmentBodySchema } },
    async (request, reply) => {
      const body = request.body ?? {};

      // Spec 140 — the schema validates the flexible-load declaration; round the
      // values and merge back the core-owned `learned` field, which is stripped
      // from user writes.
      if (body.energyProfile !== undefined && body.energyProfile !== null) {
        const p = body.energyProfile;
        const existing = equipmentManager.getById(request.params.id);
        body.energyProfile = {
          class: p.class,
          nominalPowerW: Math.round(p.nominalPowerW),
          minOnS: Math.round(p.minOnS),
          minOffS: Math.round(p.minOffS),
          learned: existing?.energyProfile?.learned,
        };
      }

      try {
        const equipment = equipmentManager.update(request.params.id, {
          name: body.name?.trim(),
          type: body.type,
          zoneId: body.zoneId,
          icon: body.icon,
          description: body.description,
          enabled: body.enabled,
          energyProfile: body.energyProfile,
          requireConfirmation: body.requireConfirmation,
        });
        if (!equipment) {
          return reply.code(404).send({ error: "Equipment not found" });
        }
        return equipment;
      } catch (err) {
        return handleEquipmentError(reply, err);
      }
    },
  );

  // DELETE /api/v1/equipments/:id — Delete equipment
  app.delete<{ Params: { id: string } }>("/api/v1/equipments/:id", async (request, reply) => {
    try {
      equipmentManager.delete(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

  // POST /api/v1/equipments/:id/orders/:alias — Execute equipment order
  app.post<{
    Params: { id: string; alias: string };
    Body: { value: unknown };
  }>("/api/v1/equipments/:id/orders/:alias", async (request, reply) => {
    const { value } = request.body ?? {};

    try {
      const userId = request.auth?.userId ?? "anonymous";
      const result = await equipmentManager.executeOrder(
        request.params.id,
        request.params.alias,
        value,
        { kind: "manual", userId },
      );
      if (!result.success) {
        return reply.code(502).send({ error: result.error });
      }
      return { success: true };
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

  // ============================================================
  // DataBinding routes
  // ============================================================

  // POST /api/v1/equipments/:id/data-bindings — Add a DataBinding
  app.post<{
    Params: { id: string };
    Body: { deviceDataId: string; alias: string };
  }>(
    "/api/v1/equipments/:id/data-bindings",
    { schema: { body: addDataBindingBodySchema } },
    async (request, reply) => {
      const { deviceDataId, alias } = request.body;

      try {
        const binding = equipmentManager.addDataBinding(
          request.params.id,
          deviceDataId,
          alias.trim(),
        );
        return reply.code(201).send(binding);
      } catch (err) {
        return handleEquipmentError(reply, err);
      }
    },
  );

  // DELETE /api/v1/equipments/:id/data-bindings/:bindingId — Remove a DataBinding
  app.delete<{
    Params: { id: string; bindingId: string };
  }>("/api/v1/equipments/:id/data-bindings/:bindingId", async (request, reply) => {
    try {
      equipmentManager.removeDataBinding(request.params.id, request.params.bindingId);
      return reply.code(204).send();
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

  // ============================================================
  // OrderBinding routes
  // ============================================================

  // POST /api/v1/equipments/:id/order-bindings — Add an OrderBinding
  app.post<{
    Params: { id: string };
    Body: { deviceOrderId: string; alias: string };
  }>(
    "/api/v1/equipments/:id/order-bindings",
    { schema: { body: addOrderBindingBodySchema } },
    async (request, reply) => {
      const { deviceOrderId, alias } = request.body;

      try {
        const binding = equipmentManager.addOrderBinding(
          request.params.id,
          deviceOrderId,
          alias.trim(),
        );
        return reply.code(201).send(binding);
      } catch (err) {
        return handleEquipmentError(reply, err);
      }
    },
  );

  // DELETE /api/v1/equipments/:id/order-bindings/:bindingId — Remove an OrderBinding
  app.delete<{
    Params: { id: string; bindingId: string };
  }>("/api/v1/equipments/:id/order-bindings/:bindingId", async (request, reply) => {
    try {
      equipmentManager.removeOrderBinding(request.params.id, request.params.bindingId);
      return reply.code(204).send();
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });
}

function handleEquipmentError(
  reply: { code: (c: number) => { send: (b: unknown) => unknown } },
  err: unknown,
) {
  if (err instanceof EquipmentError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}
