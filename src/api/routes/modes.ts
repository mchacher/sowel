import type { FastifyInstance } from "fastify";
import type { ModeManager } from "../../modes/mode-manager.js";
import { ModeError } from "../../modes/mode-manager.js";
import type { Logger } from "../../core/logger.js";
import type { ZoneModeImpactAction } from "../../shared/types.js";

interface ModesDeps {
  modeManager: ModeManager;
  logger: Logger;
}

export function registerModeRoutes(app: FastifyInstance, deps: ModesDeps): void {
  const { modeManager } = deps;

  // ── Modes CRUD ──────────────────────────────────────────

  // GET /api/v1/modes
  app.get("/api/v1/modes", async () => {
    return modeManager.listModesWithDetails();
  });

  // GET /api/v1/modes/:id
  app.get<{ Params: { id: string } }>("/api/v1/modes/:id", async (request, reply) => {
    const mode = modeManager.getModeWithDetails(request.params.id);
    if (!mode) return reply.code(404).send({ error: "Mode not found" });
    return mode;
  });

  // POST /api/v1/modes
  app.post<{
    Body: { name: string; icon?: string; description?: string };
  }>("/api/v1/modes", async (request, reply) => {
    const { name, icon, description } = request.body ?? {};
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      const mode = modeManager.createMode(name, icon, description);
      return reply.code(201).send(mode);
    } catch (err) {
      if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // PUT /api/v1/modes/:id
  app.put<{
    Params: { id: string };
    Body: { name?: string; icon?: string; description?: string };
  }>("/api/v1/modes/:id", async (request, reply) => {
    try {
      const mode = modeManager.updateMode(request.params.id, request.body ?? {});
      return mode;
    } catch (err) {
      if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /api/v1/modes/:id
  app.delete<{ Params: { id: string } }>("/api/v1/modes/:id", async (request, reply) => {
    try {
      modeManager.deleteMode(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // ── Activation ──────────────────────────────────────────

  // POST /api/v1/modes/:id/activate
  app.post<{ Params: { id: string } }>("/api/v1/modes/:id/activate", async (request, reply) => {
    try {
      modeManager.activateMode(request.params.id);
      return { ok: true };
    } catch (err) {
      if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /api/v1/modes/:id/deactivate
  app.post<{ Params: { id: string } }>("/api/v1/modes/:id/deactivate", async (request, reply) => {
    try {
      modeManager.deactivateMode(request.params.id);
      return { ok: true };
    } catch (err) {
      if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /api/v1/modes/:id/apply-to-zone/:zoneId
  app.post<{ Params: { id: string; zoneId: string } }>(
    "/api/v1/modes/:id/apply-to-zone/:zoneId",
    async (request, reply) => {
      try {
        modeManager.applyModeToZone(request.params.id, request.params.zoneId);
        return { ok: true };
      } catch (err) {
        if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // ── Event Triggers ──────────────────────────────────────

  // POST /api/v1/modes/:id/triggers
  app.post<{
    Params: { id: string };
    Body: { equipmentId: string; alias: string; value: unknown };
  }>("/api/v1/modes/:id/triggers", async (request, reply) => {
    const { equipmentId, alias, value } = request.body ?? {};
    if (!equipmentId || !alias) {
      return reply.code(400).send({ error: "equipmentId and alias are required" });
    }

    try {
      const trigger = modeManager.addEventTrigger(request.params.id, equipmentId, alias, value);
      return reply.code(201).send(trigger);
    } catch (err) {
      if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /api/v1/modes/:id/triggers/:triggerId
  app.delete<{ Params: { id: string; triggerId: string } }>(
    "/api/v1/modes/:id/triggers/:triggerId",
    async (request, reply) => {
      modeManager.removeEventTrigger(request.params.triggerId);
      return reply.code(204).send();
    },
  );

  // ── Zone Impacts ────────────────────────────────────────

  // GET /api/v1/zones/:zoneId/mode-impacts
  app.get<{ Params: { zoneId: string } }>("/api/v1/zones/:zoneId/mode-impacts", async (request) => {
    return modeManager.getImpactsByZone(request.params.zoneId);
  });

  // PUT /api/v1/modes/:id/impacts/:zoneId
  app.put<{
    Params: { id: string; zoneId: string };
    Body: { actions: ZoneModeImpactAction[] };
  }>("/api/v1/modes/:id/impacts/:zoneId", async (request, reply) => {
    const { actions } = request.body ?? {};
    if (!Array.isArray(actions)) {
      return reply.code(400).send({ error: "actions array is required" });
    }

    try {
      const impact = modeManager.setZoneImpact(request.params.id, request.params.zoneId, actions);
      return impact;
    } catch (err) {
      if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /api/v1/modes/:id/impacts/:zoneId
  app.delete<{ Params: { id: string; zoneId: string } }>(
    "/api/v1/modes/:id/impacts/:zoneId",
    async (request, reply) => {
      modeManager.removeZoneImpact(request.params.id, request.params.zoneId);
      return reply.code(204).send();
    },
  );
}
