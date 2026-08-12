import type { FastifyInstance } from "fastify";
import type { NotificationPublisherManager } from "../../notifications/notification-publisher-manager.js";
import type { NotificationPublishService } from "../../notifications/notification-publish-service.js";
import { NotificationPublisherError } from "../../notifications/notification-publisher-manager.js";
import type { NotificationChannelType, NotificationChannelConfig } from "../../shared/types.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { nonEmptyString } from "../schemas.js";

// Input schemas (issue #452). Old guards were bare `!x` (no trim), so
// nonEmptyString matches. Admin gating is an onRequest hook (runs before schema
// validation), preserving 403-before-400. The POST publisher only checked
// `!name` (channelType/channelConfig are defaulted in the handler), so only
// `name` is constrained. PUT had no validation, so its schema stays permissive.
const createPublisherBodySchema = {
  type: "object",
  required: ["name"],
  properties: { name: nonEmptyString },
};

const updatePublisherBodySchema = { type: ["object", "null"] };

const addMappingBodySchema = {
  type: "object",
  required: ["message", "sourceType", "sourceId", "sourceKey"],
  properties: {
    message: nonEmptyString,
    sourceType: nonEmptyString,
    sourceId: nonEmptyString,
    sourceKey: nonEmptyString,
  },
};

interface NotificationPublishersDeps {
  notificationPublisherManager: NotificationPublisherManager;
  notificationPublishService: NotificationPublishService;
}

export function registerNotificationPublisherRoutes(
  app: FastifyInstance,
  deps: NotificationPublishersDeps,
): void {
  const { notificationPublisherManager, notificationPublishService } = deps;

  // Admin only: channel config carries secrets (Telegram botToken, webhook
  // URLs), so even the GET reads must be gated (spec 131).
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/v1/notification-publishers")) requireAdmin(request, reply);
  });

  // GET /api/v1/notification-publishers
  app.get("/api/v1/notification-publishers", async () => {
    return notificationPublisherManager.getAllWithMappings();
  });

  // GET /api/v1/notification-publishers/:id
  app.get<{ Params: { id: string } }>(
    "/api/v1/notification-publishers/:id",
    async (request, reply) => {
      const publisher = notificationPublisherManager.getByIdWithMappings(request.params.id);
      if (!publisher) return reply.code(404).send({ error: "Publisher not found" });
      return publisher;
    },
  );

  // POST /api/v1/notification-publishers
  app.post<{
    Body: {
      name: string;
      channelType: NotificationChannelType;
      channelConfig: NotificationChannelConfig;
      enabled?: boolean;
    };
  }>(
    "/api/v1/notification-publishers",
    { schema: { body: createPublisherBodySchema } },
    async (request, reply) => {
      const { name, channelType, channelConfig, enabled } = request.body;

      try {
        const publisher = notificationPublisherManager.create({
          name,
          channelType: channelType ?? "telegram",
          channelConfig: channelConfig ?? ({} as NotificationChannelConfig),
          enabled,
        });
        return reply.code(201).send(publisher);
      } catch (err) {
        if (err instanceof NotificationPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // PUT /api/v1/notification-publishers/:id
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      channelType?: NotificationChannelType;
      channelConfig?: NotificationChannelConfig;
      enabled?: boolean;
    };
  }>(
    "/api/v1/notification-publishers/:id",
    { schema: { body: updatePublisherBodySchema } },
    async (request, reply) => {
      try {
        const publisher = notificationPublisherManager.update(
          request.params.id,
          request.body ?? {},
        );
        return publisher;
      } catch (err) {
        if (err instanceof NotificationPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // DELETE /api/v1/notification-publishers/:id
  app.delete<{ Params: { id: string } }>(
    "/api/v1/notification-publishers/:id",
    async (request, reply) => {
      try {
        notificationPublisherManager.delete(request.params.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof NotificationPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // POST /api/v1/notification-publishers/:id/test-channel
  app.post<{ Params: { id: string } }>(
    "/api/v1/notification-publishers/:id/test-channel",
    async (request, reply) => {
      try {
        await notificationPublishService.testChannel(request.params.id);
        return { success: true };
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : "Test failed",
        });
      }
    },
  );

  // POST /api/v1/notification-publishers/:id/test
  app.post<{ Params: { id: string } }>(
    "/api/v1/notification-publishers/:id/test",
    async (request, reply) => {
      try {
        const sent = await notificationPublishService.testPublisher(request.params.id);
        return { sent };
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : "Test failed",
        });
      }
    },
  );

  // POST /api/v1/notification-publishers/:id/mappings
  app.post<{
    Params: { id: string };
    Body: {
      message: string;
      sourceType: "equipment" | "zone" | "recipe";
      sourceId: string;
      sourceKey: string;
      throttleMs?: number;
      repeatMs?: number | null;
      repeatMax?: number | null;
    };
  }>(
    "/api/v1/notification-publishers/:id/mappings",
    { schema: { body: addMappingBodySchema } },
    async (request, reply) => {
      const { message, sourceType, sourceId, sourceKey, throttleMs, repeatMs, repeatMax } =
        request.body;

      try {
        const mapping = notificationPublisherManager.addMapping(request.params.id, {
          message,
          sourceType,
          sourceId,
          sourceKey,
          throttleMs,
          repeatMs,
          repeatMax,
        });
        return reply.code(201).send(mapping);
      } catch (err) {
        if (err instanceof NotificationPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // PUT /api/v1/notification-publishers/:id/mappings/:mappingId
  app.put<{
    Params: { id: string; mappingId: string };
    Body: {
      message?: string;
      sourceType?: "equipment" | "zone" | "recipe";
      sourceId?: string;
      sourceKey?: string;
      throttleMs?: number;
      repeatMs?: number | null;
      repeatMax?: number | null;
    };
  }>("/api/v1/notification-publishers/:id/mappings/:mappingId", async (request, reply) => {
    try {
      const mapping = notificationPublisherManager.updateMapping(
        request.params.id,
        request.params.mappingId,
        request.body ?? {},
      );
      return mapping;
    } catch (err) {
      if (err instanceof NotificationPublisherError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /api/v1/notification-publishers/:id/mappings/:mappingId
  app.delete<{ Params: { id: string; mappingId: string } }>(
    "/api/v1/notification-publishers/:id/mappings/:mappingId",
    async (request, reply) => {
      try {
        notificationPublisherManager.removeMapping(request.params.id, request.params.mappingId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof NotificationPublisherError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );
}
