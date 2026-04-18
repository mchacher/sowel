# Spec 073 — Implementation Plan

## Tasks

- [ ] 1. Update local interfaces (IntegrationPlugin, DiscoveredDevice)
- [ ] 2. Add `apiVersion: 2` to plugin class
- [ ] 3. Create static map `ORDER_KEY_TO_COMMAND`
- [ ] 4. Rewrite `executeOrder` to `(device, orderKey, value)` — resolve command from map
- [ ] 5. Remove `dispatchConfig` from discovery orders
- [ ] 6. Build
- [ ] 7. Release smartthings v2.0.0
- [ ] 8. Update registry
- [ ] 9. Mark spec as done

---

## Test Plan

### Modules to test

- Plugin `executeOrder` — static command resolution

### Scenarios

| Module       | Scenario                                 | Expected                                                    |
| ------------ | ---------------------------------------- | ----------------------------------------------------------- |
| executeOrder | Power on (TV)                            | Resolves orderKey "power" → command "switch", sends on      |
| executeOrder | Power off (TV)                           | Resolves orderKey "power" → command "switch", sends off     |
| executeOrder | Mute toggle                              | Resolves orderKey "mute" → command "mute"                   |
| executeOrder | Set input source                         | Resolves orderKey "input_source" → command "setInputSource" |
| executeOrder | Unknown orderKey                         | Throws error                                                |
| executeOrder | Not connected                            | Throws "not connected"                                      |
| discovery    | TV orders created without dispatchConfig | Orders have key but no dispatchConfig                       |
| discovery    | Washer has no orders                     | Data-only device unchanged                                  |

Note: external plugin — tests are manual. SmartThings TV not available for testing; washer (data-only) validates discovery doesn't break.
