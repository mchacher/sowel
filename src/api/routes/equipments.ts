import type { FastifyInstance } from "fastify";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import { EquipmentError } from "../../equipments/equipment-manager.js";
import type { EquipmentType } from "../../shared/types.js";
import type { Logger } from "../../core/logger.js";

interface EquipmentsDeps {
  equipmentManager: EquipmentManager;
  logger: Logger;
}

export function registerEquipmentRoutes(app: FastifyInstance, deps: EquipmentsDeps): void {
  const { equipmentManager } = deps;

  // GET /api/v1/equipments — List all equipments with bindings and current data
  app.get("/api/v1/equipments", async () => {
    return equipmentManager.getAllWithDetails();
  });

  // GET /api/v1/equipments/:id — Get equipment with bindings and current data
  app.get<{ Params: { id: string } }>("/api/v1/equipments/:id", async (request, reply) => {
    const equipment = equipmentManager.getByIdWithDetails(request.params.id);
    if (!equipment) {
      return reply.code(404).send({ error: "Equipment not found" });
    }
    return equipment;
  });

  // POST /api/v1/equipments — Create equipment
  app.post<{
    Body: {
      name: string;
      type: EquipmentType;
      zoneId: string;
      icon?: string;
      description?: string;
    };
  }>("/api/v1/equipments", async (request, reply) => {
    const { name, type, zoneId, icon, description } = request.body ?? {};

    if (!name?.trim()) {
      return reply.code(400).send({ error: "Name is required" });
    }
    if (name.length > 100) {
      return reply.code(400).send({ error: "Name must be 100 characters or less" });
    }
    if (!type) {
      return reply.code(400).send({ error: "Type is required" });
    }
    if (!zoneId) {
      return reply.code(400).send({ error: "Zone ID is required" });
    }
    if (description && description.length > 500) {
      return reply.code(400).send({ error: "Description must be 500 characters or less" });
    }

    try {
      const equipment = equipmentManager.create({ name: name.trim(), type, zoneId, icon, description });
      return reply.code(201).send(equipment);
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

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
    };
  }>("/api/v1/equipments/:id", async (request, reply) => {
    const body = request.body ?? {};

    if (body.name !== undefined && !body.name.trim()) {
      return reply.code(400).send({ error: "Name cannot be empty" });
    }
    if (body.name && body.name.length > 100) {
      return reply.code(400).send({ error: "Name must be 100 characters or less" });
    }
    if (body.description && body.description.length > 500) {
      return reply.code(400).send({ error: "Description must be 500 characters or less" });
    }

    try {
      const equipment = equipmentManager.update(request.params.id, {
        name: body.name?.trim(),
        type: body.type,
        zoneId: body.zoneId,
        icon: body.icon,
        description: body.description,
        enabled: body.enabled,
      });
      if (!equipment) {
        return reply.code(404).send({ error: "Equipment not found" });
      }
      return equipment;
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

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
      equipmentManager.executeOrder(request.params.id, request.params.alias, value);
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
  }>("/api/v1/equipments/:id/data-bindings", async (request, reply) => {
    const { deviceDataId, alias } = request.body ?? {};

    if (!deviceDataId) {
      return reply.code(400).send({ error: "deviceDataId is required" });
    }
    if (!alias?.trim()) {
      return reply.code(400).send({ error: "alias is required" });
    }

    try {
      const binding = equipmentManager.addDataBinding(request.params.id, deviceDataId, alias.trim());
      return reply.code(201).send(binding);
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

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
  }>("/api/v1/equipments/:id/order-bindings", async (request, reply) => {
    const { deviceOrderId, alias } = request.body ?? {};

    if (!deviceOrderId) {
      return reply.code(400).send({ error: "deviceOrderId is required" });
    }
    if (!alias?.trim()) {
      return reply.code(400).send({ error: "alias is required" });
    }

    try {
      const binding = equipmentManager.addOrderBinding(request.params.id, deviceOrderId, alias.trim());
      return reply.code(201).send(binding);
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

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

function handleEquipmentError(reply: { code: (c: number) => { send: (b: unknown) => unknown } }, err: unknown) {
  if (err instanceof EquipmentError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}
