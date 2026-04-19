import type { FastifyInstance } from "fastify";
import type { NotificationPublisherManager } from "../../notifications/notification-publisher-manager.js";
import type { NotificationPublishService } from "../../notifications/notification-publish-service.js";
import { NotificationPublisherError } from "../../notifications/notification-publisher-manager.js";
import type { TelegramChannelConfig } from "../../shared/types.js";

interface NotificationPublishersDeps {
  notificationPublisherManager: NotificationPublisherManager;
  notificationPublishService: NotificationPublishService;
}

export function registerNotificationPublisherRoutes(
  app: FastifyInstance,
  deps: NotificationPublishersDeps,
): void {
  const { notificationPublisherManager, notificationPublishService } = deps;

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
      channelType: "telegram";
      channelConfig: TelegramChannelConfig;
      enabled?: boolean;
      alarmReminderMinutes?: number;
    };
  }>("/api/v1/notification-publishers", async (request, reply) => {
    const { name, channelType, channelConfig, enabled, alarmReminderMinutes } = request.body ?? {};
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!channelConfig?.botToken)
      return reply.code(400).send({ error: "channelConfig.botToken is required" });
    if (!channelConfig?.chatId)
      return reply.code(400).send({ error: "channelConfig.chatId is required" });

    try {
      const publisher = notificationPublisherManager.create({
        name,
        channelType: channelType ?? "telegram",
        channelConfig,
        enabled,
        alarmReminderMinutes,
      });
      return reply.code(201).send(publisher);
    } catch (err) {
      if (err instanceof NotificationPublisherError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // PUT /api/v1/notification-publishers/:id
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      channelType?: "telegram";
      channelConfig?: TelegramChannelConfig;
      enabled?: boolean;
      alarmReminderMinutes?: number;
    };
  }>("/api/v1/notification-publishers/:id", async (request, reply) => {
    try {
      const publisher = notificationPublisherManager.update(request.params.id, request.body ?? {});
      return publisher;
    } catch (err) {
      if (err instanceof NotificationPublisherError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

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
    };
  }>("/api/v1/notification-publishers/:id/mappings", async (request, reply) => {
    const { message, sourceType, sourceId, sourceKey, throttleMs } = request.body ?? {};
    if (!message) return reply.code(400).send({ error: "message is required" });
    if (!sourceType) return reply.code(400).send({ error: "sourceType is required" });
    if (!sourceId) return reply.code(400).send({ error: "sourceId is required" });
    if (!sourceKey) return reply.code(400).send({ error: "sourceKey is required" });

    try {
      const mapping = notificationPublisherManager.addMapping(request.params.id, {
        message,
        sourceType,
        sourceId,
        sourceKey,
        throttleMs,
      });
      return reply.code(201).send(mapping);
    } catch (err) {
      if (err instanceof NotificationPublisherError)
        return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // PUT /api/v1/notification-publishers/:id/mappings/:mappingId
  app.put<{
    Params: { id: string; mappingId: string };
    Body: {
      message?: string;
      sourceType?: "equipment" | "zone" | "recipe";
      sourceId?: string;
      sourceKey?: string;
      throttleMs?: number;
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
