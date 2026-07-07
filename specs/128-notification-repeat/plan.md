# Spec 128 — Plan

## Implementation steps (in order)

1. **Types** — `src/shared/types.ts`: add `repeatMs?`/`repeatMax?` to
   `NotificationPublisherMapping` and the create/update input types.
2. **DB** — `migrations/012_notification_mapping_repeat.sql` (two nullable
   columns).
3. **Manager** — `notification-publisher-manager.ts`: `rowToMapping` reads the
   columns; `addMapping`/`updateMapping` accept + validate the fields; prepared
   statements include them.
4. **Publish service** — `notification-publish-service.ts`: `isActiveValue`,
   `MappingRef.repeatMs`/`repeatMax`, repeat timers + `activeMappings`/
   `repeatCount`, activation/deactivation logic in `handleSourceChanged`,
   `startRepeatTimer`/`stopRepeat`, `init()` resume pass, `rebuildIndex()`
   re-sync, `destroy()` cleanup.
5. **Tests** — see test plan below.
6. **API** — `notification-publishers.ts` mapping routes accept the fields.
7. **UI** — `notif-mapping.ts` mode⇄fields helper (+ test), form control in
   `NotificationPublishersPage.tsx`, `types.ts`, i18n.
8. **Docs** — api-reference mapping fields.

## Test Plan

### Modules to test

- `notification-publish-service` — activation/repeat/deactivation, cap, timer
  re-check, restart resume, config re-sync.
- `notification-publisher-manager` — persistence + validation of the new fields.
- `ui/src/lib/notif-mapping` — mode ⇄ (repeatMs, repeatMax) conversion.

### Scenarios

| Module             | Scenario                                                            | Expected                                                      |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| publish-service    | `isActiveValue`: true/1/"open"/timestamp vs false/0/null/""/"false" | active vs inactive per spec                                   |
| publish-service    | Forever: value false→true                                           | 1 send now; a reminder after each `repeatMs` (fake timers)    |
| publish-service    | Forever: true→false                                                 | timer stopped, no extra send                                  |
| publish-service    | Limited N=2                                                         | initial + exactly 2 reminders, then silent while still active |
| publish-service    | Timer tick while value cleared to null                              | timer stops, no send (per-tick re-check)                      |
| publish-service    | No `repeatMs` (mode None)                                           | unchanged: notify on change, no reminders                     |
| publish-service    | Deactivation is silent only for repeat mappings                     | non-repeat mapping still notifies on change                   |
| publisher-manager  | addMapping with repeatMs+repeatMax                                  | persisted + returned via getMappings                          |
| publisher-manager  | repeatMax without repeatMs                                          | rejected (400)                                                |
| publisher-manager  | negative / zero repeatMs                                            | rejected (400)                                                |
| notif-mapping (ui) | None/Forever/Limited ⇄ (repeatMs, repeatMax)                        | round-trips; Limited requires a max                           |

### Tasks

- [x] Types
- [x] Migration 012
- [x] Manager (persist + validate)
- [x] Publish service (repeat lifecycle)
- [x] publish-service tests
- [x] publisher-manager tests
- [x] API routes
- [x] UI helper + form + i18n
- [x] notif-mapping UI test
- [x] Docs (api-reference)
- [x] Validate (tsc/tests/lint)
