# Architecture — Spec 090

## Data model

### Migration `008_mqtt_publisher_mapping_enabled.sql`

```sql
ALTER TABLE mqtt_publisher_mappings ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
```

Existing rows get `enabled = 1` automatically (default applies on `ALTER TABLE`).

### Types — `src/shared/types.ts`

```ts
export interface MqttPublisherMapping {
  id: string;
  publisherId: string;
  publishKey: string;
  sourceType: "equipment" | "zone" | "recipe";
  sourceId: string;
  sourceKey: string;
  enabled: boolean; // NEW
  createdAt: string;
}
```

UI mirror in `ui/src/types.ts` — same field added.

## Backend changes

### `src/mqtt-publishers/mqtt-publisher-manager.ts`

- `MappingRow` gets `enabled: number`.
- `rowToMapping` reads `row.enabled === 1`.
- `prepareStatements`:
  - `insertMapping` adds `enabled` column.
  - `updateMapping` SQL adds `enabled = ?`.
- `addMapping(input)` accepts optional `enabled?: boolean` (default `true`).
- `updateMapping(input)` accepts optional `enabled?: boolean`.
- Both paths emit `mqtt-publisher.mapping.created` / `.updated` so the publish
  service rebuilds its index. (Today only `created` exists for updates — keep that
  same event so the service refreshes; no new event type needed.)

### `src/mqtt-publishers/mqtt-publish-service.ts`

`MappingRef` gets `mappingEnabled: boolean`. The skip condition becomes:

```ts
if (!ref.enabled || !ref.mappingEnabled || !ref.brokerId) continue;
```

`publishInitialSnapshot`, `publishInitialSnapshotForBroker`, and
`publishSnapshotForPublisher` skip mappings where `mapping.enabled === false`.

### API — `src/api/routes/mqtt-publishers.ts`

- `POST /mqtt-publishers/:id/mappings` body adds `enabled?: boolean`.
- `PUT /mqtt-publishers/:id/mappings/:mappingId` body adds `enabled?: boolean`.

No new endpoint — the existing PUT is already used by the UI to change publish_key,
sourceType, sourceId, sourceKey.

## Frontend changes

### `ui/src/api.ts`

`addMqttPublisherMapping` and `updateMqttPublisherMapping` payloads accept `enabled?: boolean`.

### `ui/src/pages/MqttPublishersPage.tsx`

`MappingRow` (display mode):

- Wrap row in `opacity-50` when `!mapping.enabled`.
- Add a power-off / power-on icon button between the pencil and the trash:
  - When `mapping.enabled`: `<Power />` icon, hover green / orange (use Lucide
    `Power` stroke 1.5px).
  - When not: muted state.
- On click, `updateMqttPublisherMapping(publisherId, mapping.id, { enabled: !mapping.enabled })`
  then `onRefresh()`.

i18n keys (FR + EN): `mqttPublishers.mappingEnable`, `mqttPublishers.mappingDisable` for the
icon `aria-label` / `title`.

## Event flow

Unchanged — toggling `enabled` triggers the existing
`mqtt-publisher.mapping.created` event (emitted by `updateMapping`), which causes
`MqttPublishService.rebuildIndex()` and `publishInitialSnapshot()`. The new index
respects the per-mapping flag so a freshly disabled mapping is no longer in the live
fan-out.
