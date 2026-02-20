# Implementation Plan: Shutter Equipment Controls & Aggregation

## Tasks

1. [ ] Update `src/shared/types.ts` — add shuttersOpen, shuttersTotal, averageShutterPosition to ZoneAggregatedData
2. [ ] Update `ui/src/types.ts` — mirror backend type changes
3. [ ] Update `src/zones/zone-aggregator.ts` — add shutter accumulation in Accumulator, accumulateBindings, mergeAccumulators, accumulatorToPublic, aggregatedDataEqual
4. [ ] Add shutter aggregation tests in `src/zones/zone-aggregator.test.ts`
5. [ ] Update `ui/src/components/home/CompactEquipmentCard.tsx` — add shutter controls (Open/Stop/Close buttons + position %)
6. [ ] Update `ui/src/components/home/ZoneAggregationHeader.tsx` — add shutter pill
7. [ ] TypeScript compile check (backend + frontend)
8. [ ] Run all tests

## Dependencies

- Requires existing shutter EquipmentType and shutter_position DataCategory (already in place)
- Requires existing executeOrder mechanism (already in place)

## Testing

- Unit tests: shutter aggregation in zone-aggregator.test.ts
- Manual: create shutter equipment bound to a z2m cover device, verify buttons control the shutter and position updates in real-time
