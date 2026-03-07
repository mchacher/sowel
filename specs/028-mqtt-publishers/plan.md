# Implementation Plan: MQTT Publishers

## Tasks

1. [ ] Migration SQL (022_mqtt_publishers.sql)
2. [ ] Backend types (src/shared/types.ts + EngineEvent)
3. [ ] MqttPublisherManager CRUD (src/mqtt-publishers/mqtt-publisher-manager.ts)
4. [ ] API routes (src/api/routes/mqtt-publishers.ts)
5. [ ] MqttPublishService (src/mqtt-publishers/mqtt-publish-service.ts)
6. [ ] Wiring: server.ts, index.ts, websocket.ts
7. [ ] Frontend types + API functions
8. [ ] MqttPublishersPage UI
9. [ ] Routing, sidebar, i18n
10. [ ] TypeScript compilation (zero errors)

## Dependencies

- Requires existing MqttConnector (src/mqtt/mqtt-connector.ts)
- Requires existing EquipmentManager, ZoneAggregator for snapshot
- Follows HistoryWriter pattern for event listening
- Follows ChartManager pattern for CRUD

## Testing

- Create publisher via UI with topic `sowel/homedisplay/livingroom`
- Add mappings to existing equipments/zones
- `mosquitto_sub -t "sowel/homedisplay/#" -v` to verify published messages
- Change equipment state → verify immediate MQTT publication
- Verify retain=true (reconnect subscriber → receives last values)
