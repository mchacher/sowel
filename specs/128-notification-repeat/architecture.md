# Spec 128 — Architecture

## Data model

### Migration `012_notification_mapping_repeat.sql`

```sql
ALTER TABLE notification_publisher_mappings ADD COLUMN repeat_ms INTEGER;
ALTER TABLE notification_publisher_mappings ADD COLUMN repeat_max INTEGER;
```

- `repeat_ms`: `NULL` = no re-notification. `> 0` = interval between reminders.
- `repeat_max`: `NULL` = forever (only meaningful when `repeat_ms` set). `>= 1` =
  maximum number of reminders (excludes the initial notification).

### `src/shared/types.ts`

```ts
export interface NotificationPublisherMapping {
  // …existing…
  repeatMs?: number | null; // null = no re-notify
  repeatMax?: number | null; // null = forever, N = max reminders
}
```

Mapping create/update input types gain the same two optional fields.

## Event flow (unchanged inputs)

The service already subscribes to `equipment.data.changed`,
`zone.data.changed`, `recipe.instance.state.changed` and dispatches per mapping
through the `type:id:key` index. No new events.

## `NotificationPublishService` changes

New per-mapping in-memory state:

```
repeatTimers:  Map<mappingId, Timeout>   // running reminder timer
repeatCount:   Map<mappingId, number>    // reminders already sent this episode
activeMappings: Set<mappingId>           // currently in an "active" episode
```

Helper `isActiveValue(value): boolean` per the spec definition.

### Dispatch (`handleSourceChanged`, per ref)

- If the ref has **no** `repeatMs` → existing behaviour (unchanged).
- If the ref **has** `repeatMs`:
  - `active = isActiveValue(value)`
  - **active & not in `activeMappings`** → activation: send now (throttle path),
    `activeMappings.add`, `repeatCount = 1`, `startRepeatTimer(ref)`.
  - **active & already active** → a value changed but stays active: re-send once
    (throttle path) and reset the timer + counter (treat as a fresh episode).
  - **inactive & in `activeMappings`** → deactivation: `stopRepeat(ref)`
    (clear timer, `activeMappings.delete`, `repeatCount = 0`) and send nothing.
  - **inactive & not active** → nothing.

Note: `handleSourceChanged` early-returns on `null`/`undefined`, so a
deactivation to `null` never reaches here — see the timer re-check below.

### Repeat timer

```
startRepeatTimer(ref):
  every ref.repeatMs:
    value = resolveCurrentValue(ref source)      // re-read live value
    if !isActiveValue(value): stopRepeat(ref); return   // robust auto-stop
    if ref.repeatMax != null && repeatCount >= ref.repeatMax + initial:
        clear timer (stop sending) but stay "active"    // capped; wait for deactivation
        return
    sendNotification(ref, formatNotificationContent(ref.message, value))
    repeatCount++
```

The re-read on each tick means deactivation to `null` (which bypasses the
dispatch) is caught at the next tick and the timer stops without sending.

### Lifecycle

- `init()` — after `rebuildIndex()`, for every repeat-enabled mapping evaluate
  `resolveCurrentValue`; if active, mark active and start the timer **without an
  immediate send** (resume reminders after a restart; counter starts fresh).
- `rebuildIndex()` (on any mapping CRUD) — cancel **all** repeat timers, clear
  `activeMappings`/`repeatCount`, then re-run the `init()` resume pass so edited/
  removed mappings pick up their new config.
- `destroy()` — clear all repeat timers.

## API

`src/notifications/notification-publisher-manager.ts` — `addMapping` /
`updateMapping` accept `repeatMs?` + `repeatMax?`, validated (positive integers
or null; `repeatMax` requires `repeatMs`). `rowToMapping` maps the columns.

`src/api/routes/notification-publishers.ts` — mapping POST/PUT bodies gain the
two fields.

## UI

`ui/src/types.ts` — mirror the mapping fields.

`ui/src/pages/NotificationPublishersPage.tsx` (`AddMappingForm` + `MappingRow`
edit) — an explicit **Re-notify** control:

- Mode select: `None` · `Forever` · `Limited`.
- When `Forever`/`Limited`: an "every N min" input (→ `repeatMs`).
- When `Limited`: a "max reminders" input (→ `repeatMax`).

Derived on save: `None` → `repeatMs=null,repeatMax=null`; `Forever` →
`repeatMs=set,repeatMax=null`; `Limited` → both set. Pure mapping helper in
`ui/src/lib/notif-mapping.ts` for the mode ⇄ (repeatMs, repeatMax) conversion,
unit-tested.

## Files touched

- `migrations/012_notification_mapping_repeat.sql` (new)
- `src/shared/types.ts`
- `src/notifications/notification-publish-service.ts`
- `src/notifications/notification-publisher-manager.ts`
- `src/api/routes/notification-publishers.ts`
- `ui/src/types.ts`, `ui/src/lib/notif-mapping.ts`, `ui/src/pages/NotificationPublishersPage.tsx`
- `ui/src/i18n/locales/{en,fr}.json`
- `docs/technical/api-reference.md`
