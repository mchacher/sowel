import type { FastifyInstance } from "fastify";
import type { MqttPublisherManager } from "../../mqtt-publishers/mqtt-publisher-manager.js";
import type { MqttPublishService } from "../../mqtt-publishers/mqtt-publish-service.js";
import { MqttPublisherError } from "../../mqtt-publishers/mqtt-publisher-manager.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { nonEmptyString } from "../schemas.js";

// Input schemas (issue #452). Old guards were bare `!x` (no trim), so
// nonEmptyString matches. Admin gating is an onRequest hook (runs before schema
// validation), so the 403-before-400 precedence holds. PUT had no validation
// (`request.body ?? {}`), so its schema stays permissive (object-or-null).
const createPublisherBodySchema = {
  type: "object",
  required: ["name", "brokerId", "topic"],
  properties: { name: nonEmptyString, brokerId: nonEmptyString, topic: nonEmptyString },
};

const updatePublisherBodySchema = { type: ["object", "null"] };

const addMappingBodySchema = {
  type: "object",
  required: ["publishKey", "sourceType", "sourceId", "sourceKey"],
  properties: {
    publishKey: nonEmptyString,
    sourceType: nonEmptyString,
    sourceId: nonEmptyString,
    sourceKey: nonEmptyString,
  },
};

interface MqttPublishersDeps {
  mqttPublisherManager: MqttPublisherManager;
  mqttPublishService: MqttPublishService;
}

export function registerMqttPublisherRoutes(app: FastifyInstance, deps: MqttPublishersDeps): void {
  const { mqttPublisherManager, mqttPublishService } = deps;

  // Admin only: publisher/mapping config is infrastructure — gate reads too.
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/v1/mqtt-publishers")) requireAdmin(request, reply);
  });

  // GET /api/v1/mqtt-publishers
  app.get("/api/v1/mqtt-publishers", async () => {
    return mqttPublisherManager.getAllWithMappings();
  });

  // GET /api/v1/mqtt-publishers/:id
  app.get<{ Params: { id: string } }>("/api/v1/mqtt-publishers/:id", async (request, reply) => {
    const publisher = mqttPublisherManager.getByIdWithMappings(request.params.id);
    if (!publisher) return reply.code(404).send({ error: "Publisher not found" });
    return publisher;
  });

  // POST /api/v1/mqtt-publishers
  app.post<{
    Body: {
      name: string;
      brokerId: string;
      topic: string;
      enabled?: boolean;
      onChangeOnly?: boolean;
    };
  }>(
    "/api/v1/mqtt-publishers",
    { schema: { body: createPublisherBodySchema } },
    async (request, reply) => {
      const { name, brokerId, topic, enabled, onChangeOnly } = request.body;

      try {
        const publisher = mqttPublisherManager.create({
          name,
          brokerId,
          topic,
          enabled,
          onChangeOnly,
        });
        return reply.code(201).send(publisher);
      } catch (err) {
        if (err instanceof MqttPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // PUT /api/v1/mqtt-publishers/:id
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      brokerId?: string;
      topic?: string;
      enabled?: boolean;
      onChangeOnly?: boolean;
    };
  }>(
    "/api/v1/mqtt-publishers/:id",
    { schema: { body: updatePublisherBodySchema } },
    async (request, reply) => {
      try {
        const publisher = mqttPublisherManager.update(request.params.id, request.body ?? {});
        return publisher;
      } catch (err) {
        if (err instanceof MqttPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // DELETE /api/v1/mqtt-publishers/:id
  app.delete<{ Params: { id: string } }>("/api/v1/mqtt-publishers/:id", async (request, reply) => {
    try {
      mqttPublisherManager.delete(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof MqttPublisherError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /api/v1/mqtt-publishers/:id/test
  app.post<{ Params: { id: string } }>(
    "/api/v1/mqtt-publishers/:id/test",
    async (request, reply) => {
      const publisher = mqttPublisherManager.getById(request.params.id);
      if (!publisher) return reply.code(404).send({ error: "Publisher not found" });

      const published = mqttPublishService.publishSnapshotForPublisher(request.params.id);
      return { published };
    },
  );

  // POST /api/v1/mqtt-publishers/:id/mappings
  app.post<{
    Params: { id: string };
    Body: {
      publishKey: string;
      sourceType: "equipment" | "zone" | "recipe";
      sourceId: string;
      sourceKey: string;
      enabled?: boolean;
    };
  }>(
    "/api/v1/mqtt-publishers/:id/mappings",
    { schema: { body: addMappingBodySchema } },
    async (request, reply) => {
      const { publishKey, sourceType, sourceId, sourceKey, enabled } = request.body;

      try {
        const mapping = mqttPublisherManager.addMapping(request.params.id, {
          publishKey,
          sourceType,
          sourceId,
          sourceKey,
          enabled,
        });
        return reply.code(201).send(mapping);
      } catch (err) {
        if (err instanceof MqttPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // PUT /api/v1/mqtt-publishers/:id/mappings/:mappingId
  app.put<{
    Params: { id: string; mappingId: string };
    Body: {
      publishKey?: string;
      sourceType?: "equipment" | "zone" | "recipe";
      sourceId?: string;
      sourceKey?: string;
      enabled?: boolean;
    };
  }>("/api/v1/mqtt-publishers/:id/mappings/:mappingId", async (request, reply) => {
    try {
      const mapping = mqttPublisherManager.updateMapping(
        request.params.id,
        request.params.mappingId,
        request.body ?? {},
      );
      return mapping;
    } catch (err) {
      if (err instanceof MqttPublisherError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /api/v1/mqtt-publishers/:id/mappings/:mappingId
  app.delete<{ Params: { id: string; mappingId: string } }>(
    "/api/v1/mqtt-publishers/:id/mappings/:mappingId",
    async (request, reply) => {
      try {
        mqttPublisherManager.removeMapping(request.params.id, request.params.mappingId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof MqttPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );
}
