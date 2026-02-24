# V0.10a: Integration Plugin Architecture

## Summary

Refactor Winch's device layer to support multiple data source integrations beyond MQTT. Introduce an `IntegrationPlugin` interface that abstracts device discovery, data updates, and order execution. The existing Zigbee2MQTT code becomes the first built-in plugin. This is a pure architectural refactoring — zero functional change for the end user.

## Reference

- Spec sections: §1 (Vision), §3 (Architecture), §4 (Devices), §6 (Equipments — Order dispatch)
- Prepares for V0.10b (Panasonic Comfort Cloud integration)

## Acceptance Criteria

- [ ] An `IntegrationPlugin` interface is defined in `src/shared/types.ts`
- [ ] An `IntegrationRegistry` manages plugin lifecycle (register, start, stop, list)
- [ ] The `Device` model uses generic columns (`integration_id`, `source_device_id`) instead of MQTT-specific ones (`mqtt_base_topic`, `mqtt_name`)
- [ ] The `DeviceOrder` model uses a generic `dispatch_config` JSON instead of `mqtt_set_topic` + `payload_key`
- [ ] `EquipmentManager.executeOrder()` delegates to the correct integration plugin instead of calling `mqttConnector.publish()` directly
- [ ] Zigbee2MQTT is refactored into `Zigbee2MqttIntegration implements IntegrationPlugin`
- [ ] The integration manages its own settings via `SettingsManager` (prefix `integration.<id>.xxx`)
- [ ] The UI IntegrationsPage renders integration cards dynamically from a registry endpoint
- [ ] All existing tests pass without regression
- [ ] All existing devices keep working (migration preserves data)
- [ ] TypeScript compiles with zero errors (backend + frontend)

## Scope

### In Scope

- `IntegrationPlugin` interface definition
- `IntegrationRegistry` (register, start, stop, getById, list)
- Database migration: generalize `devices` and `device_orders` columns
- Refactor `DeviceManager` to remove MQTT assumptions
- Refactor `EquipmentManager.executeOrder()` to use integration dispatch
- Wrap existing Zigbee2MQTT code in `Zigbee2MqttIntegration`
- API endpoint: `GET /api/v1/integrations` (list available integrations + status)
- UI: IntegrationsPage dynamically renders cards per integration
- Update `DeviceSource` type to be extensible

### Out of Scope (deferred to V0.10b)

- Panasonic Comfort Cloud integration
- `thermostat` EquipmentType
- Thermostat widget in dashboard
- OAuth2 authentication flow
- Polling-based data source support (will be added with Panasonic CC)
- Multi-instance per integration type

## Edge Cases

- What if migration runs on an empty DB? → No devices to migrate, tables created with new schema.
- What if an integration plugin fails to start? → Engine continues without it, logs error, integration marked as "error" status.
- What if a device's integration plugin is not registered? → Device still exists in DB but cannot receive updates or execute orders. API returns a warning.
- What if `executeOrder()` is called for a device whose integration is disconnected? → Return 503 (same as current MQTT behavior).
- What if settings for an integration are missing? → Integration reports "not_configured" status, doesn't start.
