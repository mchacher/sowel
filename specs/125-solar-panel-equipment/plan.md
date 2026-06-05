# Implementation Plan — Spec 125 (Solar Panel + APsystems)

Two deliverables: **Part 1** in this repo (Sowel core `solar_panel` type +
`temperature_device` category + cards), **Part 2** in a new repo
(`sowel-plugin-apsystems`). They share the FR3 device-data contract. Build Part 1 first
(testable with mock devices), then Part 2 (the live data source).

## Slices

### Slice A — Core types & category (Sowel repo)

- A.1 — `src/shared/types.ts`: `EquipmentType += "solar_panel"`;
  `DataCategory += "temperature_device"`.
- A.2 — `src/shared/constants.ts`: add `temperature_device` to `STREAMING_CATEGORIES`
  and `STREAMING_TIMEOUT_MS` (15 min). Leave `PROPERTY_TO_CATEGORY.device_temperature`
  unchanged (no z2m remap — product decision).
- A.3 — `src/history/history-writer.ts`: add `temperature_device` to the
  historized-by-default set with a `0.2` deadband.
- A.4 — `ui/src/types.ts`: mirror both unions.

### Slice B — Per-channel binding candidates (Sowel repo)

- B.1 — `src/equipments/binding-candidates.ts`: new `case "solar_panel"` (group by
  `/^ch(\d+)_/`, append shared `inverter_temp`).
- B.2 — `ui/src/lib/binding-candidates.ts`: mirror the same case.
- B.3 — `ui/src/components/equipments/bindingUtils.ts` + `DeviceSelector.tsx`:
  `solar_panel` relevant categories = `[power, energy, voltage, current, temperature_device]`.
- B.4 — Tests (see Test Plan).

### Slice C — Category surfacing in UI (Sowel repo)

- C.1 — `ui/src/components/history/history-utils.ts` + `binding-label.ts`: handle
  `temperature_device` (label "Inverter temperature" / "Température onduleur").
- C.2 — `ui/src/components/equipments/sensorUtils.tsx`: include `temperature_device`
  in the sensor category ordering.
- C.3 — `ui/src/i18n/locales/{en,fr}.json`: `category.temperature_device`.

### Slice D — Equipment cards (Sowel repo)

- D.1 — `ui/src/components/dashboard/EquipmentWidget.tsx`: new `SolarPanelEquipmentWidget`
  (compact) — `Sun` icon, produced power (W/kW) as headline, `EquipmentStatusBadge`;
  route `solar_panel` to it.
- D.2 — `ui/src/components/dashboard/WidgetDetailSheet.tsx`: solar_panel detail content
  (power/energy/voltage/current/inverter-temp), read-only; add to `needsDetailSheet`
  in `widget-utils.ts` if required.
- D.3 — `ui/src/pages/EquipmentDetailPage.tsx`: route `solar_panel` to a read-only data
  panel.
- D.4 — `ui/src/components/equipments/EquipmentForm.tsx`: `EQUIPMENT_TYPE_KEYS +=
solar_panel`.
- D.5 — `ui/src/components/equipments/EquipmentCard.tsx`: `TYPE_ICONS` + `TYPE_LABELS`
  += `solar_panel` (`Sun`).
- D.6 — `ui/src/components/dashboard/widget-icons.ts`:
  `EQUIPMENT_DEFAULT_ICONS.solar_panel = "Sun"`.
- D.7 — `ui/src/i18n/locales/{en,fr}.json`: `equipments.type.solar_panel`.

### Slice E — Plugin scaffold (new repo `sowel-plugin-apsystems`)

- E.1 — `package.json` (type module, dep `mqtt`), `tsconfig.json`, `.gitignore`,
  `vitest` dev dep — copy from tasmota.
- E.2 — `manifest.json`: id `apsystems`, name "APsystems", icon `Sun`, FR8 settings,
  `apiVersion: 2`.
- E.3 — `src/mqtt-connector.ts`: copy verbatim from tasmota.

### Slice F — Plugin parser & engine (new repo)

