# Spec 075 — Implementation Plan

## Tasks

- [ ] 1. Update local interfaces (IntegrationPlugin, DiscoveredDevice)
- [ ] 2. Add `apiVersion: 2` to plugin class
- [ ] 3. Update executeOrder signature (still throws)
- [ ] 4. Build
- [ ] 5. Release legrand-energy v2.0.0
- [ ] 6. Update registry

---

## Test Plan

### Modules to test

- Plugin interface coherence (no logic change)

### Scenarios

| Module       | Scenario                  | Expected                              |
| ------------ | ------------------------- | ------------------------------------- |
| executeOrder | Any order                 | Throws "does not support orders"      |
| discovery    | Energy devices discovered | Categories power/energy correct       |
| plugin       | Status reported           | Plugin starts and reports "connected" |

Note: read-only plugin — tests are manual (verify energy data still flows).
