# Spec 189 — Plan

## Tasks

- [x] Store: `endedExternalAccesses(before)`.
- [x] Manager: `purge()` deletes ended external accesses (journal `deleted` by `housekeeping`,
      tombstone, phone alarm resolved, one `changed()`), then runs the existing purge.
- [x] Tests (below), in the `housekeeping (R10)` block of `shared-access-manager.test.ts`, using the
      existing harness (`buildSharedAccessHarness`, `h.clock.now`, `h.at`) and the plugin API path
      the other R9 tests use to create external accesses.
- [x] Spec 181 R10 item 37; user docs EN + FR; specs index.
- [x] `npx tsc --noEmit`, `npx vitest run`, `npx eslint src/ --ext .ts` all green.

## Test plan

| Module        | Scenario                                                     | Expected                                                      |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| manager.purge | External access, `until` 6 days ago                          | still listed                                                  |
| manager.purge | External access, `until` 7 days + 1 h ago                    | gone from `listAccesses`, `getAccess` throws not found        |
| manager.purge | Same, journal                                                | earlier lines kept + one `deleted` line, actor `housekeeping` |
| manager.purge | External access revoked 7 days + 1 h ago, stay in the future | gone; plugin `upsert` of the same externalId throws `revoked` |
| manager.purge | Manual access ended a month ago                              | still listed, code null                                       |
| manager.purge | External access live / not yet, created long ago             | untouched                                                     |
| manager.purge | External access extended by the owner                        | kept until 7 days after the extension, then gone              |
| manager.purge | External access with a raised phone alarm, deleted           | `system.alarm.resolved` emitted for it                        |
| manager.purge | Two ended externals in one run                               | both gone, `changed` notified once                            |
| manager.purge | Nothing to delete                                            | no `changed` notification                                     |
