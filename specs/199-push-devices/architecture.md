# Architecture — Spec 199

## Data

Migration `042_push_subscription_delivery.sql` adds to `push_subscriptions`:

| Column                 | Type     | Meaning                                              |
| ---------------------- | -------- | ---------------------------------------------------- |
| `label`                | TEXT     | Owner-given name, NULL = derive from the user agent  |
| `last_sent_at`         | DATETIME | Last attempt                                         |
| `last_success_at`      | DATETIME | Last 2xx from the push service                       |
| `last_error`           | TEXT     | Last failure (`<status> <message>`), NULL on success |
| `consecutive_failures` | INTEGER  | Failures since the last success, default 0           |

`PushSubscription` (`src/shared/types.ts`) gains `label?`, `lastSentAt?`, `lastSuccessAt?`,
`lastError?`, `consecutiveFailures`. A re-subscribe of the same endpoint (upsert) keeps the label
and resets the failure count.

## Backend

- `PushSubscriptionManager`: `recordSuccess(id)`, `recordFailure(id, error)` (returns the new
  count), `rename(id, userId, label)` and `deleteById(id, userId?)` (owner-scoped when `userId` is
  given; returns whether a row matched).
- `WebPushChannel.send`: success → `recordSuccess`; 404/410 → delete (unchanged); other 4xx
  (not 429) → `recordFailure(id, error, true)`, and at `MAX_CONSECUTIVE_FAILURES = 5` →
  `deleteById` + `warn` `{ subscriptionId, userId, failures, status }`. Network error, 5xx, 429 →
  `recordFailure(id, error, false)`: the error is shown, the run is not extended, so an outage on
  the Sowel side never prunes. The log carries `{ message, statusCode }`, not the raw
  `WebPushError` (it holds the full endpoint).
- A re-subscribe of the same endpoint by another user clears the label and the delivery history.
- Routes: `PATCH /api/v1/push/subscriptions/:id` `{ label: string | null }` (max 60 chars, empty
  or null clears it) and `DELETE /api/v1/push/subscriptions/:id`; both 404 when the id is not the
  caller's. Both added to the standard-role write allowlist (`auth-middleware.ts`).

## UI

`PushNotificationsSection` (#1199) gains a « Your devices » list under the this-device row: label
(or the derived one), « This device » badge, last delivery line, rename inline, delete with
`ConfirmDialog`. `ui/src/lib/push-device-label.ts` derives the default label. The section reloads
the list after enable / disable.
