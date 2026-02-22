import type { FastifyInstance } from "fastify";
import type { ButtonActionManager } from "../../buttons/button-action-manager.js";
import type { Logger } from "../../core/logger.js";
import type { ButtonEffectType } from "../../shared/types.js";

const VALID_EFFECT_TYPES: ButtonEffectType[] = [
  "mode_activate",
  "mode_toggle",
  "equipment_order",
  "recipe_toggle",
];

export function registerButtonActionRoutes(
  app: FastifyInstance,
  deps: { buttonActionManager: ButtonActionManager; logger: Logger },
): void {
  const { buttonActionManager } = deps;

  // GET /api/v1/equipments/:id/action-bindings
  app.get<{ Params: { id: string } }>("/api/v1/equipments/:id/action-bindings", async (request) => {
    return buttonActionManager.getBindingsByEquipment(request.params.id);
  });

  // POST /api/v1/equipments/:id/action-bindings
  app.post<{
    Params: { id: string };
    Body: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> };
  }>("/api/v1/equipments/:id/action-bindings", async (request, reply) => {
    const { actionValue, effectType, config } = request.body ?? {};

    if (!actionValue || !effectType) {
      return reply.code(400).send({ error: "actionValue and effectType are required" });
    }
    if (!VALID_EFFECT_TYPES.includes(effectType)) {
      return reply
        .code(400)
        .send({ error: `Invalid effectType. Must be one of: ${VALID_EFFECT_TYPES.join(", ")}` });
    }

    const binding = buttonActionManager.addBinding(
      request.params.id,
      actionValue,
      effectType,
      config ?? {},
    );
    return reply.code(201).send(binding);
  });

  // PUT /api/v1/equipments/:id/action-bindings/:bindingId
  app.put<{
    Params: { id: string; bindingId: string };
    Body: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> };
  }>("/api/v1/equipments/:id/action-bindings/:bindingId", async (request, reply) => {
    const { actionValue, effectType, config } = request.body ?? {};

    if (!actionValue || !effectType) {
      return reply.code(400).send({ error: "actionValue and effectType are required" });
    }
    if (!VALID_EFFECT_TYPES.includes(effectType)) {
      return reply
        .code(400)
        .send({ error: `Invalid effectType. Must be one of: ${VALID_EFFECT_TYPES.join(", ")}` });
    }

    const binding = buttonActionManager.updateBinding(
      request.params.bindingId,
      actionValue,
      effectType,
      config ?? {},
    );
    return reply.send(binding);
  });

  // DELETE /api/v1/equipments/:id/action-bindings/:bindingId
  app.delete<{ Params: { id: string; bindingId: string } }>(
    "/api/v1/equipments/:id/action-bindings/:bindingId",
    async (_request, reply) => {
      buttonActionManager.removeBinding(_request.params.bindingId);
      return reply.code(204).send();
    },
  );
}
