import type { FastifyInstance } from "fastify";
import {
  PUSH_LABEL_MAX_LENGTH,
  type PushSubscriptionManager,
} from "../../notifications/push-subscription-manager.js";
import type { VapidKeys } from "../../notifications/vapid.js";

interface PushDeps {
  pushSubscriptionManager: PushSubscriptionManager;
  vapidKeys: VapidKeys;
}

// A subscription needs a non-empty endpoint and both browser keys. `minLength:1`
// (with coerceTypes:false, issue #452) rejects empty strings exactly like the
// old `!endpoint || !keys?.p256dh || !keys?.auth` check. Authentication stays
// enforced by the global auth middleware (runs before schema validation).
const pushSubscriptionBodySchema = {
  type: "object",
  required: ["endpoint", "keys"],
  properties: {
    endpoint: { type: "string", minLength: 1 },
    keys: {
      type: "object",
      required: ["p256dh", "auth"],
      properties: {
        p256dh: { type: "string", minLength: 1 },
        auth: { type: "string", minLength: 1 },
      },
    },
    userAgent: { type: "string" },
  },
} as const;

const pushUnsubscribeBodySchema = {
  type: "object",
  required: ["endpoint"],
  properties: { endpoint: { type: "string", minLength: 1 } },
} as const;

// Spec 199 — rename one of the caller's devices. null or "" clears the name.
const pushRenameBodySchema = {
  type: "object",
  required: ["label"],
  properties: {
    label: { type: ["string", "null"], maxLength: PUSH_LABEL_MAX_LENGTH },
  },
} as const;

// ============================================================
// Web Push subscription routes (spec 127)
// ============================================================

export function registerPushRoutes(app: FastifyInstance, deps: PushDeps): void {
  const { pushSubscriptionManager, vapidKeys } = deps;

  // GET /api/v1/push/vapid-public-key — the public key the browser subscribes with.
  app.get("/api/v1/push/vapid-public-key", async () => ({ publicKey: vapidKeys.publicKey }));

  // GET /api/v1/push/subscriptions — the current user's device subscriptions.
  app.get("/api/v1/push/subscriptions", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
    return pushSubscriptionManager.listByUser(request.auth.userId);
  });

  // POST /api/v1/push/subscriptions — register/upsert this device's subscription.
  app.post<{
    Body: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string };
  }>(
    "/api/v1/push/subscriptions",
    { schema: { body: pushSubscriptionBodySchema } },
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
      const { endpoint, keys, userAgent } = request.body;
      const subscription = pushSubscriptionManager.upsert(request.auth.userId, {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
      });
      return reply.code(201).send(subscription);
    },
  );

  // DELETE /api/v1/push/subscriptions — remove this device's subscription.
  app.delete<{ Body: { endpoint: string } }>(
    "/api/v1/push/subscriptions",
    { schema: { body: pushUnsubscribeBodySchema } },
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
      const { endpoint } = request.body;
      pushSubscriptionManager.deleteByEndpoint(endpoint, request.auth.userId);
      return reply.code(204).send();
    },
  );

  // PATCH /api/v1/push/subscriptions/:id — name one of the caller's devices (spec 199).
  app.patch<{ Params: { id: string }; Body: { label: string | null } }>(
    "/api/v1/push/subscriptions/:id",
    { schema: { body: pushRenameBodySchema } },
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
      const updated = pushSubscriptionManager.rename(
        request.params.id,
        request.auth.userId,
        request.body.label,
      );
      if (!updated) return reply.code(404).send({ error: "Push subscription not found" });
      return updated;
    },
  );

  // DELETE /api/v1/push/subscriptions/:id — remove one of the caller's devices (spec 199).
  app.delete<{ Params: { id: string } }>(
    "/api/v1/push/subscriptions/:id",
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
      const removed = pushSubscriptionManager.deleteById(request.params.id, request.auth.userId);
      if (!removed) return reply.code(404).send({ error: "Push subscription not found" });
      return reply.code(204).send();
    },
  );
}
