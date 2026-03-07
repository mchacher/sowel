# Architecture: Notification Publishers

## Overview

Mirrors the MQTT Publishers architecture: a manager for CRUD persistence, a service for event-driven dispatch, and channel providers for the actual message delivery.

## File Structure

```
src/notifications/
  notification-publisher-manager.ts   # CRUD, SQLite persistence, event emission
  notification-publish-service.ts     # Event subscription, index, throttle, dispatch
  channels/
    telegram.ts                       # Telegram Bot API provider
    channel.ts                        # Channel provider interface
```

## Data Model Changes

### New SQLite tables

```sql
CREATE TABLE notification_publishers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'telegram',
  channel_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notification_publisher_mappings (
  id TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL REFERENCES notification_publishers(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  throttle_ms INTEGER NOT NULL DEFAULT 300000,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(publisher_id, source_type, source_id, source_key)
);
```

### New types in types.ts

```typescript
export interface NotificationPublisher {
  id: string;
  name: string;
  channelType: "telegram";
  channelConfig: TelegramChannelConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramChannelConfig {
  botToken: string;
  chatId: string;
}

export interface NotificationPublisherMapping {
  id: string;
  message: string;
  sourceType: "equipment" | "zone" | "recipe";
  sourceId: string;
  sourceKey: string;
  throttleMs: number;
}

export interface NotificationPublisherWithMappings extends NotificationPublisher {
  mappings: NotificationPublisherMapping[];
}
```

## Event Bus Events

New event types added to EngineEvent discriminated union:

```typescript
| { type: "notification-publisher.created"; publisher: NotificationPublisher }
| { type: "notification-publisher.updated"; publisher: NotificationPublisher }
| { type: "notification-publisher.removed"; publisherId: string }
| { type: "notification-publisher.mapping.created"; publisherId: string; mapping: NotificationPublisherMapping }
| { type: "notification-publisher.mapping.removed"; publisherId: string; mappingId: string }
```

## Service Architecture

### NotificationPublishService

Same pattern as MqttPublishService:

1. **Index**: `Map<string, MappingRef[]>` keyed by `"equipment:{id}:{key}"` etc.
2. **Throttle state**: `Map<string, number>` keyed by mapping ID → last sent timestamp
3. **Event subscription**: listens to `equipment.data.changed`, `zone.data.changed`, `recipe.instance.state.changed`
4. **Dispatch**: for each matching mapping, check throttle, format message, call channel provider

### Channel Provider Interface

```typescript
interface NotificationChannel {
  send(config: unknown, text: string): Promise<void>;
  testConnection(config: unknown): Promise<void>;
}
```

### Telegram Provider

Uses Telegram Bot API via HTTP fetch (no npm dependency needed):

```
POST https://api.telegram.org/bot{botToken}/sendMessage
{ chat_id: chatId, text: message, parse_mode: "HTML" }
```

## API Routes

File: `src/api/routes/notification-publishers.ts`

Same CRUD pattern as `src/api/routes/mqtt-publishers.ts`:

- List, get, create, update, delete publishers
- Add, update, delete mappings
- Test publisher (send snapshot), test channel (send generic message)

## UI Changes

### New page: NotificationPublishersPage

Location: `ui/src/pages/NotificationPublishersPage.tsx`

Same structure as MqttPublishersPage:

- List of publisher cards
- Inline edit for publisher config (name, botToken, chatId, enabled)
- Mapping rows with inline edit (message, sourceType, sourceId, sourceKey, throttleMs)
- Test buttons (test channel, test publisher)

### Navigation

Add entry in Administration section sidebar/nav.

### Store

New Zustand store: `ui/src/store/notification-publishers.ts`

## Backup

Add `notification_publishers` and `notification_publisher_mappings` to BACKUP_TABLES in `src/api/routes/backup.ts`.

## File Changes

| File                                                  | Change                                   |
| ----------------------------------------------------- | ---------------------------------------- |
| `migrations/030_notification_publishers.sql`          | New migration                            |
| `src/shared/types.ts`                                 | Add NotificationPublisher types + events |
| `src/notifications/notification-publisher-manager.ts` | New: CRUD manager                        |
| `src/notifications/notification-publish-service.ts`   | New: event-driven dispatch service       |
| `src/notifications/channels/channel.ts`               | New: channel provider interface          |
| `src/notifications/channels/telegram.ts`              | New: Telegram Bot API provider           |
| `src/api/routes/notification-publishers.ts`           | New: API routes                          |
| `src/api/server.ts`                                   | Register routes, wire dependencies       |
| `src/index.ts`                                        | Initialize service                       |
| `src/api/routes/backup.ts`                            | Add tables to BACKUP_TABLES              |
| `ui/src/store/notification-publishers.ts`             | New: Zustand store                       |
| `ui/src/pages/NotificationPublishersPage.tsx`         | New: UI page                             |
| `ui/src/App.tsx`                                      | Add route                                |
