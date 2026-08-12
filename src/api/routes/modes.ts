import type { FastifyInstance } from "fastify";
import type { ModeManager } from "../../modes/mode-manager.js";
import { ModeError } from "../../modes/mode-manager.js";
import type { ButtonActionManager } from "../../buttons/button-action-manager.js";
import type { Logger } from "../../core/logger.js";
import type { AuditLogger } from "../../core/audit-logger.js";
import type { UserManager } from "../../auth/user-manager.js";
import type { ZoneModeImpactAction } from "../../shared/types.js";
import { buildActor } from "../audit-context.js";
import { nonEmptyString } from "../schemas.js";

// Input schemas (issue #452): POST requires a non-empty name (old `!name`, no
// trim, so "   " is accepted); the impacts PUT requires an `actions` array
// (old `!Array.isArray(actions)`). Other fields pass through unconstrained.
const createModeBodySchema = {
  type: "object",
  required: ["name"],
  properties: { name: nonEmptyString },
};

const setZoneImpactBodySchema = {
  type: "object",
  required: ["actions"],
  properties: { actions: { type: "array" } },
};

interface ModesDeps {
  modeManager: ModeManager;
  buttonActionManager?: ButtonActionManager;
  auditLogger: AuditLogger;
  userManager: UserManager;
  logger: Logger;
}

export function registerModeRoutes(app: FastifyInstance, deps: ModesDeps): void {
  const { modeManager, auditLogger, userManager } = deps;

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
  }>("/api/v1/modes", { schema: { body: createModeBodySchema } }, async (request, reply) => {
    const { name, icon, description } = request.body;

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
      const mode = modeManager.getMode(request.params.id);
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "mode.activate",
        targetType: "mode",
        targetId: request.params.id,
        ip: request.ip,
        meta: { modeName: mode?.name ?? null },
      });
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
      const mode = modeManager.getMode(request.params.id);
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "mode.deactivate",
        targetType: "mode",
        targetId: request.params.id,
        ip: request.ip,
        meta: { modeName: mode?.name ?? null },
      });
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

  // ── Zone Impacts ────────────────────────────────────────

  // GET /api/v1/zones/:zoneId/mode-impacts
  app.get<{ Params: { zoneId: string } }>("/api/v1/zones/:zoneId/mode-impacts", async (request) => {
    return modeManager.getImpactsByZone(request.params.zoneId);
  });

  // PUT /api/v1/modes/:id/impacts/:zoneId
  app.put<{
    Params: { id: string; zoneId: string };
    Body: { actions: ZoneModeImpactAction[] };
  }>(
    "/api/v1/modes/:id/impacts/:zoneId",
    { schema: { body: setZoneImpactBodySchema } },
    async (request, reply) => {
      const { actions } = request.body;

      try {
        const impact = modeManager.setZoneImpact(request.params.id, request.params.zoneId, actions);
        return impact;
      } catch (err) {
        if (err instanceof ModeError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // DELETE /api/v1/modes/:id/impacts/:zoneId
  app.delete<{ Params: { id: string; zoneId: string } }>(
    "/api/v1/modes/:id/impacts/:zoneId",
    async (request, reply) => {
      modeManager.removeZoneImpact(request.params.id, request.params.zoneId);
      return reply.code(204).send();
    },
  );

  // ── Triggers ──────────────────────────────────────────

  // GET /api/v1/modes/:id/triggers — button bindings that reference this mode
  app.get<{ Params: { id: string } }>("/api/v1/modes/:id/triggers", async (request) => {
    if (!deps.buttonActionManager) return [];
    return deps.buttonActionManager.getBindingsByMode(request.params.id);
  });
}
