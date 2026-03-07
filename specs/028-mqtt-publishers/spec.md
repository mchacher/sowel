# MQTT Publishers

## Summary

Generic MQTT key/value publisher that listens to Sowel state changes (equipment data, zone aggregations) and publishes them to configurable MQTT topics. Each publisher has a topic and a list of mappings that bind a Sowel data source to a publish key. Messages are published with retain=true.

## Reference

- Custom feature, not part of existing roadmap milestones
- Pattern: HistoryWriter (passive event observer)

## Acceptance Criteria

- [ ] Users can create/edit/delete MQTT publishers via the Admin UI
- [ ] Each publisher has a name, MQTT topic, and enabled toggle
- [ ] Users can add/remove mappings (publish key + source type/id/key)
- [ ] Source types: equipment data binding alias OR zone aggregation key
- [ ] On equipment.data.changed or zone.data.changed, matching mappings publish `{"key": value}` to the publisher's topic
- [ ] Messages are published with retain=true
- [ ] MQTT broker settings are configurable (fallback to Zigbee2MQTT broker)
- [ ] Publisher uses its own MQTT connection (client ID: sowel-publisher)
- [ ] TypeScript compiles with zero errors (backend + frontend)

## Scope

### In Scope

- CRUD for publishers and mappings (backend + API + UI)
- Reactive MQTT publishing on state changes
- MQTT retain=true for all published messages
- MQTT broker settings (URL, username, password) via settings
- Fallback to Zigbee2MQTT broker settings
- Admin UI page under Administration section

### Out of Scope

- Combined JSON mode (all mappings in single message)
- Per-mapping retain toggle
- QoS configuration
- Webhook or other output channels (notification system)
- Templated payloads (always `{"key": value}`)

## Edge Cases

- No MQTT broker configured: service disabled, warning logged
- Equipment/zone deleted: orphaned mapping ignored (warning log)
- MQTT broker disconnected: messages silently dropped (MqttConnector handles reconnect)
- Settings changed: automatic MQTT reconnection
