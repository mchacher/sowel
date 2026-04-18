# Spec 071 — Implementation Plan

## Tasks

- [x] 1. Update local interfaces (IntegrationPlugin, DiscoveredDevice)
- [x] 2. Add `apiVersion: 2` to plugin class
- [x] 3. Create static map `ORDER_KEY_TO_COMMAND`
- [x] 4. Rewrite `executeOrder` to `(device, orderKey, value)` — resolve commandId from map
- [x] 5. Remove `dispatchConfig` from discovery orders
- [x] 6. Fix categories: power → `"power"`, targetTemperature → `"setpoint"`
- [x] 7. Build and test locally
- [ ] 8. Release mcz-maestro v2.0.0
- [ ] 9. Update registry
- [ ] 10. Mark spec as done

---

## Test Plan

### Modules to test

- Plugin `executeOrder` — static commandId resolution

### Scenarios

| Module       | Scenario               | Expected                                                                    |
| ------------ | ---------------------- | --------------------------------------------------------------------------- |
| executeOrder | Power on               | Resolves orderKey "power" → commandId 34, sends POWER_ON_VALUE              |
| executeOrder | Power off              | Resolves orderKey "power" → commandId 34, sends POWER_OFF_VALUE             |
| executeOrder | Set target temperature | Resolves orderKey "targetTemperature" → commandId 42, sends value \* 2      |
| executeOrder | Change profile         | Resolves orderKey "profile" → commandId 149, converts profile string to raw |
| executeOrder | Toggle eco mode        | Resolves orderKey "ecoMode" → commandId 41, sends 1/0                       |
| executeOrder | Reset alarm            | Resolves orderKey "resetAlarm" → commandId 1, sends RESET_ALARM_VALUE       |
| executeOrder | Unknown orderKey       | Throws error                                                                |
| executeOrder | Not connected          | Throws "not connected"                                                      |
| discovery    | Categories correct     | power → "power", targetTemperature → "setpoint"                             |

Note: external plugin — tests are manual.
