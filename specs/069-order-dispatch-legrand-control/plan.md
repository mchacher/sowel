# Spec 069 — Implementation Plan

## Tasks

- [ ] 1. Add `apiVersion: 2` to plugin class
- [ ] 2. Add `orderMeta` Map to plugin class
- [ ] 3. Populate Map during `parseModule` discovery (sourceDeviceId:orderKey → metadata)
- [ ] 4. Rewrite `executeOrder` to `(device, orderKey, value)` — lookup metadata from Map
- [ ] 5. Remove `dispatchConfig` from discovery orders
- [ ] 6. Update local interfaces (IntegrationPlugin, DiscoveredDevice)
- [ ] 7. Build and test locally
- [ ] 8. Release legrand-control v2.0.0
- [ ] 9. Update registry
- [ ] 10. Update spec (acceptance criteria)

---

## Test Plan

### Modules to test

- Plugin `executeOrder` — order dispatch via internal Map lookup

### Scenarios

| Module       | Scenario                                    | Expected                                                                                |
| ------------ | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| executeOrder | Light toggle (param: "on")                  | Looks up meta for sourceDeviceId:on, calls bridge.setState with correct homeId/moduleId |
| executeOrder | Brightness set (param: "brightness")        | Looks up meta for sourceDeviceId:brightness                                             |
| executeOrder | Shutter position (param: "target_position") | Looks up meta for sourceDeviceId:target_position                                        |
| executeOrder | Unknown device/orderKey                     | Throws "Order metadata not found"                                                       |
| executeOrder | Not connected                               | Throws "not connected"                                                                  |
| discovery    | parseModule populates orderMeta Map         | Map contains entries for each order key                                                 |
| discovery    | Re-discovery refreshes Map                  | Old entries replaced with new ones                                                      |

Note: this is an external plugin — tests are manual (no Vitest in plugin repos).
