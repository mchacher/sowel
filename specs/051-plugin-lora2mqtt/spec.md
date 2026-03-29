# 051 — Externalize LoRa2MQTT as Plugin

## Summary

Migrate the LoRa2MQTT integration from `src/integrations/lora2mqtt/` to an external plugin `sowel-plugin-lora2mqtt`.

## Current State

- Location: `src/integrations/lora2mqtt/`
- Files: `index.ts` (+ uses `src/mqtt/parsers/lora2mqtt-parser.ts`)
- Dependencies: mqtt.js (moves to plugin package.json)
- State: settings in `settings` table (MQTT broker URL, base topic)
- Features: MQTT-based LoRa device discovery, data parsing

## Special Considerations

- LoRa2MQTT parser (`src/mqtt/parsers/lora2mqtt-parser.ts`) moves into the plugin
- mqtt.js becomes a plugin dependency

## Acceptance Criteria

- [x] New repo `mchacher/sowel-plugin-lora2mqtt`
- [x] Parser code embedded in plugin
- [x] mqtt.js in plugin's package.json
- [x] All features preserved: MQTT connection, device discovery, data parsing
- [x] Pre-built tarball release via GitHub Actions
- [x] Added to `plugins/registry.json`
- [x] Built-in code removed from `src/integrations/lora2mqtt/`
- [x] No user-facing regression
