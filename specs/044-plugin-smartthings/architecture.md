# Architecture: Plugin SmartThings

## Overview

External plugin (`sowel-plugin-smartthings`) implementing the Sowel `IntegrationPlugin` interface. Communicates with Samsung SmartThings REST API (`https://api.smartthings.com/v1/`) using a Personal Access Token (PAT).

## Data Model Changes

### New equipment types in Sowel core

| Type           | Purpose                            | Data categories                                           |
| -------------- | ---------------------------------- | --------------------------------------------------------- |
| `media_player` | TV, soundbar, media device         | `generic` (power, source, volume, mute, mode)             |
| `appliance`    | Washing machine, dryer, dishwasher | `generic` (power, state, phase, progress, remaining time) |

These types need to be added to `VALID_EQUIPMENT_TYPES` in `equipment-manager.ts` and to `EquipmentType` in `types.ts`.

### Device discovery mapping

Each SmartThings device becomes one Sowel device with:

- `integrationId`: `"smartthings"`
- `source`: `"smartthings"`
- `friendlyName`: SmartThings device label
- `manufacturer`: `"Samsung Electronics"`
- `model`: SmartThings `deviceTypeName`

### Data keys per device type

**Washer (Samsung OCF Washer):**

| Data key             | Type    | Category | Source capability                                        |
| -------------------- | ------- | -------- | -------------------------------------------------------- |
| `power`              | boolean | generic  | `switch.switch`                                          |
| `state`              | enum    | generic  | `samsungce.washerOperatingState.operatingState`          |
| `job_phase`          | enum    | generic  | `samsungce.washerOperatingState.washerJobPhase`          |
| `progress`           | number  | generic  | `samsungce.washerOperatingState.progress`                |
| `remaining_time`     | number  | generic  | `samsungce.washerOperatingState.remainingTime` (minutes) |
| `remaining_time_str` | text    | generic  | `samsungce.washerOperatingState.remainingTimeStr`        |
| `energy`             | number  | energy   | `powerConsumptionReport.energy` (Wh)                     |

**TV (Samsung OCF TV):**

| Data key       | Type    | Category | Source capability                        |
| -------------- | ------- | -------- | ---------------------------------------- |
| `power`        | boolean | generic  | `switch.switch`                          |
| `volume`       | number  | generic  | `audioVolume.volume`                     |
| `mute`         | boolean | generic  | `audioMute.mute`                         |
| `input_source` | enum    | generic  | `samsungvd.mediaInputSource.inputSource` |
| `picture_mode` | enum    | generic  | `custom.picturemode.pictureMode`         |

### Order keys per device type

**TV only (washer is read-only in V1):**

| Order key      | Type           | Source command                                  |
| -------------- | -------------- | ----------------------------------------------- |
| `power`        | boolean        | `switch.on()` / `switch.off()`                  |
| `volume`       | number (0-100) | `audioVolume.setVolume(value)`                  |
| `mute`         | boolean        | `audioMute.mute()` / `audioMute.unmute()`       |
| `input_source` | enum           | `samsungvd.mediaInputSource.setInputSource(id)` |

## Plugin Settings

| Key                | Label                      | Type     | Required | Default |
| ------------------ | -------------------------- | -------- | -------- | ------- |
| `token`            | Personal Access Token      | password | yes      | —       |
| `polling_interval` | Polling interval (seconds) | number   | no       | 300     |

## Plugin Structure

```
sowel-plugin-smartthings/
├── manifest.json
├── package.json
├── tsconfig.json
└── src/
    └── index.ts          # createPlugin factory, poller, device mapping
```

## API Calls

| Endpoint                         | Method | Purpose                               |
| -------------------------------- | ------ | ------------------------------------- |
| `GET /v1/devices`                | GET    | Discover all devices                  |
| `GET /v1/devices/{id}/status`    | GET    | Poll device status (all capabilities) |
| `POST /v1/devices/{id}/commands` | POST   | Execute command (TV orders)           |

## Poll Cycle

1. `GET /v1/devices` → discover/update device list
2. For each known device: `GET /v1/devices/{id}/status` → extract relevant data keys
3. Call `deviceManager.updateDeviceData()` for each changed value
4. Interval: configurable, default 300s

## File Changes (Sowel core)

| File                                              | Change                                                |
| ------------------------------------------------- | ----------------------------------------------------- |
| `src/shared/types.ts`                             | Add `media_player` and `appliance` to `EquipmentType` |
| `src/equipments/equipment-manager.ts`             | Add to `VALID_EQUIPMENT_TYPES`                        |
| `ui/src/components/equipments/DeviceSelector.tsx` | Add compatibility categories for new types            |
| `plugins/registry.json`                           | Add smartthings entry                                 |
