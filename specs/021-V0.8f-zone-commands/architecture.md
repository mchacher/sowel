# Architecture: V0.8f Zone Commands

## Data Model Changes

None. No new tables or columns.

## Event Bus Events

No new events. Existing `equipment.order.executed` fires for each individual order.

## API Changes

### New endpoint

```
POST /api/v1/zones/:id/orders/:orderKey
```

**Path params:**

- `id` — zone UUID
- `orderKey` — one of: `allLightsOn`, `allLightsOff`, `allShuttersOpen`, `allShuttersClose`

**Response (200):**

```json
{ "executed": 5, "errors": 0 }
```

**Errors:**

- 404 — zone not found
- 400 — invalid orderKey

## File Changes

| File                                  | Change                                                          |
| ------------------------------------- | --------------------------------------------------------------- |
| `src/zones/zone-manager.ts`           | Add `getDescendantIds(zoneId): string[]`                        |
| `src/equipments/equipment-manager.ts` | Add `executeZoneOrder(zoneIds, orderKey): { executed, errors }` |
| `src/api/routes/zones.ts`             | Add `POST /:id/orders/:orderKey` endpoint                       |
| `ui/src/pages/ZoneDetailPage.tsx`     | Add command buttons in header                                   |
| `ui/src/api.ts`                       | Add `executeZoneOrder(zoneId, orderKey)` API call               |
