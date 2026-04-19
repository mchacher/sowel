# Spec 080 — Implementation Plan

## Task Breakdown

### Phase A: Plugin repository `sowel-plugin-tasmota`

- [ ] A.1 Create GitHub repo `sowel-plugin-tasmota` (public, MIT)
- [ ] A.2 Scaffold `package.json` with tsc + mqtt deps, mirror z2m plugin structure
- [ ] A.3 Write `manifest.json` (id, settings: mqtt_url, mqtt_username, mqtt_password, mqtt_client_id, base_topic, apiVersion 2)
- [ ] A.4 Implement `src/tasmota-parser.ts`:
  - Parse STATUS 0 → extract module, friendlyName, relay count, shutter config
  - Parse STATE/STATUS11/RESULT → extract POWER states + shutter positions
  - Build `DiscoveredDevice` (data + orders), skipping shutter-absorbed relays
- [ ] A.5 Implement `src/tasmota-plugin.ts`:
  - `createPlugin(deps)` returning `IntegrationPlugin`
  - MQTT connect/disconnect lifecycle
  - Subscribe to `tele/+/LWT`, `tele/+/STATE`, `stat/+/RESULT`, `stat/+/STATUS0/11`
  - On LWT=Online: publish STATUS 0 + STATUS 11
  - On STATUS 0 response: call `deviceManager.upsertFromDiscovery`
  - On STATE/STATUS11/RESULT: call `deviceManager.updateDeviceData`
  - On LWT=Offline: call `deviceManager.updateDeviceStatus(offline)`
  - Implement `executeOrder(device, orderKey, value)` → publish cmnd topic
- [ ] A.6 Write `src/tasmota-parser.test.ts` — cover the scenarios in test plan
- [ ] A.7 Add `.github/workflows/release.yml` (tag-triggered, builds tarball, attaches to release)
- [ ] A.8 Write README with Tasmota setup pointers (MQTT broker, Topic config, FullTopic setting)
- [ ] A.9 Release v1.0.0 (git tag + GitHub release)

### Phase B: Sowel registry update

- [ ] B.1 Add entry to `plugins/registry.json`:
  ```json
  {
    "id": "tasmota",
    "type": "integration",
    "name": "Tasmota",
    "description": "Tasmota-flashed devices (Sonoff, etc.) via MQTT",
    "icon": "Power",
    "author": "mchacher",
    "repo": "mchacher/sowel-plugin-tasmota",
    "version": "1.0.0",
    "tags": ["tasmota", "sonoff", "mqtt", "switch", "shutter"],
    "sowelVersion": ">=1.2.12"
  }
  ```
- [ ] B.2 Commit + push (no Sowel release needed — registry is fetched from main)

### Phase C: Manual validation

- [ ] C.1 Install plugin on local Sowel instance
- [ ] C.2 Configure MQTT settings (broker URL)
- [ ] C.3 Verify `SONOFF_4CH_PRO_PISCINE` auto-discovered with 2 relays + 1 shutter
- [ ] C.4 Verify `SONOFF_MINI_RADIATEUR_SDB` auto-discovered with 1 relay
- [ ] C.5 Bind relays to equipments (pompe, spot, radiateur), shutter to shutter equipment
- [ ] C.6 Test orders: ON/OFF relays, shutter position/open/close/stop
- [ ] C.7 Test offline detection (power off the Sonoff)

## Test Plan

### Modules to test

- `tasmota-parser` — STATUS 0 parsing + STATE parsing + DiscoveredDevice building

### Scenarios

| Module         | Scenario                                                                  | Expected                                                                                                                     |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| tasmota-parser | Parse STATUS 0 for Sonoff Mini (1 relay, no shutter)                      | 1 data + 1 order, both `power1`, no shutter entries                                                                          |
| tasmota-parser | Parse STATUS 0 for Sonoff 4CH Pro (4 relays, no shutter)                  | 4 data + 4 orders, `power1..power4`                                                                                          |
| tasmota-parser | Parse STATUS 0 for 4CH Pro with shutter on relays 1+2                     | 2 data (power3, power4, shutter_position) + 3 orders (power3, power4, shutter_state, shutter_position); POWER1/2 NOT exposed |
| tasmota-parser | Parse STATE with POWER1=ON, POWER2=OFF                                    | Returns `{ power1: "ON", power2: "OFF" }`                                                                                    |
| tasmota-parser | Parse STATE with Shutter1 position                                        | Returns `{ shutter_position: 50 }`                                                                                           |
| tasmota-parser | Parse RESULT message with single POWER toggle                             | Returns only that key change                                                                                                 |
| tasmota-parser | Parse STATUS 0 with missing FriendlyName                                  | Falls back to Topic as friendlyName                                                                                          |
| tasmota-parser | Parse malformed JSON (truncated, invalid)                                 | Returns null, does not throw                                                                                                 |
| tasmota-parser | Build DiscoveredDevice for device with shutter but no regular relays left | Only shutter data/orders, no power entries                                                                                   |

### Implementation order

1. Types + parser shape
2. Parser implementation
3. Parser tests (cover all scenarios above)
4. Plugin wiring (MQTT + executeOrder)
5. Manual test against real Tasmota devices
