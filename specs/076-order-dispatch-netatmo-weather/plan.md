# Spec 076 — Implementation Plan

## Tasks

- [ ] 1. Update local interfaces (IntegrationPlugin, DiscoveredDevice)
- [ ] 2. Add `apiVersion: 2` to plugin class
- [ ] 3. Update executeOrder signature (still throws)
- [ ] 4. Build
- [ ] 5. Release netatmo-weather v2.0.0
- [ ] 6. Update registry

---

## Test Plan

### Scenarios

| Module       | Scenario                   | Expected                                                   |
| ------------ | -------------------------- | ---------------------------------------------------------- |
| executeOrder | Any order                  | Throws "read-only"                                         |
| discovery    | Weather station discovered | Categories temperature/humidity/pressure/co2/noise correct |
| discovery    | Modules discovered         | Categories battery/wind/rain correct                       |
| plugin       | Status reported            | Plugin starts and reports "connected"                      |

Note: read-only plugin — tests are manual.
