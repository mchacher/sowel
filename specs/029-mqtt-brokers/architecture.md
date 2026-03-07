# Architecture: MQTT Brokers

## Data Model Changes

### New table: `mqtt_brokers`

```sql
CREATE TABLE IF NOT EXISTS mqtt_brokers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  username TEXT,
  password TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Modified table: `mqtt_publishers`

Add column `broker_id TEXT NOT NULL REFERENCES mqtt_brokers(id)`.

Migration strategy: add column as nullable first, then existing publishers will need manual reconfiguration. Publishers with NULL `broker_id` will not publish.

### New types in `types.ts`

```typescript
export interface MqttBroker {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
  createdAt: string;
  updatedAt: string;
}

// MqttPublisher gains brokerId
export interface MqttPublisher {
  id: string;
  name: string;
  brokerId: string | null; // null = legacy unconfigured
  topic: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

## Event Bus Events

New events added to `EngineEvent`:

```typescript
| { type: "mqtt-broker.created"; broker: MqttBroker }
| { type: "mqtt-broker.updated"; broker: MqttBroker }
| { type: "mqtt-broker.removed"; brokerId: string }
```

## API Changes

### New endpoints

| Method   | Path                       | Description                                   |
| -------- | -------------------------- | --------------------------------------------- |
| `GET`    | `/api/v1/mqtt-brokers`     | List all brokers                              |
| `POST`   | `/api/v1/mqtt-brokers`     | Create a broker                               |
| `PUT`    | `/api/v1/mqtt-brokers/:id` | Update a broker                               |
| `DELETE` | `/api/v1/mqtt-brokers/:id` | Delete a broker (blocked if publishers exist) |

### Changed endpoints

| Method | Path                          | Change                           |
| ------ | ----------------------------- | -------------------------------- |
| `POST` | `/api/v1/mqtt-publishers`     | Body now requires `brokerId`     |
| `PUT`  | `/api/v1/mqtt-publishers/:id` | Body accepts optional `brokerId` |

## Connection Pool (MqttPublishService)

Replace the single `MqttClient` with a `Map<brokerId, MqttClient>`.

- On init: connect to all brokers that have at least one enabled publisher
- On broker created/updated: (re)connect that broker's client
- On broker removed: disconnect and remove client
- On publisher created/updated with new brokerId: ensure broker client exists
- `publish()` takes brokerId to select the right client
- `MappingRef` gains `brokerId` field for routing

## UI Changes

### MqttPublishersPage

1. Replace "Broker settings" collapsible panel with a "Brokers" section:
   - List of broker cards (name, url, edit/delete buttons)
   - "Add broker" button + inline create form
2. `CreatePublisherForm`: add broker selector dropdown (required)
3. `PublisherCard`: show associated broker name

## File Changes

| File                                            | Change                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `migrations/029_mqtt_brokers.sql`               | New migration: create `mqtt_brokers` table, add `broker_id` to `mqtt_publishers` |
| `src/shared/types.ts`                           | Add `MqttBroker` interface, add `brokerId` to `MqttPublisher`, add broker events |
| `src/mqtt-publishers/mqtt-broker-manager.ts`    | New file: broker CRUD manager                                                    |
| `src/mqtt-publishers/mqtt-publisher-manager.ts` | Add `brokerId` to create/update, update row mapper                               |
| `src/mqtt-publishers/mqtt-publish-service.ts`   | Replace single client with broker connection pool                                |
| `src/api/routes/mqtt-brokers.ts`                | New file: broker API routes                                                      |
| `src/api/routes/mqtt-publishers.ts`             | Add `brokerId` to create/update endpoints                                        |
| `src/api/server.ts`                             | Register broker routes, instantiate broker manager                               |
| `src/api/websocket.ts`                          | Broadcast broker events                                                          |
| `src/api/routes/backup.ts`                      | Include brokers in backup/restore                                                |
| `src/index.ts`                                  | Instantiate broker manager                                                       |
| `ui/src/types.ts`                               | Add `MqttBroker` type, update `MqttPublisher` with `brokerId`                    |
| `ui/src/api.ts`                                 | Add broker API functions                                                         |
| `ui/src/pages/MqttPublishersPage.tsx`           | Replace broker settings with broker CRUD section, add broker selector            |
| `ui/src/i18n/locales/en.json`                   | Add broker-related translations                                                  |
| `ui/src/i18n/locales/fr.json`                   | Add broker-related translations                                                  |
