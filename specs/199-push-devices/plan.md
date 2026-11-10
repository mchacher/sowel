# Implementation Plan — Spec 199

## Slices

- [x] 1 — Migration 042, types, manager (`recordSuccess` / `recordFailure` / `rename` / `deleteById`)
- [x] 2 — Web Push channel records the outcome and prunes after 5 failures in a row
- [x] 3 — Routes `PATCH` / `DELETE /:id`, standard-role allowlist
- [x] 4 — UI: devices list, default label, rename, delete, last delivery; EN/FR
- [x] 5 — Docs: api-reference EN/FR, data-model, user remote-access EN/FR

## Test plan

- Migration: existing rows survive with NULL label and `consecutive_failures = 0`.
- Manager: success resets the count and the error; failure increments it; rename and delete by id
  touch only the caller's rows; upsert keeps the label and resets the count.
- Channel: success and failure are recorded per subscription; 404/410 still prune; the 5th failure
  in a row deletes the subscription; a 4th does not.
- Routes: list returns the new fields; `PATCH` renames (200), 404 on another user's id, 400 on a
  too-long label; `DELETE /:id` 204, 404 on another user's id.
- UI: derived labels (iPhone Safari, Android Chrome, desktop Firefox); list shows « This device »
  on the matching endpoint, the accepted line and the error line; rename saves; delete asks first.
