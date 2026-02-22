# Implementation Plan: V0.10a Integration Plugin Architecture

## Tasks

1. [ ] **Types** — Update `types.ts`: Device (integrationId, sourceDeviceId), DeviceOrder (dispatchConfig), IntegrationPlugin interface, IntegrationInfo, IntegrationStatus, IntegrationSettingDef, new system events
2. [ ] **Migration** — Create `migrations/011_integration_architecture.sql`: rename columns, migrate data, update constraints
3. [ ] **IntegrationRegistry** — Create `src/integrations/integration-registry.ts`
4. [ ] **DeviceManager** — Refactor to use generic columns (integrationId, sourceDeviceId, dispatchConfig)
5. [ ] **Zigbee2MqttIntegration** — Create `src/integrations/zigbee2mqtt/index.ts`, wrap MqttConnector + Z2MParser
6. [ ] **EquipmentManager** — Replace `mqttConnector` dependency with `IntegrationRegistry`, delegate order execution
7. [ ] **SettingsManager** — Add integration-scoped settings helpers, migrate existing mqtt/z2m settings
8. [ ] **API routes** — Create `src/api/routes/integrations.ts`, remove MQTT-specific settings endpoints
9. [ ] **Server + Index** — Wire IntegrationRegistry in server.ts and index.ts
10. [ ] **UI IntegrationsPage** — Refactor to generic integration cards from API
11. [ ] **UI API + translations** — Add integration API functions, update fr/en translations
12. [ ] **Tests** — Update existing tests, add integration registry tests
13. [ ] **Type-check + lint** — Verify zero errors on backend and frontend

## Dependencies

- Requires all V0.1–V0.9 to be completed (they are)
- No external dependencies

## Testing

- All existing 273+ tests must pass
- New tests: IntegrationRegistry (register, start, stop, getById), Zigbee2MqttIntegration (settings validation, order dispatch)
- Manual: connect to real zigbee2mqtt, verify devices appear, execute orders, check UI IntegrationsPage
