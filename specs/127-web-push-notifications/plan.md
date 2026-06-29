# Implementation Plan — Spec 127

## Slices

### Slice A — Types + schema

- A.1 `src/shared/types.ts`: `channelType: "telegram" | "web-push"`, `WebPushChannelConfig`, `channelConfig` union, `PushSubscription`.
- A.2 `migrations/011_push_subscriptions.sql`: `push_subscriptions` table (user cascade, endpoint unique).

### Slice B — VAPID + subscription storage

- B.1 add `web-push` (+ `@types/web-push`) to `package.json`; `npm ci`.
- B.2 `src/notifications/vapid.ts`: `ensureVapidKeys(settingsManager, logger)`.
- B.3 `src/notifications/push-subscription-manager.ts`: upsert/list/listByUser/deleteByEndpoint/deleteById.

### Slice C — Web Push channel

- C.1 `src/notifications/channels/web-push.ts`: `WebPushChannel` (send to all subs, prune 404/410, per-endpoint error isolation).
- C.2 `notification-publish-service.ts`: register `"web-push"` in the channel registry (inject deps).
- C.3 `notification-publisher-manager.ts`: generic `rowToPublisher` + per-type config validation.
- C.4 `src/index.ts`: bootstrap VAPID + subscription manager, pass into the publish service.

### Slice D — API

- D.1 `src/api/routes/push.ts`: vapid-public-key, subscriptions GET/POST/DELETE (auth, per-user); register in `server.ts`.
- D.2 `notification-publishers.ts`: accept `channelType: "web-push"`.

### Slice E — UI

- E.1 `ui/vite.config.ts` `workbox.importScripts: ["push-handler.js"]`; `ui/public/push-handler.js` (push + notificationclick).
- E.2 `ui/src/api.ts`: push client (`getVapidPublicKey`, `getPushSubscriptions`, `subscribePush`, `unsubscribePush`).
- E.3 `ui/src/hooks/usePushSubscription.ts`: support/permission/subscribe/unsubscribe/status.
- E.4 Notifications settings: per-device "enable push" control + `Web Push` channel option in the publisher form.

### Slice F — Tests (see Test Plan)

## Test Plan

### Modules to test

- `src/notifications/push-subscription-manager.ts`
- `src/notifications/channels/web-push.ts` (mock the `web-push` library)
- `src/notifications/vapid.ts`
- `src/notifications/notification-publisher-manager.ts` (web-push + telegram retro-compat)

### Scenarios per module

| Module                         | Scenario                               | Expected                                                      |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------- |
| push-subscription-manager      | upsert a new subscription              | row stored with the user's id                                 |
| push-subscription-manager      | upsert an existing endpoint            | updates user/keys, no duplicate row                           |
| push-subscription-manager      | `listByUser`                           | only that user's subscriptions                                |
| push-subscription-manager      | `deleteByEndpoint`                     | row removed                                                   |
| push-subscription-manager      | user deleted                           | subscriptions cascade-deleted                                 |
| web-push channel               | send with N subscriptions              | `sendNotification` called N times with `{title,body}` + VAPID |
| web-push channel               | endpoint returns 410                   | that subscription is pruned (`deleteByEndpoint`)              |
| web-push channel               | one endpoint errors (500)              | logged, other endpoints still delivered (no throw)            |
| web-push channel               | no subscriptions                       | no-op, no error                                               |
| vapid                          | first call, no keys                    | generates + persists; returns public/private/subject          |
| vapid                          | second call                            | reuses persisted keys (no regeneration)                       |
| notification-publisher-manager | rowToPublisher web-push                | parses config, channelType "web-push"                         |
| notification-publisher-manager | rowToPublisher telegram (retro-compat) | unchanged behaviour                                           |

### Retro-compat

- Telegram publishers/mappings, triggers, and the publish/throttle path are unchanged. `web-push` is purely additive.

## Validation Plan

- `npx tsc --noEmit` (backend) + `cd ui && npx tsc -b --noEmit` — zero errors.
- `npx vitest run` — all pass (incl. new tests).
- `npx eslint src/ --ext .ts` + `cd ui && npx eslint .` — zero errors.
- Manual (on `https://app.sowel.org`, installed PWA): enable push → subscription stored; map a `web-push` publisher to an equipment/alarm → native push received; revoke prunes the subscription.

## Commit scope

`core` / `api` / `ui` / `db` (notifications).
