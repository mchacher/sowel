# Implementation Plan: 048c — Legrand Energy Plugin

## Tasks

### Plugin repo creation

1. [ ] Create GitHub repo `mchacher/sowel-plugin-legrand-energy`
2. [ ] Scaffold plugin: manifest.json, package.json, tsconfig.json, .gitignore, .github/workflows/release.yml
3. [ ] Port OAuth bridge (auth, token rotation, file persistence, homesdata, homestatus, getMeasure)
4. [ ] Port NLPC meter discovery from netatmo-poller.ts (discoverMeters, bridgeId capture)
5. [ ] Port power status polling from netatmo-poller.ts (pollMeterStatus)
6. [ ] Port energy polling from netatmo-poller.ts (pollEnergyMeters, queryEnergyWindow)
7. [ ] Replace resolveProductionDeviceName() with `production_device_name` setting
8. [ ] Port types (NLPC mapping, extractStatusPayload)
9. [ ] Add device migration from netatmo_hc by model (NLPC only), DB-only, before auth
10. [ ] Implement createPlugin(deps) → IntegrationPlugin
11. [ ] Build + verify dist/index.js

### Sowel core cleanup

12. [ ] Remove entire `src/integrations/netatmo-hc/` directory
13. [ ] Remove `NetatmoHCIntegration` import and registration from `src/index.ts`
14. [ ] Remove constructor params (equipmentManager, settingsManager, eventBus) no longer needed for netatmo_hc
15. [ ] Clean up `scripts/energy/` if any reference `src/integrations/netatmo-hc/` (keep scripts working standalone)
16. [ ] Add `legrand_energy` to `plugins/registry.json`

### Validation

17. [ ] TypeScript compilation (Sowel backend + frontend)
18. [ ] All tests pass
19. [ ] Lint (0 errors)
20. [ ] Tag + release plugin v1.0.0
21. [ ] Install plugin from store
22. [ ] Configure credentials + production_device_name = "Solaire"
23. [ ] Run test plan (see below)

## Test Plan — Energy Data Validation

### Pre-migration: capture baseline (BEFORE any code change)

```bash
# 1. Record current NLPC devices and their integration_id
sqlite3 data/sowel.db "SELECT id, name, integration_id, model FROM devices WHERE model = 'NLPC';"

# 2. Record current equipment bindings
sqlite3 data/sowel.db "
  SELECT e.name, e.type, b.alias, d.name as device_name, d.integration_id, dd.value
  FROM equipments e
  JOIN data_bindings b ON e.id = b.equipment_id
  JOIN device_data dd ON b.device_data_id = dd.id
  JOIN devices d ON dd.device_id = d.id
  WHERE e.type IN ('main_energy_meter', 'energy_production_meter')
  ORDER BY e.name, b.alias;"

# 3. Record last energy values from API
curl -s http://localhost:3000/api/v1/devices -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; [print(f\"{d['name']:15s} energy={next((dd['value'] for dd in d.get('data',[]) if dd['key']=='energy'),'?')}\") for d in json.load(sys.stdin) if d.get('model')=='NLPC']"
```

### Post-migration: validate step by step

#### Step 1: Device migration

```bash
# Verify 4 NLPC devices migrated to legrand_energy
sqlite3 data/sowel.db "SELECT name, integration_id FROM devices WHERE model = 'NLPC';"
# Expected: all 4 show integration_id = 'legrand_energy'
```

#### Step 2: Equipment bindings intact

```bash
# Verify bindings still point to same device UUIDs (not broken)
sqlite3 data/sowel.db "
  SELECT e.name, b.alias, d.name as device_name, d.integration_id
  FROM equipments e
  JOIN data_bindings b ON e.id = b.equipment_id
  JOIN device_data dd ON b.device_data_id = dd.id
  JOIN devices d ON dd.device_id = d.id
  WHERE e.type IN ('main_energy_meter', 'energy_production_meter')
  ORDER BY e.name;"
# Expected: same device names (Total, Solaire), integration_id = 'legrand_energy'
```

#### Step 3: Plugin starts and connects

```bash
# Start plugin → should authenticate + discover NLPC + start polling
curl -s -X POST "http://localhost:3000/api/v1/integrations/legrand_energy/start" -H "Authorization: Bearer $TOKEN"
# Expected: {"success":true,"status":"connected"}
```

#### Step 4: Power status polling works

```bash
# Wait for first poll, then check power values on NLPC devices
sqlite3 data/sowel.db "
  SELECT d.name, dd.key, dd.value, dd.last_updated
  FROM devices d JOIN device_data dd ON d.id = dd.device_id
  WHERE d.integration_id = 'legrand_energy' AND dd.key = 'power';"
# Expected: power values for Total, PAC, Piscine, Solaire with recent timestamps
```

#### Step 5: Energy consumption data flows

```bash
# Check energy value on main meter (Total)
sqlite3 data/sowel.db "
  SELECT d.name, dd.key, dd.value, dd.last_updated
  FROM devices d JOIN device_data dd ON d.id = dd.device_id
  WHERE d.name = 'Total' AND dd.key = 'energy';"
# Expected: energy value > 0 with recent timestamp (after first energy poll)
```

#### Step 6: Energy production data flows

```bash
# Check energy + autoconso + injection on production device (Solaire)
sqlite3 data/sowel.db "
  SELECT d.name, dd.key, dd.value, dd.last_updated
  FROM devices d JOIN device_data dd ON d.id = dd.device_id
  WHERE d.name = 'Solaire' AND dd.key IN ('energy', 'autoconso', 'injection');"
# Expected: values > 0 with recent timestamps
```

#### Step 7: demand_30min (instantaneous power estimate)

```bash
sqlite3 data/sowel.db "
  SELECT d.name, dd.key, dd.value, dd.last_updated
  FROM devices d JOIN device_data dd ON d.id = dd.device_id
  WHERE d.name = 'Total' AND dd.key = 'demand_30min';"
# Expected: value > 0 (= last energy bucket * 2, in Watts)
```

#### Step 8: InfluxDB data still flowing

```bash
# Check InfluxDB raw bucket for recent energy points
TOKEN_API=$(curl -s -X POST http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' --data-raw '{"username":"admin","password":"38!Venon"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
curl -s "http://localhost:3000/api/v1/history/status" -H "Authorization: Bearer $TOKEN_API" | python3 -m json.tool
# Expected: pointsWritten24h > 0, no errors
```

#### Step 9: UI energy page works (Playwright)

- Navigate to Energy page → verify consumption and production charts show data
- Navigate to Integrations page → verify legrand_energy shows Connected with 4 devices
- Verify no `netatmo_hc` integration listed anymore

#### Step 10: Built-in completely removed

```bash
# Verify no netatmo-hc code remains
ls src/integrations/netatmo-hc/ 2>&1  # Should fail: no such directory
grep -r "NetatmoHCIntegration" src/   # Should return nothing
grep -r "netatmo-hc" src/index.ts     # Should return nothing
```

## Dependencies

- Requires 048a (Netatmo Weather) and 048b (Legrand Control) to be completed
- Both are done — no devices remain under netatmo_hc except NLPC
