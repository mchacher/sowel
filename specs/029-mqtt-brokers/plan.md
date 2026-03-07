# Implementation Plan: MQTT Brokers

## Tasks

### Backend

1. [ ] Create migration `029_mqtt_brokers.sql` — new table + add `broker_id` column to `mqtt_publishers`
2. [ ] Update `types.ts` — add `MqttBroker` interface, update `MqttPublisher` with `brokerId`, add broker events to `EngineEvent`
3. [ ] Create `mqtt-broker-manager.ts` — CRUD for brokers (list, getById, create, update, delete with publisher check)
4. [ ] Update `mqtt-publisher-manager.ts` — add `brokerId` to create/update, update row mapper and prepared statements
5. [ ] Rewrite `mqtt-publish-service.ts` — replace single client with broker connection pool, route publishes by brokerId
6. [ ] Create `api/routes/mqtt-brokers.ts` — REST endpoints for broker CRUD
7. [ ] Update `api/routes/mqtt-publishers.ts` — add `brokerId` to create/update endpoints
8. [ ] Update `api/server.ts` — register broker routes, instantiate broker manager
9. [ ] Update `api/websocket.ts` — broadcast broker events
10. [ ] Update `api/routes/backup.ts` — include brokers in backup/restore
11. [ ] Update `index.ts` — instantiate broker manager, pass to dependencies

### Frontend

12. [ ] Update `ui/src/types.ts` — add `MqttBroker`, update `MqttPublisher`
13. [ ] Update `ui/src/api.ts` — add broker CRUD API functions
14. [ ] Update `ui/src/pages/MqttPublishersPage.tsx` — broker section + broker selector in publisher form
15. [ ] Update `ui/src/i18n/locales/en.json` and `fr.json` — broker translations

### Validation

16. [ ] TypeScript compiles (zero errors) — backend and frontend
17. [ ] All tests pass
18. [ ] Clean up old settings references (`mqtt-publisher.brokerUrl`, etc.)

## Dependencies

- No external dependencies required

## Testing

- Create a broker via API/UI
- Create a publisher linked to that broker
- Add mappings and verify MQTT publish goes to the correct broker
- Try deleting a broker with publishers → should be blocked
- Update broker credentials → verify reconnect
