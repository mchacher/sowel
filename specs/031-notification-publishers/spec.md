# Notification Publishers

## Summary

Event-driven notification system that sends messages to Telegram when equipment, zone, or recipe data changes. Follows the same architecture as MQTT Publishers: a "notification publisher" is linked to a Telegram channel (botToken + chatId) and contains mappings from data sources to human-readable messages.

## Reference

- sowel-spec.md section 13.4 (Notification System — V0.12)
- MQTT Publishers pattern (specs/028-mqtt-publishers)

## Acceptance Criteria

- [ ] User can create a notification publisher with Telegram config (botToken, chatId)
- [ ] User can add mappings: sourceType/sourceId/sourceKey + context message
- [ ] On value change, a Telegram message is sent: `"<message> : <value>"`
- [ ] Throttle per mapping: configurable interval (default 5 min), immediate for boolean/enum state transitions
- [ ] User can enable/disable a publisher
- [ ] User can test a publisher (sends current values of all mappings)
- [ ] User can test a channel (sends a generic "connection OK" message)
- [ ] UI page in Administration for CRUD of publishers and mappings
- [ ] Notification publishers included in backup/restore
- [ ] Extensible architecture: adding a new channel type (webhook, ntfy, Signal) requires only a new provider, no structural changes

## Data Model

### notification_publishers

| Column         | Type     | Description                          |
| -------------- | -------- | ------------------------------------ |
| id             | TEXT PK  | UUID                                 |
| name           | TEXT     | User-facing name                     |
| channel_type   | TEXT     | Channel provider type (`telegram`)   |
| channel_config | TEXT     | JSON config (`{ botToken, chatId }`) |
| enabled        | INTEGER  | 0 or 1                               |
| created_at     | DATETIME | Auto                                 |
| updated_at     | DATETIME | Auto                                 |

### notification_publisher_mappings

| Column       | Type     | Description                                              |
| ------------ | -------- | -------------------------------------------------------- |
| id           | TEXT PK  | UUID                                                     |
| publisher_id | TEXT FK  | References notification_publishers(id) ON DELETE CASCADE |
| message      | TEXT     | Context message (e.g. "Temperature salon")               |
| source_type  | TEXT     | `equipment`, `zone`, or `recipe`                         |
| source_id    | TEXT     | ID of the source entity                                  |
| source_key   | TEXT     | Data field to watch (alias, zone field, state key)       |
| throttle_ms  | INTEGER  | Min interval between notifications (default 300000)      |
| created_at   | DATETIME | Auto                                                     |

Unique constraint: `(publisher_id, source_type, source_id, source_key)` — one mapping per source per publisher.

## Message Format

```
<message> : <value>
```

Examples:

- `Temperature salon : 22.5`
- `Porte entree : open`
- `Motion cuisine : true`

For boolean values, `true`/`ON`/`open` and `false`/`OFF`/`closed` are sent as-is (no 0/1 conversion unlike MQTT).

## Throttle Logic

- **Boolean/enum types**: notify immediately on every state transition (value !== previous), skip if same value
- **Other types**: respect `throttle_ms` per mapping (default 5 minutes). Skip if less than `throttle_ms` elapsed since last notification for this mapping.

## API Endpoints

| Method | Endpoint                                                  | Description                |
| ------ | --------------------------------------------------------- | -------------------------- |
| GET    | `/api/v1/notification-publishers`                         | List all with mappings     |
| GET    | `/api/v1/notification-publishers/:id`                     | Get one with mappings      |
| POST   | `/api/v1/notification-publishers`                         | Create publisher           |
| PUT    | `/api/v1/notification-publishers/:id`                     | Update publisher           |
| DELETE | `/api/v1/notification-publishers/:id`                     | Delete publisher           |
| POST   | `/api/v1/notification-publishers/:id/test`                | Test: send current values  |
| POST   | `/api/v1/notification-publishers/:id/test-channel`        | Test: send generic message |
| POST   | `/api/v1/notification-publishers/:id/mappings`            | Add mapping                |
| PUT    | `/api/v1/notification-publishers/:id/mappings/:mappingId` | Update mapping             |
| DELETE | `/api/v1/notification-publishers/:id/mappings/:mappingId` | Delete mapping             |

## Event Bus Events

| Event                                    | Payload                      | Emitted when      |
| ---------------------------------------- | ---------------------------- | ----------------- |
| `notification-publisher.created`         | `{ publisher }`              | Publisher created |
| `notification-publisher.updated`         | `{ publisher }`              | Publisher updated |
| `notification-publisher.removed`         | `{ publisherId }`            | Publisher deleted |
| `notification-publisher.mapping.created` | `{ publisherId, mapping }`   | Mapping added     |
| `notification-publisher.mapping.removed` | `{ publisherId, mappingId }` | Mapping removed   |

Consumed events (triggers notification):

- `equipment.data.changed`
- `zone.data.changed`
- `recipe.instance.state.changed`

## Scope

### In Scope

- Telegram channel provider (botToken + chatId)
- CRUD for publishers and mappings (API + UI)
- Event-driven notifications on value change
- Per-mapping throttle
- Test channel and test publisher
- Backup/restore support

### Out of Scope

- Other channel types (Signal, webhook, ntfy, email) — added later as new providers
- Conditional triggers (temperature > 28) — deferred
- Device offline notifications — deferred
- System error notifications — deferred
- Quiet hours / do-not-disturb schedule — deferred
- Per-user notification preferences — deferred

## Edge Cases

- Telegram API unreachable: log error, do not retry (fire-and-forget). Next value change will try again.
- Invalid botToken or chatId: test-channel endpoint returns error with Telegram API response.
- Publisher disabled: skip all its mappings, no API calls.
- Value is null/undefined: skip notification.
- Throttle bypass: boolean/enum state transitions always notify immediately.
