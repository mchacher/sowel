# Plan — Spec 085 (It 1)

## Implementation order

The work spans two repos and follows the same order as spec 083.

### A — Plugin repo `sowel-plugin-shelly-mqtt`

1. Bootstrap repo (mirror `sowel-plugin-tasmota` layout): `package.json`, `tsconfig.json`, `manifest.json`, `.github/workflows/release.yml`, `vitest` config.
2. `src/shelly-parser.ts` — pure functions:
   - `parseEm1Status(payload)` → `{ power, voltage, current, pf }`
   - `parseEm1DataStatus(payload)` → `{ energy_forward, energy_reverse }`
   - `extractDeviceTopic(topic, prefixFilter)` → `{ shellyId, channel, kind: "em1" | "em1data" | "online" }`
3. `src/shelly-parser.test.ts` — unit tests (see Test Plan).
4. `src/mqtt-connector.ts` — MQTT client wrapper with handlers, identical pattern to tasmota.
5. `src/shelly-plugin.ts` — engine: subscribe, route messages, dispatch to `deviceManager.upsertFromDiscovery` (first message) + `updateDeviceData` (subsequent).
6. `src/index.ts` — `createPlugin(deps)` returning the `IntegrationPlugin`.
7. Local validation: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
8. Push to GitHub, tag `v1.0.0`, GH Action releases the tarball.

### B — Sowel core

Branch `feat/shelly-em-live`.

1. Add the new route + redirect.
2. Build `LiveDiagram.tsx` from the validated mockup (`mockup.html`), adapted to React + Tailwind. SVG bus skeleton + nodes + animated dots (SMIL `<animateMotion>`). Honor dark mode via existing CSS variables.
3. Build `LiveEnergyPage.tsx` — header, picker popover, diagram, empty state.
4. Build `LiveSourcePicker.tsx` — dropdown listing equipments with a `power` alias, persists via `PUT /api/v1/settings` (existing endpoint).
5. Build `useLiveSources.ts` Zustand store — reads the two settings, exposes `gridEquipment` / `solarEquipment` derived from `useEquipments`.
6. Translations.
7. Update plugin registry `plugins/registry.json` with the `shelly_mqtt` entry pointing to v1.0.0.
8. Validate: backend tsc, UI tsc, vitest, eslint.
9. Commit, push, create PR.

## Test plan

### Modules to test

- `shelly-parser.ts` (plugin repo)
- `useLiveSources.ts` derivation logic (Sowel core, optional — pure derivation can be inlined in component if simple)
- `LiveDiagram.tsx` — UI component, manually verified (no React tests in the project)

### Scenarios per module

| Module        | Scenario                                                         | Expected                                                          |
| ------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| shelly-parser | extractDeviceTopic on `shelly/shelly-pro3em_00/status/em1:0`     | `{ shellyId: "shelly-pro3em_00", channel: 0, kind: "em1" }`       |
| shelly-parser | extractDeviceTopic on `shelly/shelly-pro3em_00/status/em1data:1` | `{ shellyId: "shelly-pro3em_00", channel: 1, kind: "em1data" }`   |
| shelly-parser | extractDeviceTopic on `shelly/shelly-pro3em_00/online`           | `{ shellyId: "shelly-pro3em_00", channel: null, kind: "online" }` |
| shelly-parser | extractDeviceTopic on unrelated topic                            | `null` (skipped silently)                                         |
| shelly-parser | extractDeviceTopic on legacy 3-phase topic `…/status/em:0`       | `null` (V1 ignores 3-phase mode)                                  |
| shelly-parser | parseEm1Status valid payload                                     | numeric power/voltage/current/pf                                  |
| shelly-parser | parseEm1Status with missing fields                               | `null` for missing fields, no throw                               |
| shelly-parser | parseEm1Status with invalid JSON                                 | throws → caller catches and logs                                  |
| shelly-parser | parseEm1DataStatus valid payload                                 | numeric energy_forward / energy_reverse                           |
| shelly-parser | parseEm1DataStatus with negative ret_aenergy                     | passed through verbatim (Shelly always emits ≥ 0 but defensive)   |

UI / integration is verified manually in the dev server:

- Start Shelly Pro 3EM publishing on `shelly/shelly-pro3em_00/...`
- Install plugin, configure broker URL, start
- 3 devices appear in `Sowel → Devices` with names `shelly-pro3em_00 · channel 0/1/2`
- Create 2 equipments (`energy_meter` type) bound to channels 0 (Grid) and 1 (Solar)
- Open `/energy/live` → empty state offers picker
- Pick the two equipments → diagram renders
- Vary load (turn on a 2 kW kettle) → grid bubbles speed up, autoconso % updates
- Open `/energy/live` on mobile → responsive layout

### What is NOT tested

- React component snapshots (project convention)
- The mqtt.js library itself
- End-to-end with a real Shelly Pro 3EM (manual smoke test instead)

## Manual verification (PR test plan)

- [ ] `npx tsc --noEmit` (Sowel) clean
- [ ] `cd ui && npx tsc -b --noEmit` clean
- [ ] `npx vitest run` — all green
- [ ] `npx eslint src/ --ext .ts` — zero errors
- [ ] Plugin: `npm run build`, `npm test`, `npm run lint` — all green
- [ ] `/energy/live` becomes the default landing on the Energy menu
- [ ] Diagram shows correct values for the 3 modes (import / autoconso / export) under live data
- [ ] Animation visible and respects energy direction
- [ ] Dark mode passes
- [ ] Mobile (375 wide) layout still readable
