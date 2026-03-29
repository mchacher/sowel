# Implementation Plan: 049 — MCZ Maestro Plugin

## Tasks

### Plugin repo

1. [ ] Create GitHub repo `mchacher/sowel-plugin-mcz-maestro`
2. [ ] Scaffold plugin + add `socket.io-client` as prod dependency
3. [ ] Port all 4 files: index.ts, mcz-bridge.ts, mcz-poller.ts, mcz-types.ts
4. [ ] Add device migration from mcz_maestro by model ("Maestro")
5. [ ] Add .github/workflows/release.yml
6. [ ] Build + verify

### Sowel core cleanup

7. [ ] Remove `src/integrations/mcz-maestro/`
8. [ ] Remove MczMaestroIntegration from `src/index.ts`
9. [ ] Remove `socket.io-client` from Sowel core `package.json`
10. [ ] Add to `plugins/registry.json`

### Validation

11. [ ] TypeScript + tests + lint
12. [ ] Tag + release plugin v1.0.0
13. [ ] Configure + start plugin
14. [ ] Verify device migrated (same UUID, Poele bindings intact)
15. [ ] Verify orders work (temperature setpoint)
16. [ ] Deploy UI

## Testing

- Baseline: 1 device "2209130010019" model "Maestro", equipment "Poele" with 9 bindings
- Post-migration: same device UUID under mcz_maestro, bindings intact
- Orders: test temperature setpoint via UI
