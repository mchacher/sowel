import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import {
  type AttributionTarget,
  EvSessionError,
  type EvSessionTracker,
} from "../../energy/ev-sessions/ev-session-tracker.js";
import { localDateStr } from "../../shared/local-date.js";
import { nonEmptyString } from "../schemas.js";

interface EvSessionRouteDeps {
  evSessionTracker: EvSessionTracker;
  logger: Logger;
}

const monthPattern = "^\\d{4}-(0[1-9]|1[0-2])$";

/** Spec 191 — EV charge sessions and the cost of charging per vehicle. */
export function registerEvSessionRoutes(app: FastifyInstance, deps: EvSessionRouteDeps): void {
  const { evSessionTracker: tracker } = deps;
  const logger = deps.logger.child({ module: "ev-sessions-api" });
  const thisMonth = () => localDateStr().slice(0, 7);

  // GET /api/v1/ev-sessions?chargerId=…|vehicleId=…&month=YYYY-MM
  // A charger lists every session; a vehicle only those attributed to it.
  app.get<{ Querystring: { chargerId?: string; vehicleId?: string; month?: string } }>(
    "/api/v1/ev-sessions",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            chargerId: nonEmptyString,
            vehicleId: nonEmptyString,
            month: { type: "string", pattern: monthPattern },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { chargerId, vehicleId } = request.query;
      if ((chargerId === undefined) === (vehicleId === undefined)) {
        return reply.code(400).send({ error: "Give exactly one of chargerId or vehicleId" });
      }
      const month = request.query.month ?? thisMonth();
      const sessions =
        chargerId !== undefined
          ? tracker.listByCharger(chargerId, month)
          : tracker.listByVehicle(vehicleId!, month);
      return { sessions: sessions ?? [] };
    },
  );

  // GET /api/v1/ev-sessions/summary?vehicleId=…&month=YYYY-MM
  app.get<{ Querystring: { vehicleId: string; month?: string } }>(
    "/api/v1/ev-sessions/summary",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["vehicleId"],
          properties: {
            vehicleId: nonEmptyString,
            month: { type: "string", pattern: monthPattern },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      return tracker.summary(request.query.vehicleId, request.query.month ?? thisMonth());
    },
  );

  // PUT /api/v1/ev-sessions/:id/attribution — any role (spec 191 P8); final.
  // One flat schema, not a `oneOf`: Fastify's validator strips additional
  // properties per branch, so a `oneOf` drops `vehicleId` before the handler.
  app.put<{
    Params: { id: string };
    Body: { target: AttributionTarget["target"]; vehicleId?: string };
  }>(
    "/api/v1/ev-sessions/:id/attribution",
    {
      schema: {
        body: {
          type: "object",
          required: ["target"],
          properties: {
            target: { enum: ["vehicle", "other", "unattributed"] },
            vehicleId: nonEmptyString,
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { target, vehicleId } = request.body;
      if ((target === "vehicle") !== (vehicleId !== undefined)) {
        return reply.code(400).send({ error: "vehicleId goes with target vehicle, and only it" });
      }
      const choice: AttributionTarget =
        target === "vehicle" ? { target, vehicleId: vehicleId! } : { target };
      try {
        return tracker.setAttribution(request.params.id, choice);
      } catch (err) {
        if (err instanceof EvSessionError) {
          return reply.code(err.code === "not-found" ? 404 : 400).send({ error: err.message });
        }
        logger.error({ err, sessionId: request.params.id }, "EV session attribution failed");
        return reply.code(500).send({ error: "Attribution failed" });
      }
    },
  );
}
