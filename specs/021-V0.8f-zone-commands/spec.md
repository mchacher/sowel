# V0.8f: Zone Commands

## Summary

Add consolidated commands at zone level: turn all lights on/off, open/close all shutters. Commands are always recursive — on a leaf zone they target its own equipments, on a parent zone they propagate to all descendant zones.

## Reference

- Spec sections: §6.3 (Zone Orders), §10 API (`POST /zones/:id/orders/:orderKey`)

## Accepted Commands

| orderKey           | Target types                             | Order alias | Value   |
| ------------------ | ---------------------------------------- | ----------- | ------- |
| `allLightsOn`      | light_onoff, light_dimmable, light_color | `state`     | `"ON"`  |
| `allLightsOff`     | light_onoff, light_dimmable, light_color | `state`     | `"OFF"` |
| `allShuttersOpen`  | shutter                                  | `position`  | `100`   |
| `allShuttersClose` | shutter                                  | `position`  | `0`     |

## Acceptance Criteria

- [ ] `POST /zones/:id/orders/allLightsOff` turns off all lights in zone + sub-zones
- [ ] `POST /zones/:id/orders/allLightsOn` turns on all lights in zone + sub-zones
- [ ] `POST /zones/:id/orders/allShuttersOpen` opens all shutters in zone + sub-zones
- [ ] `POST /zones/:id/orders/allShuttersClose` closes all shutters in zone + sub-zones
- [ ] Returns summary: `{ executed: N, errors: N }`
- [ ] Skips disabled equipments
- [ ] UI shows command buttons on zone detail page header
- [ ] Buttons shown conditionally (only if zone has lights/shutters)
- [ ] Parent zones show count ("12 lights across 4 rooms")

## Scope

### In Scope

- 4 zone order keys (lights on/off, shutters open/close)
- Recursive propagation via zone tree
- API endpoint
- UI buttons on ZoneDetailPage

### Out of Scope

- Custom shutter position (slider) — deferred
- Thermostat zone commands — deferred
- Scenario `zone_order` action type — deferred (separate task)

## Edge Cases

- Zone with no lights/shutters → buttons hidden, API returns `{ executed: 0, errors: 0 }`
- Equipment with no `state`/`position` order binding → skipped with warning
- Integration disconnected → error counted, execution continues for other equipments
