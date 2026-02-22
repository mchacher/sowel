# Implementation Plan: V0.10c MCZ Maestro Integration

## Tasks

1. [ ] Add `"mcz_maestro"` to DeviceSource in `src/shared/types.ts`
2. [ ] Install `socket.io-client` dependency
3. [ ] Create `src/integrations/mcz-maestro/mcz-types.ts` — register maps, enum mappings, command IDs
4. [ ] Create `src/integrations/mcz-maestro/mcz-bridge.ts` — Socket.IO client wrapper
5. [ ] Create `src/integrations/mcz-maestro/mcz-poller.ts` — polling loop + device discovery
6. [ ] Create `src/integrations/mcz-maestro/index.ts` — IntegrationPlugin implementation
7. [ ] Register plugin in `src/index.ts`
8. [ ] TypeScript check (`npx tsc --noEmit`)
9. [ ] Run all tests (`npx vitest run`)
10. [ ] Add i18n translations for MCZ-specific stove states

## Dependencies

- Requires V0.10a (integration plugin architecture) — already implemented
- Requires `socket.io-client` npm package

## Testing

- Configure serial + MAC in UI > Integrations
- Start integration → verify connection to MCZ cloud
- Check device appears in Devices page with correct data points
- Create thermostat Equipment bound to MCZ device
- Test orders: power on/off, change setpoint, change profile, toggle ECO
- Verify on-demand poll after order execution
- Test disconnect/reconnect behavior
