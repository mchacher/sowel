# Architecture — Spec 127

## Flow diagram

```
Boot: ensureVapidKeys(settingsManager)
  settings: push.vapidPublicKey / push.vapidPrivateKey / push.vapidSubject (generated once)

Browser (installed PWA, HTTPS)
  GET /api/v1/push/vapid-public-key ──► { publicKey }
  Notification.requestPermission() -> granted
  pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: publicKey })
  POST /api/v1/push/subscriptions { endpoint, keys:{p256dh,auth}, userAgent }
        │
        ▼  PushSubscriptionManager.upsert(userId, sub)  [push_subscriptions]
   ...trigger (equipment/zone/recipe change, system.alarm) ...
        │  (existing NotificationPublishService mapping → publisher)
        ▼  channels["web-push"].send({}, text)
   WebPushChannel: for each subscription → web-push.sendNotification(sub, {title,body}, {vapid})
        │   404/410 → PushSubscriptionManager.deleteByEndpoint(endpoint)
        ▼
   Browser push service (Chrome/Firefox/Apple) → SW 'push' event
   service worker: showNotification(title, { body, icon, tag })
   'notificationclick' → focus existing window or open start_url
```

## Components

### Changed: `src/shared/types.ts`

- `NotificationPublisher.channelType`: `"telegram" | "web-push"`.
- `WebPushChannelConfig` (empty object `{}` for v1 — no per-publisher credentials).
- `NotificationPublisher.channelConfig`: `TelegramChannelConfig | WebPushChannelConfig`.
- New `PushSubscription` interface: `{ id, userId, endpoint, p256dh, auth, userAgent?, createdAt }`.

### New: `migrations/011_push_subscriptions.sql`

```sql
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

VAPID keys live in the existing `settings` table (no new table) via `SettingsManager`.

### New: `src/notifications/vapid.ts`

`ensureVapidKeys(settingsManager, logger): { publicKey, privateKey, subject }` — reads `push.vapid*`; if missing, `webpush.generateVAPIDKeys()` + persist. Called once at boot; the result is passed to the WebPushChannel.

### New: `src/notifications/push-subscription-manager.ts`

CRUD over `push_subscriptions`: `upsert(userId, { endpoint, p256dh, auth, userAgent })` (by endpoint), `listAll()`, `listByUser(userId)`, `deleteByEndpoint(endpoint, userId?)`, `deleteById(id)`.

### New: `src/notifications/channels/web-push.ts`

`WebPushChannel implements NotificationChannel`, constructed with `(subscriptionManager, getVapid, logger)`. `send({}, text)` → `webpush.sendNotification(sub, JSON.stringify({title:"Sowel", body:text}), { vapidDetails })` for every subscription; prune on 404/410; log other errors per endpoint. `testConnection` checks VAPID present.

### Changed: `src/notifications/notification-publish-service.ts`

Register `"web-push": new WebPushChannel(...)` in the `channels` record (inject the subscription manager + VAPID). No change to the trigger/throttle/mapping logic.

### Changed: `src/notifications/notification-publisher-manager.ts`

Generalise `rowToPublisher` (channelType + channelConfig parsed from the row instead of hardcoded `"telegram"`). Validate `channelConfig` per `channelType`.

### New: `src/api/routes/push.ts` (registered in `src/api/server.ts`)

`GET /push/vapid-public-key`, `GET /push/subscriptions`, `POST /push/subscriptions`, `DELETE /push/subscriptions` — all auth-required; subscriptions scoped to `request.user.userId`.

### Changed: `src/api/routes/notification-publishers.ts`

Extend the accepted `channelType` union to include `"web-push"` and validate its (empty) config.

### Changed (UI): `ui/vite.config.ts` + `ui/public/push-handler.js`

`workbox.importScripts: ["push-handler.js"]`. `push-handler.js` adds `push` (showNotification) + `notificationclick` (focus/open) listeners to the generated service worker.

### New (UI): `ui/src/hooks/usePushSubscription.ts`, push client in `ui/src/api.ts`

Support detection, permission, subscribe/unsubscribe, status. Settings UI gains a per-device "enable push" control and a `web-push` channel option in the publisher form.

## Data model

| Store                                           | Change                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `settings`                                      | `push.vapidPublicKey`, `push.vapidPrivateKey`, `push.vapidSubject` (generated once) |
| `push_subscriptions` (new table, migration 011) | per-user device subscriptions                                                       |
| `notification_publishers`                       | now also holds `channel_type = "web-push"` rows (config `{}`)                       |

## Events

None new required. Existing triggers (`equipment.data.changed`, `zone.data.changed`, `recipe.instance.state.changed`, `system.alarm.*`) drive web-push exactly as Telegram.

## API

New `/api/v1/push/*` endpoints (vapid-public-key, subscriptions CRUD). `notification-publishers` accepts the new channel type. The VAPID **private** key is never serialised to any response.

## Files changed

| Domain        | File                                                                           | Change                                                     |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Core          | `src/shared/types.ts`                                                          | channelType union, WebPushChannelConfig, PushSubscription  |
| DB            | `migrations/011_push_subscriptions.sql`                                        | new table                                                  |
| Notifications | `src/notifications/vapid.ts`                                                   | VAPID bootstrap (new)                                      |
| Notifications | `src/notifications/push-subscription-manager.ts`                               | subscription CRUD (new)                                    |
| Notifications | `src/notifications/channels/web-push.ts`                                       | web-push channel (new)                                     |
| Notifications | `src/notifications/notification-publish-service.ts`                            | register channel                                           |
| Notifications | `src/notifications/notification-publisher-manager.ts`                          | generic rowToPublisher + validation                        |
| API           | `src/api/routes/push.ts` + `server.ts`                                         | push endpoints                                             |
| API           | `src/api/routes/notification-publishers.ts`                                    | accept web-push                                            |
| Core          | `src/index.ts`                                                                 | wire VAPID + subscription manager into the publish service |
| UI            | `ui/vite.config.ts`, `ui/public/push-handler.js`                               | SW push handler                                            |
| UI            | `ui/src/hooks/usePushSubscription.ts`, `ui/src/api.ts`, notifications settings | subscribe UI                                               |
| deps          | `package.json`                                                                 | `web-push` (+ `@types/web-push` dev)                       |
