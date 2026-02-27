# Implementation Plan: V0.8f Zone Commands

## Tasks

1. [ ] `zone-manager.ts` — Add `getDescendantIds(zoneId)` recursive helper
2. [ ] `equipment-manager.ts` — Add `executeZoneOrder(zoneIds, orderKey)` method
3. [ ] `zones.ts` route — Add `POST /:id/orders/:orderKey` endpoint
4. [ ] `ui/src/api.ts` — Add `executeZoneOrder()` API function
5. [ ] `ZoneDetailPage.tsx` — Add zone command buttons in header
6. [ ] TypeScript compile + tests pass
7. [ ] Manual verification

## Testing

- Call API on a leaf zone → only its equipments affected
- Call API on a parent zone → all descendant equipments affected
- Call on zone with no matching equipment → returns { executed: 0, errors: 0 }
