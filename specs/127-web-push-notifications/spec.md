# Spec 127 — Web Push notifications (PWA)

## Context

Today the only notification channel is Telegram (spec 031). The UI is an installable PWA (spec 034), but spec 034 explicitly deferred push notifications "to the Sowel Connect cloud tier". A user wants to receive notifications **in the installed PWA itself**, instead of relying on Telegram.

This is feasible **self-hosted, without Firebase**, using the standard W3C **Web Push** protocol with **VAPID** keys: the browser subscribes with the server's VAPID public key and the server pushes via the browser vendor's push service (Chrome/Firefox/Safari) using the `web-push` library. No third-party account is required.

The notification channel architecture is already extensible (`NotificationChannel` interface + a channel registry), so this adds a new channel **alongside** Telegram and reuses the existing source→message **mappings** and triggers unchanged.

## Goals

1. New `web-push` notification channel: an installed PWA receives native push notifications for the same triggers as Telegram (equipment/zone/recipe state changes, system alarms), via the existing publisher + mapping model.
2. **Per-user device subscriptions**: each authenticated user enables push on their own device(s); subscriptions are stored per user and managed from the UI.
3. Coexist with Telegram (additive, no removal). Standard VAPID, no Firebase.

## Non-Goals

- Removing or changing Telegram.
- Per-notification per-user **targeting** (v1 broadcasts a web-push publisher to all subscribed devices; targeting a specific user is a later refinement).
- Rich notification actions/images, notification grouping, quiet hours (future).
- Making push work over plain LAN `http` — Web Push requires a **secure context (HTTPS)**; this targets the existing `https://app.sowel.org` tunnel.
- iOS support beyond what Apple allows (Web Push on iOS only works for a PWA **added to the home screen**, iOS 16.4+).

## Functional Requirements

### FR1 — VAPID keys (server)

On startup the engine ensures a VAPID key pair exists in `settings` (`push.vapidPublicKey`, `push.vapidPrivateKey`, `push.vapidSubject`). If absent, generate once via `web-push` and persist. The public key + subject are safe to expose; the private key is never returned by any API.

### FR2 — Subscription lifecycle (API + storage)

- `GET /api/v1/push/vapid-public-key` → `{ publicKey }` (auth required).
- `POST /api/v1/push/subscriptions` → body = a browser `PushSubscription` (`endpoint`, `keys.p256dh`, `keys.auth`, optional `userAgent`); stored against the authenticated `userId`, **upsert by `endpoint`**; returns 201.
- `GET /api/v1/push/subscriptions` → the current user's subscriptions (for UI status).
- `DELETE /api/v1/push/subscriptions` → body `{ endpoint }`, removes the caller's subscription.
- Subscriptions are deleted when their user is deleted (cascade) and pruned by the server when a push returns `404`/`410` (expired).

### FR3 — Web Push channel (delivery)

A `web-push` channel implements `NotificationChannel`. `send(config, text)` pushes `{ title: "Sowel", body: text }` to **all** stored subscriptions using the VAPID keys; a `404`/`410` response prunes that subscription; other per-endpoint errors are logged and do not abort the batch. `testConnection` validates that VAPID keys exist (and may push a test to the caller's own devices).

A notification publisher can have `channelType: "web-push"` with an (empty) `WebPushChannelConfig`. It reuses the existing `notification_publisher_mappings` (source→message→throttle) unchanged.

### FR4 — Service worker + browser subscription (UI)

- The service worker gains a `push` handler (`showNotification(title, { body, icon, badge, tag })`) and a `notificationclick` handler (focus an existing app window or open `start_url`), injected via `vite-plugin-pwa` `workbox.importScripts`.
- A `usePushSubscription` hook: detects support (`serviceWorker` + `PushManager` + secure context), requests `Notification.requestPermission()`, subscribes (`pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`), POSTs the subscription, and can unsubscribe. Exposes a status (`unsupported | insecure | default | granted | denied | subscribed`).
- Notification settings UI: a per-device "Enable push on this device" control showing status, and a `Web Push` option in the publisher create/edit flow (next to Telegram).

## Acceptance Criteria

- [x] On first boot without keys, a VAPID pair is generated and persisted; subsequent boots reuse it. The private key is never exposed by the API.
- [x] A user can enable push from the installed PWA (HTTPS), and the subscription is stored against their `userId` (upsert by endpoint).
- [x] A `web-push` publisher mapped to a source delivers a native push to all subscribed devices on the same trigger that Telegram uses.
- [x] A push to an expired endpoint (`410`) prunes that subscription; one bad endpoint does not block delivery to the others.
- [x] Telegram keeps working unchanged; existing publishers/mappings are unaffected.
- [x] `tsc` (backend + UI), `eslint`, `vitest` all pass.

## Edge Cases

- **Insecure / unsupported context** (LAN http, old browser, no `PushManager`): the UI shows "non disponible" with the reason; no crash.
- **Permission denied**: status surfaced; user can retry from browser settings.
- **Duplicate subscription** (same endpoint re-posted): upsert updates `userId`/keys, no duplicate row.
- **User deleted**: their subscriptions cascade-delete.
- **No subscriptions** when a web-push publisher fires: no-op (logged at debug).
- **iOS not installed**: push API absent in Safari tab → shown as unsupported; works once added to home screen (16.4+).
