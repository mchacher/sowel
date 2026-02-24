# V0.7: Zone Aggregation Engine

## Summary

Implement automatic zone-level data aggregation. When a zone contains sensor or light equipments, the engine computes consolidated values (average temperature, motion detected, lights on count, etc.) and exposes them in the Maison page header. Aggregation is recursive: parent zones include data from child zones.

## Reference

- Spec sections: winch-spec.md §Zone auto-aggregation, data-model.md §3.3

## Acceptance Criteria

- [ ] Backend zone aggregator computes aggregated data from equipment bindings
- [ ] Aggregation is recursive (parent zone = own equipments + child zones)
- [ ] Aggregated data updates in real-time on `equipment.data.changed` events
- [ ] New `zone.data.changed` event emitted when aggregated values change
- [ ] API endpoint returns aggregated data for all zones
- [ ] WebSocket broadcasts `zone.data.changed` to connected UI clients
- [ ] Maison page displays aggregation header above equipment list
- [ ] Header shows: temperature, humidity, motion, lights count, open doors/windows, alerts
- [ ] Only non-empty values shown (no "0 doors open" if no door sensors)
- [ ] TypeScript compiles with zero errors (backend + frontend)
- [ ] All existing tests pass + new unit tests for aggregator

## Scope

### In Scope

- Backend aggregation engine (`src/zones/zone-aggregator.ts`)
- Aggregation rules for sensors + lights:
  - `temperature` — AVG of temperature-category bindings
  - `humidity` — AVG of humidity-category bindings
  - `motion` — OR of motion-category bindings
  - `openDoors` — COUNT of contact_door where open (value = false/OFF)
  - `openWindows` — COUNT of contact_window where open (value = false/OFF)
  - `waterLeak` — OR of water_leak-category bindings
  - `smoke` — OR of smoke-category bindings
  - `lightsOn` — COUNT of light equipments where state = ON
  - `lightsTotal` — COUNT of all light equipments
- Recursive aggregation: parent zones aggregate own equipments + child zone aggregations
- New `zone.data.changed` event type
- New REST endpoint `GET /api/v1/zones/aggregation`
- UI aggregation header component in Maison page
- WebSocket propagation of zone.data.changed events
- Unit tests for aggregator logic

### Out of Scope

- `presence` (motion + timeout) — requires timer mechanism, deferred
- `averageBrightness`, `shuttersOpen`, `shuttersTotal` — deferred (no shutter equipments yet)
- `totalPower`, `totalEnergy` — deferred (no energy monitoring yet)
- `heatingActive`, `targetTemperature` — deferred (no thermostat equipments yet)
- Zone auto-orders (`allOff`, `allLightsOff`, `allLightsOn`) — separate feature
- InfluxDB history for zone aggregated data

## Edge Cases

- Zone with no equipments → all values null/0/false, header hidden
- Zone with only lights (no sensors) → show only lightsOn/lightsTotal
- Zone with only sensors (no lights) → show only sensor values
- Equipment moved to another zone → recompute both old and new zone
- Equipment deleted → recompute zone
- Multiple sensor equipments with same category → AVG for numeric, OR for boolean
- Null/undefined values in bindings → excluded from AVG calculation
- Parent zone with no direct equipments but children with equipments → aggregates children
- Deeply nested zones → recursive bottom-up computation
