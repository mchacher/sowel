# Plan — Spec 083 Pool Heat Pump Plugin

## Implementation order

The work spans two repos:

- **A. Sowel core** (`mchacher/sowel`) — new types, computed evaluator, UI wiring, registry entry.
- **B. New plugin repo** (`mchacher/sowel-plugin-polytropic-master`) — the Modbus plugin itself.

### A — Sowel core (branch `feat/pool-heat-pump`)

1. **Types & constants**
   - `src/shared/types.ts`: add `pool_water_temperature`, `pool_temperature_setpoint`, `set_pool_temperature_setpoint`, `pool_heat_pump`.
   - `src/shared/constants.ts`: add `pool_heat_pump` to widget-family / equipment-type maps as needed (mirror `thermostat`).
2. **Equipment manager / computed engine**
   - Register a new computed-data evaluator `effective_water_temperature` for `pool_heat_pump` (file: most likely a new module under `src/equipments/computed/` or extend the existing computed engine; see how thermostat is done if applicable).
   - Persist last-active timestamp + value per equipment (reuse the engine's existing memo storage).
3. **Binding inference / candidates**
   - `src/equipments/binding-candidates.ts`: add `pool_heat_pump` cases — recognise `pool_water_temperature`, `pool_temperature_setpoint`, `appliance_state` (mode), and the optional `filtration_state` alias on enum/boolean keys.
   - Update `ORDER_CATEGORY_ALIASES` / `DATA_CATEGORY_ALIASES` in the UI (`ui/src/components/equipments/bindingUtils.ts`) accordingly.
4. **API**
   - No new REST endpoint. The existing equipment CRUD covers it.
5. **UI**
   - `ui/src/components/equipments/EquipmentForm.tsx` (and friends): make `pool_heat_pump` selectable; expose `filtration_state` as an optional alias slot.
   - `ui/src/components/dashboard/widget-icons.ts`: register `pool_heat_pump` → existing thermostat widget icon (or `Waves`).
   - `ui/src/components/dashboard/EquipmentWidget.tsx` / `MobileWidgetCard.tsx`: route `pool_heat_pump` to `ThermostatEquipmentWidget` (no new component).
   - `ui/src/i18n/locales/{en,fr}.json`: new strings (`pool_heat_pump` label, helper text for `filtration_state`).
6. **Registry**
   - `plugins/registry.json`: add `polytropic_master` entry pointing to the new repo.
7. **Tests**
   - `effective_water_temperature` evaluator: 6 scenarios (see Test Plan).
   - Binding-candidate regression tests for `pool_heat_pump`.
8. **Validate**
   - `npx tsc --noEmit`, `cd ui && npx tsc -b --noEmit`, `npx vitest run`, `npx eslint src/ --ext .ts`.
9. **Commit & PR**

### B — Plugin repo `sowel-plugin-polytropic-master`

1. **Bootstrap repo** (mirror `sowel-plugin-tasmota` layout): `package.json`, `tsconfig.json`, `manifest.json`, `vitest.config.ts`, `eslint`, GitHub Actions release workflow (build + tarball + GH release).
2. **Modbus client wrapper** (`src/modbus-client.ts`): typed wrapper over `modbus-serial`; `connect()`, `readHoldingRegisters(addr, count)`, `writeRegister(addr, value)`, `close()`. Reconnection with backoff.
3. **Register definitions** (`src/registers.ts`): scaling helpers (`x10`), mode enum mapping.
4. **Plugin** (`src/polytropic-plugin.ts`): `createPlugin(deps)` returning an `IntegrationPlugin`; lifecycle methods as per architecture.md.
5. **Tests** (`src/*.test.ts`): see Test Plan section.
6. **Manifest** version 1.0.0.
7. **CI**: build + lint + test + tarball.
8. **First release** v1.0.0; update Sowel registry to point to it.

## Test Plan

### Modules to test

- `effective_water_temperature` evaluator (Sowel core)
- `registers.ts` decoders (plugin) — scaling + mode enum
- `polytropic-plugin.ts` — lifecycle + write/poll behaviour (mock Modbus client)
- `binding-candidates.ts` — `pool_heat_pump` candidate inference (Sowel core)

### Scenarios

| Module                      | Scenario                                                 | Expected                                                                                                |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| effective_water_temperature | filtration bound and ON, water=22.0                      | returns 22.0; lastActive updated                                                                        |
| effective_water_temperature | filtration bound, OFF since 1h, last active=21.5         | returns 21.5 (frozen)                                                                                   |
| effective_water_temperature | filtration bound, OFF since 25h, last active=21.5        | returns null                                                                                            |
| effective_water_temperature | filtration not bound, mode=SMART, water=22.0             | returns 22.0; lastActive updated                                                                        |
| effective_water_temperature | filtration not bound, mode=OFF, last active=21.5 1h ago  | returns 21.5 (frozen)                                                                                   |
| effective_water_temperature | filtration not bound, mode=OFF, last active=21.5 25h ago | returns null                                                                                            |
| registers (decode)          | water register 220 ×10                                   | returns 22.0 °C                                                                                         |
| registers (decode)          | water register -50 (signed)                              | returns -5.0 °C                                                                                         |
| registers (decode mode)     | mode register 21                                         | returns "SMART"                                                                                         |
| registers (decode mode)     | mode register 99 (unknown)                               | returns "RAW_99" + warn log                                                                             |
| registers (encode)          | encode setpoint 25.5                                     | returns 255                                                                                             |
| polytropic-plugin           | poll success                                             | 4 deviceManager.updateDeviceData calls                                                                  |
| polytropic-plugin           | poll fails 3× consecutively                              | device flips offline; integration errored                                                               |
| polytropic-plugin           | executeOrder set_pool_temperature_setpoint 25.5          | writeRegister(1001, 255) called; immediate re-poll triggered                                            |
| polytropic-plugin           | executeOrder fails                                       | error logged; no local cache update; no re-poll                                                         |
| binding-candidates          | `pool_heat_pump` + PAC device with 4 data points         | candidates include all 4 aliases (`temperature`, `setpoint`, `mode`, `outdoor_temperature` if proposed) |
| binding-candidates          | `pool_heat_pump` + Sonoff 4CH PRO `power2`               | candidate proposes `filtration_state` alias                                                             |

### What is NOT tested

- The Sowel UI components (no React tests in this project).
- The Modbus library itself (`modbus-serial`).
- End-to-end integration with a physical PAC (manual test only).

## Manual verification (in PR test plan)

- [ ] `npx tsc --noEmit` green on Sowel core.
- [ ] `cd ui && npx tsc -b --noEmit` green.
- [ ] `npx vitest run` all green on Sowel core.
- [ ] Plugin repo: `npm run build`, `npm test`, `npm run lint` all green.
- [ ] Install plugin in local Sowel, configure with real PAC, see device discovered with 4 data points + 1 order.
- [ ] Setpoint slider in UI → value reflected at next poll on real device.
- [ ] Stop the Waveshare gateway → device flips offline within ~3 minutes.
- [ ] Bind `filtration_state` to Sonoff power2; toggle the relay and observe the freeze/live behaviour of `effective_water_temperature`.
