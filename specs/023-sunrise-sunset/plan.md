# Implementation Plan: Sunrise/Sunset

## Tasks

1. [ ] Install `suncalc` dependency
2. [ ] Add `sunrise`, `sunset`, `isDaylight` to `ZoneAggregatedData` in `src/shared/types.ts` + `ui/src/types.ts`
3. [ ] Create `src/zones/sunlight-manager.ts` — compute sunrise/sunset, manage isDaylight transitions
4. [ ] Wire SunlightManager into `src/index.ts` (create, start, pass to zone-aggregator)
5. [ ] Modify `src/zones/zone-aggregator.ts` — inject sunlight data into root zone aggregation output
6. [ ] Add home settings section in UI Settings page (lat, lon, sunriseOffset, sunsetOffset)
7. [ ] Add sunrise/sunset pill in `ZoneAggregationPills.tsx`
8. [ ] Add i18n keys (fr + en)
9. [ ] Build + test

## Testing

- Configure location (Paris: 48.8566, 2.3522)
- Verify `GET /api/v1/zones/aggregation` returns sunrise/sunset/isDaylight for root zone
- Verify WebSocket emits `zone.data.changed` when isDaylight transitions
- Verify UI shows sunrise/sunset pill on home page
- Verify null values when no location configured
