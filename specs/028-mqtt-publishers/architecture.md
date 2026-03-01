# Architecture: MQTT Publishers

## Data Model Changes

### New SQLite tables

```sql
mqtt_publishers (id TEXT PK, name TEXT, topic TEXT, enabled INTEGER, created_at TEXT, updated_at TEXT)
mqtt_publisher_mappings (id TEXT PK, publisher_id TEXT FK, publish_key TEXT, source_type TEXT, source_id TEXT, source_key TEXT, created_at TEXT, UNIQUE(publisher_id, publish_key))
```

### New types in types.ts

- `MqttPublisher`: id, name, topic, enabled, createdAt, updatedAt
- `MqttPublisherMapping`: id, publisherId, publishKey, sourceType, sourceId, sourceKey, createdAt
- `MqttPublisherWithMappings`: MqttPublisher + mappings array

## Event Bus Events

### New events emitted

- `mqtt-publisher.created` / `.updated` / `.removed`
- `mqtt-publisher.mapping.created` / `.mapping.removed`

### Events consumed

- `equipment.data.changed` → lookup matching mappings → publish
- `zone.data.changed` → for each aggregation key → lookup → publish
- `settings.changed` → reconnect if mqtt-publisher.\* keys changed
- `mqtt-publisher.*` events → rebuild internal index

## MQTT Topics

- Publishes to user-configured topics (e.g., `winch/homedisplay/livingroom`)
- Payload: `{"publishKey": value}` with retain=true

## API Changes

- `GET    /api/v1/mqtt-publishers` — list all with mappings
- `POST   /api/v1/mqtt-publishers` — create publisher
- `GET    /api/v1/mqtt-publishers/:id` — get with mappings
- `PUT    /api/v1/mqtt-publishers/:id` — update publisher
- `DELETE /api/v1/mqtt-publishers/:id` — delete publisher
- `POST   /api/v1/mqtt-publishers/:id/mappings` — add mapping
- `DELETE /api/v1/mqtt-publishers/:id/mappings/:mappingId` — remove mapping

## UI Changes

- New page: MqttPublishersPage (Administration section)
- Sidebar nav item with Radio/Send icon

## File Changes

| File                                            | Change                           |
| ----------------------------------------------- | -------------------------------- |
| `migrations/022_mqtt_publishers.sql`            | New tables                       |
| `src/shared/types.ts`                           | New types + EngineEvent variants |
| `src/mqtt-publishers/mqtt-publisher-manager.ts` | New — CRUD                       |
| `src/mqtt-publishers/mqtt-publish-service.ts`   | New — reactive publisher         |
| `src/api/routes/mqtt-publishers.ts`             | New — REST API                   |
| `src/api/server.ts`                             | Wire routes                      |
| `src/api/websocket.ts`                          | Add topic                        |
| `src/index.ts`                                  | Bootstrap + shutdown             |
| `ui/src/types.ts`                               | Frontend types                   |
| `ui/src/api.ts`                                 | API functions                    |
| `ui/src/pages/MqttPublishersPage.tsx`           | New page                         |
| `ui/src/App.tsx`                                | Route                            |
| `ui/src/components/layout/Sidebar.tsx`          | Nav item                         |
| `ui/src/i18n/locales/{en,fr}.json`              | Translations                     |
