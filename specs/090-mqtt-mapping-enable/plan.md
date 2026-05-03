# Plan — Spec 090

## Implementation steps

1. Migration `migrations/008_mqtt_publisher_mapping_enabled.sql`.
2. Types — backend `src/shared/types.ts` + UI `ui/src/types.ts`.
3. Manager — `src/mqtt-publishers/mqtt-publisher-manager.ts`:
   - extend `MappingRow`, `rowToMapping`, prepared statements
   - extend `addMapping` / `updateMapping` signatures + bodies
4. Publish service — `src/mqtt-publishers/mqtt-publish-service.ts`:
   - extend `MappingRef`
   - skip disabled mappings in live + snapshot + test paths
5. API routes — `src/api/routes/mqtt-publishers.ts`: accept `enabled?` on POST + PUT.
6. UI — `ui/src/api.ts` + `ui/src/pages/MqttPublishersPage.tsx`:
   - new toggle button, opacity styling, i18n keys (`fr.json`, `en.json`)
7. Tests (see below).
8. Typecheck (backend + UI), lint, vitest.

## Test Plan

### Modules to test

- `mqtt-publisher-manager` — CRUD with `enabled` field
- `mqtt-publish-service` — disabled mappings are skipped in live + snapshot paths

### Scenarios

| Module                 | Scenario                                                     | Expected                                                 |
| ---------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| mqtt-publisher-manager | `addMapping` without `enabled`                               | Stored with `enabled = true`                             |
| mqtt-publisher-manager | `addMapping` with `enabled: false`                           | Stored with `enabled = false`                            |
| mqtt-publisher-manager | `updateMapping` with `enabled: false`                        | Returned mapping has `enabled = false`, persisted        |
| mqtt-publisher-manager | `updateMapping` without `enabled`                            | Existing `enabled` value preserved                       |
| mqtt-publish-service   | live equipment data → enabled mapping                        | `client.publish` called once with right topic/payload    |
| mqtt-publish-service   | live equipment data → disabled mapping                       | `client.publish` NOT called                              |
| mqtt-publish-service   | initial snapshot skips disabled mappings                     | `publishInitialSnapshot` only emits for enabled mappings |
| mqtt-publish-service   | manual `publishSnapshotForPublisher` skips disabled mappings | Returned count + publishes only cover enabled mappings   |

### Existing test files

- `src/mqtt-publishers/mqtt-publisher-manager.test.ts` (if present — extend it)
- `src/mqtt-publishers/mqtt-publish-service.test.ts` (if present — extend it)

If they don't exist, create them following the patterns of other manager/service tests
(`equipment-manager.test.ts`, etc.) using a real in-memory SQLite via `better-sqlite3`.
