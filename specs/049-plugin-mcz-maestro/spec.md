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

- [x] New repo `mchacher/sowel-plugin-mcz-maestro`
- [x] `socket.io-client` dependency in plugin's package.json (removed from Sowel core)
- [x] All features preserved: cloud connection, device discovery, orders
- [x] Pre-built tarball release via GitHub Actions
- [x] Added to `plugins/registry.json`
- [x] Device migration: 1 device from `mcz_maestro` to `mcz_maestro` by model "Maestro" (preserves UUID, bindings)
- [x] Built-in code removed from `src/integrations/mcz-maestro/`
- [x] Built-in registration removed from `src/index.ts`
- [x] `socket.io-client` removed from Sowel core package.json
- [x] No user-facing regression (Poele equipment bindings intact)
