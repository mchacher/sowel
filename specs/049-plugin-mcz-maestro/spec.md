# 049 — Externalize MCZ Maestro as Plugin

## Summary

Migrate the MCZ Maestro pellet stove integration from `src/integrations/mcz-maestro/` to an external plugin `sowel-plugin-mcz-maestro`.

## Current State

- Location: `src/integrations/mcz-maestro/`
- Files: `index.ts`, `mcz-bridge.ts`, `mcz-poller.ts`, `mcz-parser.ts`
- Dependencies: `socket.io-client` (moves to plugin package.json)
- State: settings in `settings` table
- Features: Cloud Socket.IO bridge, device discovery, temperature/fan/power orders

## Acceptance Criteria

- [ ] New repo `mchacher/sowel-plugin-mcz-maestro`
- [ ] `socket.io-client` dependency in plugin's package.json (removed from Sowel core)
- [ ] All features preserved: cloud connection, device discovery, orders
- [ ] Pre-built tarball release via GitHub Actions
- [ ] Added to `plugins/registry.json`
- [ ] Built-in code removed from `src/integrations/mcz-maestro/`
- [ ] No user-facing regression
