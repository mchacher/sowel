import type { FastifyInstance } from "fastify";
import type { MqttPublisherManager } from "../../mqtt-publishers/mqtt-publisher-manager.js";
import type { MqttPublishService } from "../../mqtt-publishers/mqtt-publish-service.js";
import { MqttPublisherError } from "../../mqtt-publishers/mqtt-publisher-manager.js";

interface MqttPublishersDeps {
  mqttPublisherManager: MqttPublisherManager;
  mqttPublishService: MqttPublishService;
}

export function registerMqttPublisherRoutes(app: FastifyInstance, deps: MqttPublishersDeps): void {
  const { mqttPublisherManager, mqttPublishService } = deps;

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
    Body: { name: string; topic: string; enabled?: boolean };
  }>("/api/v1/mqtt-publishers", async (request, reply) => {
    const { name, topic, enabled } = request.body ?? {};
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!topic) return reply.code(400).send({ error: "topic is required" });

    try {
      const publisher = mqttPublisherManager.create({ name, topic, enabled });
      return reply.code(201).send(publisher);
    } catch (err) {
      if (err instanceof MqttPublisherError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // PUT /api/v1/mqtt-publishers/:id
  app.put<{
    Params: { id: string };
    Body: { name?: string; topic?: string; enabled?: boolean };
  }>("/api/v1/mqtt-publishers/:id", async (request, reply) => {
    try {
      const publisher = mqttPublisherManager.update(request.params.id, request.body ?? {});
      return publisher;
    } catch (err) {
      if (err instanceof MqttPublisherError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

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
    };
  }>("/api/v1/mqtt-publishers/:id/mappings", async (request, reply) => {
    const { publishKey, sourceType, sourceId, sourceKey } = request.body ?? {};
    if (!publishKey) return reply.code(400).send({ error: "publishKey is required" });
    if (!sourceType) return reply.code(400).send({ error: "sourceType is required" });
    if (!sourceId) return reply.code(400).send({ error: "sourceId is required" });
    if (!sourceKey) return reply.code(400).send({ error: "sourceKey is required" });

    try {
      const mapping = mqttPublisherManager.addMapping(request.params.id, {
        publishKey,
        sourceType,
        sourceId,
        sourceKey,
      });
      return reply.code(201).send(mapping);
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
