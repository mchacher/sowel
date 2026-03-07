# MQTT Brokers — Multi-Broker Support for Publishers

## Summary

Allow users to define multiple MQTT brokers and associate each MQTT publisher with a specific broker. This replaces the current single-broker settings (`mqtt-publisher.brokerUrl`, `mqtt-publisher.username`, `mqtt-publisher.password`) with a proper `mqtt_brokers` entity.

## Acceptance Criteria

- [ ] Users can create, read, update, and delete MQTT brokers (name, url, username, password)
- [ ] Each MQTT publisher must reference a broker via `brokerId` (mandatory, not nullable)
- [ ] The `MqttPublishService` maintains a pool of MQTT connections — one per active broker
- [ ] When a publisher publishes, it uses the MQTT client of its associated broker
- [ ] When a broker is deleted, its publishers can no longer publish (orphaned — `brokerId` FK cascade or block)
- [ ] The old settings-based broker config (`mqtt-publisher.brokerUrl`, etc.) is removed
- [ ] UI shows a "Brokers" section at the top of the MQTT Publishers page (replaces the old broker settings panel)
- [ ] UI publisher create/edit form includes a broker selector dropdown
- [ ] Existing publishers without a `brokerId` cannot publish until reconfigured

## Scope

### In Scope

- New `mqtt_brokers` SQLite table with CRUD
- New REST API endpoints for broker CRUD
- `brokerId` column on `mqtt_publishers` table (mandatory)
- Connection pool in `MqttPublishService` (one client per broker)
- UI: broker management section + broker selector in publisher forms
- WebSocket events for broker CRUD
- Backup/restore includes brokers

### Out of Scope

- Using these brokers for integrations (Z2M, Lora2MQTT) — they keep their own MQTT config
- TLS/certificate management for brokers (can be added later)
- Broker health monitoring / connection status display (can be added later)

## Edge Cases

- Broker deleted while publishers reference it → CASCADE delete publishers, or block deletion if publishers exist? **Decision: block deletion — user must reassign or delete publishers first.**
- Broker connection fails → publishers on that broker silently skip (existing behavior for connection errors)
- Broker credentials updated → reconnect the client for that broker
- Multiple publishers on the same broker → share the same MQTT client connection
