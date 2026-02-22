# Implementation Plan: V0.10b Panasonic Comfort Cloud Integration

## Tasks

1. [ ] **Types** — Add `"panasonic_cc"` to DeviceSource, `"thermostat"` to EquipmentType
2. [ ] **Panasonic types** — Create `src/integrations/panasonic-cc/panasonic-types.ts` (API types, enums, constants)
3. [ ] **Panasonic client** — Create `src/integrations/panasonic-cc/panasonic-client.ts` (OAuth2 PKCE auth, token management, ACC API calls)
4. [ ] **Panasonic discovery** — Create `src/integrations/panasonic-cc/panasonic-discovery.ts` (map API response to Corbel Device/Data/Orders)
5. [ ] **Panasonic poller** — Create `src/integrations/panasonic-cc/panasonic-poller.ts` (regular + on-demand polling, request mutex)
6. [ ] **Panasonic integration** — Create `src/integrations/panasonic-cc/index.ts` (IntegrationPlugin, wire everything)
7. [ ] **Register integration** — Update `src/index.ts` to register PanasonicCCIntegration
8. [ ] **EquipmentManager** — Add `"thermostat"` to VALID_EQUIPMENT_TYPES
9. [ ] **UI ThermostatCard** — Create thermostat dashboard widget (temperature, mode, fan, power)
10. [ ] **UI ThermostatControl** — Create control components (temp up/down, mode selector, fan selector)
11. [ ] **UI EquipmentDetailPage** — Add thermostat-specific detail view
12. [ ] **UI Translations** — Add FR/EN translations for thermostat + Panasonic
13. [ ] **Install dependency** — Add `node-html-parser` to package.json
14. [ ] **Tests** — Unit tests for PanasonicClient (auth flow mock), discovery mapping, poller scheduling
15. [ ] **Type-check + lint** — Verify zero errors on backend and frontend

## Dependencies

- Requires V0.10a (Integration Plugin Architecture) to be completed first
- npm: `node-html-parser` (HTML parsing for Auth0 login flow)

## Testing

- Unit tests: PanasonicClient auth flow (mocked HTTP), device discovery mapping, enum conversions
- Unit tests: Poller scheduling (timer mocks), request mutex
- Integration test: requires real Panasonic account (manual only)
- Manual: configure credentials in UI, verify devices appear, control AC, check polling updates
