# Implementation Plan: V0.10b Panasonic Comfort Cloud Integration

## Architecture: Python Bridge

Uses `aio-panasonic-comfort-cloud` (Python, community-maintained by HA) via a CLI bridge script, instead of a TypeScript port. Node.js spawns `python3 bridge.py <command>` and parses JSON output.

## Tasks

1. [ ] **Python bridge** — Create `src/integrations/panasonic-cc/bridge.py` (CLI wrapper around `aio-panasonic-comfort-cloud`: login, get_devices, get_device, control)
2. [ ] **requirements.txt** — Create `requirements.txt` with `aio-panasonic-comfort-cloud`
3. [ ] **Bridge types** — Create `src/integrations/panasonic-cc/panasonic-types.ts` (TS types for bridge JSON responses, enum value lists)
4. [ ] **Bridge wrapper** — Create `src/integrations/panasonic-cc/panasonic-bridge.ts` (child_process spawn, JSON parse, timeout handling)
5. [ ] **Poller** — Create `src/integrations/panasonic-cc/panasonic-poller.ts` (regular + on-demand polling via Node.js timers)
6. [ ] **Integration plugin** — Create `src/integrations/panasonic-cc/index.ts` (IntegrationPlugin: settings schema, start/stop, executeOrder, device mapping)
7. [ ] **Types** — Add `"thermostat"` to EquipmentType in `src/shared/types.ts`
8. [ ] **EquipmentManager** — Add `"thermostat"` to VALID_EQUIPMENT_TYPES
9. [ ] **Register** — Update `src/index.ts` to register PanasonicCCIntegration
10. [ ] **UI ThermostatCard** — Create thermostat dashboard widget (temperature, mode, fan, power)
11. [ ] **UI EquipmentDetailPage** — Add thermostat-specific detail view
12. [ ] **Translations** — Add FR/EN translations for thermostat + Panasonic
13. [ ] **Tests** — Unit tests for bridge wrapper (mocked child_process), device mapping, poller scheduling
14. [ ] **Validation** — `npx tsc --noEmit` backend + frontend, `npm test`, lint

## Dependencies

- **Python 3.10+** on the host
- **pip**: `aio-panasonic-comfort-cloud`
- **npm**: no new dependencies

## Testing

- Unit tests: PanasonicBridge (mock child_process.execFile), device discovery mapping, enum conversions
- Unit tests: PanasonicPoller (timer mocks)
- Integration test: requires real Panasonic account (manual only)
- Manual: configure credentials in UI → verify devices appear → control AC → check polling updates
