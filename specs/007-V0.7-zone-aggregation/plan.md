# Implementation Plan: V0.7 Zone Aggregation Engine

## Tasks

1. [ ] Add `ZoneAggregatedData` type and `zone.data.changed` event to `src/shared/types.ts`
2. [ ] Mirror types in `ui/src/types.ts`
3. [ ] Implement `src/zones/zone-aggregator.ts` — aggregation engine
4. [ ] Wire up ZoneAggregator in `src/index.ts`
5. [ ] Add `GET /api/v1/zones/aggregation` route
6. [ ] Write unit tests for zone-aggregator
7. [ ] Add `getZoneAggregation()` to `ui/src/api.ts`
8. [ ] Create `ui/src/store/useZoneAggregation.ts` — Zustand store
9. [ ] Handle `zone.data.changed` in `ui/src/store/useWebSocket.ts`
10. [ ] Create `ui/src/components/maison/ZoneAggregationHeader.tsx`
11. [ ] Integrate header in `ui/src/pages/MaisonPage.tsx`
12. [ ] TypeScript compilation check (backend + frontend)
13. [ ] Run all tests

## Dependencies

- Requires V0.6 sensor equipment support (equipment data bindings for sensors)

## Testing

- Unit tests: zone-aggregator logic (AVG, OR, COUNT strategies, recursive, edge cases)
- Manual: create sensor + light equipments in a zone, verify header updates in real-time
