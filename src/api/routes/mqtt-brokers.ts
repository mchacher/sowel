import type { FastifyInstance } from "fastify";
import type { MqttBrokerManager } from "../../mqtt-publishers/mqtt-broker-manager.js";
import { MqttBrokerError } from "../../mqtt-publishers/mqtt-broker-manager.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { nonEmptyString } from "../schemas.js";

// Input schemas (issue #452). Old guards were bare `!name` / `!url` (no trim),
// so nonEmptyString matches. Admin gating is an onRequest hook, which runs
// before schema validation, so the 403-before-400 precedence is preserved.
// PUT had no validation and did `request.body ?? {}`, so its schema stays
// permissive (object-or-null) to keep the body-less 200 no-op.
const createBrokerBodySchema = {
  type: "object",
  required: ["name", "url"],
  properties: { name: nonEmptyString, url: nonEmptyString },
};

const updateBrokerBodySchema = { type: ["object", "null"] };

interface MqttBrokersDeps {
  mqttBrokerManager: MqttBrokerManager;
}

export function registerMqttBrokerRoutes(app: FastifyInstance, deps: MqttBrokersDeps): void {
  const { mqttBrokerManager } = deps;

  // Admin only: broker config carries plaintext passwords, so even the GET
  // reads must be gated (spec 131 — the mutation gate does not cover reads).
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/v1/mqtt-brokers")) requireAdmin(request, reply);
  });

  // GET /api/v1/mqtt-brokers
  app.get("/api/v1/mqtt-brokers", async () => {
    return mqttBrokerManager.getAll();
  });

  // POST /api/v1/mqtt-brokers
  app.post<{
    Body: { name: string; url: string; username?: string; password?: string };
  }>(
    "/api/v1/mqtt-brokers",
    { schema: { body: createBrokerBodySchema } },
    async (request, reply) => {
      const { name, url, username, password } = request.body;

      try {
        const broker = mqttBrokerManager.create({ name, url, username, password });
        return reply.code(201).send(broker);
      } catch (err) {
        if (err instanceof MqttBrokerError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // PUT /api/v1/mqtt-brokers/:id
  app.put<{
    Params: { id: string };
    Body: { name?: string; url?: string; username?: string; password?: string };
  }>(
    "/api/v1/mqtt-brokers/:id",
    { schema: { body: updateBrokerBodySchema } },
    async (request, reply) => {
      try {
        const broker = mqttBrokerManager.update(request.params.id, request.body ?? {});
        return broker;
      } catch (err) {
        if (err instanceof MqttBrokerError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // DELETE /api/v1/mqtt-brokers/:id
  app.delete<{ Params: { id: string } }>("/api/v1/mqtt-brokers/:id", async (request, reply) => {
    try {
      mqttBrokerManager.delete(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof MqttBrokerError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
}
