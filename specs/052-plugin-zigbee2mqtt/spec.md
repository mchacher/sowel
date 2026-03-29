# 052 — Externalize Zigbee2MQTT as Plugin

## Summary

Migrate the Zigbee2MQTT integration from `src/integrations/zigbee2mqtt/` to an external plugin `sowel-plugin-zigbee2mqtt`. Last integration to migrate — most critical as it's the primary device source for most users.

## Current State

- Location: `src/integrations/zigbee2mqtt/` (+ uses `src/mqtt/connector.ts`, `src/mqtt/parsers/zigbee2mqtt.ts`)
- Dependencies: mqtt.js (moves to plugin package.json)
- State: settings in `settings` table (MQTT broker URL, base topic, credentials)
- Features: Full MQTT bridge — device discovery, state updates, order dispatch, availability tracking

## Special Considerations

- MqttConnector (`src/mqtt/connector.ts`) is the MQTT client wrapper — moves into plugin or plugin embeds its own mqtt.js client
- Zigbee2MQTT parser (`src/mqtt/parsers/zigbee2mqtt.ts`) — extensive device parsing logic, moves into plugin
- After this migration, `src/mqtt/` can be removed from core entirely (if no other core code uses it)
- This is the most-used integration — extra care in testing

## Post-Migration Cleanup

After all 5 integrations are externalized:

- [ ] Remove `src/mqtt/` directory (connector + parsers) if unused by core
- [ ] Remove `mqtt` package from Sowel core `package.json`
- [ ] Remove `socket.io-client` from Sowel core `package.json`
- [ ] Remove built-in integration registration from `src/index.ts`
- [ ] Clean up IntegrationRegistry if needed

## Acceptance Criteria

- [ ] New repo `mchacher/sowel-plugin-zigbee2mqtt`
- [ ] MQTT connector + parser embedded in plugin
- [ ] mqtt.js in plugin's package.json
- [ ] All features preserved: device discovery, state updates, orders, availability
- [ ] Pre-built tarball release via GitHub Actions
- [ ] Added to `plugins/registry.json`
- [ ] Built-in code removed from `src/integrations/zigbee2mqtt/`
- [ ] `src/mqtt/` removed from core (or justified why kept)
- [ ] No user-facing regression
