# Implementation Plan: Notification Publishers

## Iteration 1: Backend (API + service)

1. [x] Types: add NotificationPublisher, mapping, channel config, events to types.ts
2. [x] Migration: create notification_publishers and notification_publisher_mappings tables
3. [x] Channel interface + Telegram provider (HTTP fetch to Bot API)
4. [x] NotificationPublisherManager: CRUD with SQLite persistence + event emission
5. [x] NotificationPublishService: event subscription, index, throttle, dispatch
6. [x] API routes: CRUD + test-channel + test-publisher
7. [x] Wire in server.ts and index.ts
8. [x] Backup: add tables to BACKUP_TABLES
9. [x] Type-check + test

## Iteration 2: UI

10. [x] NotificationPublishersPage: publisher cards, inline edit, mapping rows (no separate Zustand store — uses inline fetch like MqttPublishersPage)
11. [x] Navigation: add to Administration section
12. [x] UI type-check
13. [ ] Manual test with real Telegram bot

## Testing

- `npx tsc --noEmit` (zero errors)
- `npm test` (all pass)
- Manual: create publisher with Telegram bot, add mapping, trigger value change, verify message received
