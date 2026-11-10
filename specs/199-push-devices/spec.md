# Spec 199 — Push devices: name, delivery result, prune

Issue #1200. Builds on spec 127 (Web Push) and #1199 (Settings > Account > Notifications).

## Problem

A user's push subscriptions cannot be told apart (Apple endpoints are opaque, iOS freezes the OS
in the user agent at `18_7`), a dead one stays forever (Sowel prunes only on 404/410, and Apple
may keep accepting pushes for a removed home-screen app), and nothing records whether a push went
through: the « Notifications dispatched » log line lives ~30 min in the in-memory ring.

## Requirements

- R1. A subscription carries an optional **label**, editable by its owner. With no label the UI
  derives one from the user agent: device family + browser version (« iPhone, Safari 27.2 »).
- R2. The Notifications section lists the user's devices, the current one marked « this device »
  (endpoint match with `pushManager.getSubscription()`).
- R3. An owner deletes one of their subscriptions by id, with a confirmation.
- R4. Each send records, per subscription: `last_sent_at`, `last_success_at` (the push service
  answered 2xx), `last_error`, `consecutive_failures` (reset on success). The UI words a success as
  « accepted by the push service », never as displayed on the phone.
- R5. Beyond 404/410, a subscription the push service refuses **5** times in a row (a 4xx other than 429) is deleted (warn log). A network error, a 5xx or a 429 is recorded without counting: an outage on the Sowel side must not wipe every device.
- R6. `PATCH` and `DELETE /api/v1/push/subscriptions/:id` act on the caller's own subscriptions
  only (404 otherwise). The endpoint-based `DELETE` stays.

## Not done

Replacing the old subscription on reinstall: a reinstalled PWA starts with empty storage and a new
endpoint, nothing ties them. The manual delete and the delivery result cover it.

## Docs delta

- `docs/technical/api-reference.md` + `.fr.md`: the list fields, `PATCH` / `DELETE /:id`.
- `docs/technical/data-model.md`: the `push_subscriptions` columns (migration 042).
- `docs/user/remote-access.md` + `.fr.md`: the devices list, rename, delete, last delivery, prune.