- F.1 — `src/apsystems-parser.ts` (PURE): `parseSensorPayload(json) -> { perSerial }`,
  mapping MQTT fields → device keys/categories per FR3; emits only channels present.
- F.2 — `src/apsystems-engine.ts`: subscribe `tele/<root>/SENSOR` + `tele/<root>/LWT`;
  on SENSOR drive upsert/updateDeviceData/updateDeviceStatus + presence diff; on LWT
  drive integration status + bulk offline.
- F.3 — `src/index.ts`: `ApsystemsPlugin` lifecycle + `createPlugin` factory.
- F.4 — Tests (see Test Plan).
- F.5 — `README.md`.

### Slice G — Release & registry (after F, separate PR)

- G.1 — Build + tag `v0.1.0` of `sowel-plugin-apsystems`, upload tarball asset.
- G.2 — Add `apsystems` to `plugins/registry.json`; run
  `scripts/backfill-registry-sha256.mjs`; PR `chore(registry): add apsystems 0.1.0`.

## Test Plan

### Modules to test

- `src/equipments/binding-candidates.ts` (core — new solar_panel case)
- `apsystems-parser.ts` (plugin — pure payload mapping)
- `apsystems-engine.ts` presence logic (plugin — pure diff helper + mocked deviceManager)

### Scenarios

| Module             | Scenario                                           | Expected                                                                     |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| binding-candidates | device with `ch1_*` + `ch2_*` + `inverter_temp`    | 2 candidates `ch1`/`ch2`, each = 4 channel keys + `inverter_temp`, no orders |
| binding-candidates | device with only `ch1_*` (+ `inverter_temp`)       | 1 candidate `ch1` incl. `inverter_temp`                                      |
| binding-candidates | device with `ch1_*` but no `inverter_temp`         | 1 candidate `ch1` with 4 keys only                                           |
| binding-candidates | device with no `ch<N>_*` keys                      | `[]`                                                                         |
| binding-candidates | inverter-level keys only (`power`,`inverter_temp`) | `[]` (no channel → no candidate)                                             |
| apsystems-parser   | single inverter, 2 channels                        | 1 serial → discovered with inverter + ch1 + ch2 points, values match         |
| apsystems-parser   | two inverters                                      | 2 serials, independent                                                       |
| apsystems-parser   | inverter with only Ch1 fields                      | `ch2_*` absent                                                               |
| apsystems-parser   | `Temperature` field                                | mapped to `inverter_temp` / `temperature_device`                             |
| apsystems-parser   | `Name` present                                     | parsed, not emitted as data point                                            |
| apsystems-parser   | malformed / non-object JSON                        | empty result, no throw                                                       |
| apsystems-engine   | serial present then absent next cycle              | `updateDeviceStatus(serial,"offline")` on absent cycle                       |
| apsystems-engine   | LWT `Offline`                                      | all known serials → offline + integration `disconnected`                     |

### Retro-compat

- Existing equipment types untouched; `binding-candidates` default behavior unchanged
  (solar_panel is a new `case`).
- `self-consumption-writer` unchanged — no aggregation added.
- Zigbee2MQTT `device_temperature` mapping left unchanged — no behavior change on
  existing installs; `temperature_device` is consumed only by the APsystems plugin.

## Validation Plan

Core (this repo):

- `npx tsc --noEmit`; `cd ui && npx tsc -b --noEmit`
- `npx vitest run src/equipments/binding-candidates.test.ts` then full `npx vitest run`
- `npx eslint src/ --ext .ts`
- Manual: create a Solar Panel, bind to a mock/real APsystems device, verify two
  candidates, the compact card (power + online/offline) and the detail view.

Plugin (new repo):

- `npm run build`, `npx vitest run`
- Manual: point at the ESP32-ECU broker (or a mosquitto with a captured retained
  `SENSOR`), confirm discovery + values + night offline behavior.

## Commit scopes

`equipments`, `ui`, `core`, `db` (Sowel repo). Plugin repo: own conventional commits
(`feat`, `mqtt`, `test`). Registry: `chore(registry)`.
