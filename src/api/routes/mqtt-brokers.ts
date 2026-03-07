import type { FastifyInstance } from "fastify";
import type { MqttBrokerManager } from "../../mqtt-publishers/mqtt-broker-manager.js";
import { MqttBrokerError } from "../../mqtt-publishers/mqtt-broker-manager.js";

interface MqttBrokersDeps {
  mqttBrokerManager: MqttBrokerManager;
}

export function registerMqttBrokerRoutes(app: FastifyInstance, deps: MqttBrokersDeps): void {
  const { mqttBrokerManager } = deps;

  // GET /api/v1/mqtt-brokers
  app.get("/api/v1/mqtt-brokers", async () => {
    return mqttBrokerManager.getAll();
  });

  // POST /api/v1/mqtt-brokers
  app.post<{
    Body: { name: string; url: string; username?: string; password?: string };
  }>("/api/v1/mqtt-brokers", async (request, reply) => {
    const { name, url, username, password } = request.body ?? {};
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!url) return reply.code(400).send({ error: "url is required" });

    try {
      const broker = mqttBrokerManager.create({ name, url, username, password });
      return reply.code(201).send(broker);
    } catch (err) {
      if (err instanceof MqttBrokerError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // PUT /api/v1/mqtt-brokers/:id
  app.put<{
    Params: { id: string };
    Body: { name?: string; url?: string; username?: string; password?: string };
  }>("/api/v1/mqtt-brokers/:id", async (request, reply) => {
    try {
      const broker = mqttBrokerManager.update(request.params.id, request.body ?? {});
      return broker;
    } catch (err) {
      if (err instanceof MqttBrokerError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

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
