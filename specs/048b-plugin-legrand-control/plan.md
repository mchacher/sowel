# Implementation Plan: 048b — Legrand Control Plugin

## Tasks

### Plugin repo creation

1. [ ] Create GitHub repo `mchacher/sowel-plugin-legrand-control`
2. [ ] Scaffold plugin: manifest.json, package.json, tsconfig.json, .gitignore, .github/workflows/release.yml
3. [ ] Port OAuth bridge from netatmo-bridge.ts (auth, token rotation, file persistence, homesdata, homestatus, setstate)
4. [ ] Port module discovery from netatmo-poller.ts (discoverModules, isSupportedModule — exclude NLPC)
5. [ ] Port status polling from netatmo-poller.ts (pollStatus, extractStatusPayload)
6. [ ] Port order execution from index.ts (executeOrder, coerceValue, setstate)
7. [ ] Port rapid polling (scheduleOnDemandPoll, stopRapidPoll)
8. [ ] Port types from netatmo-types.ts (module classification, mapModuleToDiscovered, extractStatusPayload — exclude NLPC mapping)
9. [ ] Add device migration from netatmo_hc by model (all models except NLPC), DB-only, before auth
10. [ ] Implement createPlugin(deps) → IntegrationPlugin
11. [ ] Build + verify dist/index.js

### Sowel core cleanup

12. [ ] Remove control code from netatmo-poller.ts (discoverModules, pollStatus, rapid poll — keep only energy)
13. [ ] Remove control code from index.ts (executeOrder, coerceValue, enable_home_control)
14. [ ] Remove control types from netatmo-types.ts (keep only NLPC/METER_TYPES + energy-related)
15. [ ] Remove getHomesData, getHomeStatus, setState from netatmo-bridge.ts (keep only getMeasure + auth)
16. [ ] Add legrand_control to plugins/registry.json

### Validation

17. [ ] TypeScript compilation (Sowel backend + frontend)
18. [ ] All tests pass
19. [ ] Lint (0 errors)
20. [ ] Tag + release plugin v1.0.0
21. [ ] Configure plugin settings (copy from netatmo_hc credentials)
22. [ ] Verify control devices migrated (same UUIDs, bindings preserved)
23. [ ] Verify orders work (light on/off, shutter control)
24. [ ] Verify energy devices (NLPC) still under netatmo_hc (no regression)
25. [ ] Deploy UI via deploy-ui.sh

## Testing Strategy

- Migration: verify Lumière 1-5, CT Green Up, Legrand Gateway moved to legrand_control
- Orders: test light toggle via Playwright
- Energy: verify PAC, Piscine, Solaire, Total remain under netatmo_hc
- No regression on existing equipment bindings
