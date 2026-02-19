import type { FastifyInstance } from "fastify";
import type { ZoneManager } from "../../zones/zone-manager.js";
import type { GroupManager } from "../../zones/group-manager.js";
import type { Logger } from "../../core/logger.js";

interface ZonesDeps {
  zoneManager: ZoneManager;
  groupManager: GroupManager;
  logger: Logger;
}

export function registerZoneRoutes(app: FastifyInstance, deps: ZonesDeps): void {
  const { zoneManager, groupManager } = deps;

  // GET /api/v1/zones — List all zones as a tree
  app.get("/api/v1/zones", async () => {
    return zoneManager.getTree();
  });

  // GET /api/v1/zones/:id — Get zone with children and groups
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
  }>("/api/v1/zones", async (request, reply) => {
    const { name, parentId, icon, description, displayOrder } = request.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return reply.code(400).send({ error: "Name is required" });
    }
    if (name.length > 100) {
      return reply.code(400).send({ error: "Name must be 100 characters or less" });
    }
    if (description && description.length > 500) {
      return reply.code(400).send({ error: "Description must be 500 characters or less" });
    }

    try {
      const zone = zoneManager.create({ name: name.trim(), parentId, icon, description, displayOrder });
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
  }>("/api/v1/zones/:id", async (request, reply) => {
    const body = request.body ?? {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return reply.code(400).send({ error: "Name cannot be empty" });
      }
      if (body.name.length > 100) {
        return reply.code(400).send({ error: "Name must be 100 characters or less" });
      }
      body.name = body.name.trim();
    }
    if (body.description !== undefined && body.description !== null && body.description.length > 500) {
      return reply.code(400).send({ error: "Description must be 500 characters or less" });
    }

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

  // GET /api/v1/zones/:zoneId/groups — List groups in a zone
  app.get<{ Params: { zoneId: string } }>("/api/v1/zones/:zoneId/groups", async (request, reply) => {
    const zone = zoneManager.getById(request.params.zoneId);
    if (!zone) {
      return reply.code(404).send({ error: "Zone not found" });
    }
    return groupManager.getByZoneId(request.params.zoneId);
  });

  // POST /api/v1/zones/:zoneId/groups — Create group in a zone
  app.post<{
    Params: { zoneId: string };
    Body: {
      name: string;
      icon?: string;
      description?: string;
      displayOrder?: number;
    };
  }>("/api/v1/zones/:zoneId/groups", async (request, reply) => {
    const { name, icon, description, displayOrder } = request.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return reply.code(400).send({ error: "Name is required" });
    }
    if (name.length > 100) {
      return reply.code(400).send({ error: "Name must be 100 characters or less" });
    }

    try {
      const group = groupManager.create(request.params.zoneId, {
        name: name.trim(),
        icon,
        description,
        displayOrder,
      });
      return reply.code(201).send(group);
    } catch (err) {
      return handleGroupError(err, reply);
    }
  });

  // PUT /api/v1/groups/:id — Update group
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      icon?: string | null;
      description?: string | null;
      displayOrder?: number;
    };
  }>("/api/v1/groups/:id", async (request, reply) => {
    const body = request.body ?? {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return reply.code(400).send({ error: "Name cannot be empty" });
      }
      body.name = body.name.trim();
    }

    try {
      const group = groupManager.update(request.params.id, body);
      if (!group) {
        return reply.code(404).send({ error: "Group not found" });
      }
      return group;
    } catch (err) {
      return handleGroupError(err, reply);
    }
  });

  // DELETE /api/v1/groups/:id — Delete group
  app.delete<{ Params: { id: string } }>("/api/v1/groups/:id", async (request, reply) => {
    try {
      groupManager.delete(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handleGroupError(err, reply);
    }
  });
}

function handleZoneError(err: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (err && typeof err === "object" && "status" in err && "message" in err) {
    const zoneErr = err as { status: number; message: string };
    return reply.code(zoneErr.status).send({ error: zoneErr.message });
  }
  throw err;
}

function handleGroupError(err: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (err && typeof err === "object" && "status" in err && "message" in err) {
    const groupErr = err as { status: number; message: string };
    return reply.code(groupErr.status).send({ error: groupErr.message });
  }
  throw err;
}
