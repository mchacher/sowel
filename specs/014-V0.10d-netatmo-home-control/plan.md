# Implementation Plan: V0.10d Netatmo Home+Control

## Tasks

1. [ ] Add `"netatmo_hc"` to `DeviceSource` in `src/shared/types.ts`
2. [ ] Create `src/integrations/netatmo-hc/netatmo-types.ts` — API response types, module type mappings
3. [ ] Create `src/integrations/netatmo-hc/netatmo-bridge.ts` — HTTP client, OAuth2 token refresh, API calls
4. [ ] Create `src/integrations/netatmo-hc/netatmo-poller.ts` — Polling loop, upsertFromDiscovery, updateDeviceData
5. [ ] Create `src/integrations/netatmo-hc/index.ts` — IntegrationPlugin lifecycle
6. [ ] Wire in `src/index.ts` — import, instantiate, register
7. [ ] TypeScript compilation check (`npx tsc --noEmit`)
8. [ ] Run all tests (`npm test`)
9. [ ] Create PR

## Dependencies

- Requires V0.10a (Integration Plugin Architecture) — already done
- Requires user to have Netatmo developer account with client_id/client_secret
- Requires user to generate initial refresh_token from dev.netatmo.com Token Generator

## Testing

### Manual verification (with real Netatmo API)

1. Configure integration in UI: client_id, client_secret, refresh_token
2. Start integration → status becomes "connected"
3. Check `GET /api/v1/devices` → Legrand modules appear
4. Verify teleruptor state (on/off) matches Home+Control app
5. Execute order on teleruptor → verify physical relay toggles
6. Verify energy meter readings (power W) update every poll cycle
7. Wait 3h+ → verify token auto-refresh works (check logs)
8. Stop integration → status becomes "disconnected", no more polling
