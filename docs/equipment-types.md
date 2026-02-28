# Winch — Equipment Types Specification

> **Version:** 0.1 — February 2026
>
> Winch separates **Devices** (physical hardware, auto-discovered) from **Equipments** (user-facing functional units). An equipment binds to one or more devices via **data bindings** (read) and **order bindings** (write). This abstraction is a core differentiator: the user thinks in terms of "garage door", not "LoRa node 12 + relay R1 + reed switches RS1/RS2".

---

## How to read this document

Each equipment type section defines:

| Column               | Meaning                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Data Bindings**    | What the equipment reads. `alias` is the canonical name, `category` drives zone aggregation, `type` is the value type.                     |
| **Order Bindings**   | What the equipment can command. `alias` is the canonical name, `type` is the value type, `enumValues` / `min` / `max` constrain the value. |
| **Zone Aggregation** | How values contribute to parent zone aggregated data.                                                                                      |
| **UI Control**       | What component renders and how it behaves.                                                                                                 |

---

## 1. light_onoff — On/Off Light

Simple binary light (no dimming, no color).

### Data Bindings

| Alias   | Category      | Type      | Values               | Description        |
| ------- | ------------- | --------- | -------------------- | ------------------ |
| `state` | `light_state` | `boolean` | `true` / `"ON"` = on | Light is on or off |

### Order Bindings

| Alias   | Type      | Values                                 | Description         |
| ------- | --------- | -------------------------------------- | ------------------- |
| `state` | `boolean` | `true` / `false` (or `"ON"` / `"OFF"`) | Toggle light on/off |

### Zone Aggregation

- `light_state` → **COUNT** on (`lightsOn`) / total (`lightsTotal`)

### UI Control

- Toggle button (on/off)
- Compact: inline toggle icon

---

## 2. light_dimmable — Dimmable Light

Light with brightness control.

### Data Bindings

| Alias        | Category           | Type      | Values               | Description                       |
| ------------ | ------------------ | --------- | -------------------- | --------------------------------- |
| `state`      | `light_state`      | `boolean` | `true` / `"ON"` = on | Light is on or off                |
| `brightness` | `light_brightness` | `number`  | 0–254                | Brightness level (hardware range) |

### Order Bindings

| Alias        | Type      | Min | Max | Description                      |
| ------------ | --------- | --- | --- | -------------------------------- |
| `state`      | `boolean` | —   | —   | Toggle light on/off              |
| `brightness` | `number`  | 0   | 254 | Set brightness (UI shows 0–100%) |

### Zone Aggregation

- `light_state` → **COUNT** on / total
- `light_brightness` → not aggregated at zone level

### UI Control

- Toggle button + brightness slider (0–100%)
- Compact: inline slider + toggle icon

---

## 3. light_color — Color Light

Light with brightness and color temperature (or full RGB — future).

### Data Bindings

| Alias        | Category           | Type      | Values               | Description                |
| ------------ | ------------------ | --------- | -------------------- | -------------------------- |
| `state`      | `light_state`      | `boolean` | `true` / `"ON"` = on | Light is on or off         |
| `brightness` | `light_brightness` | `number`  | 0–254                | Brightness level           |
| `color_temp` | `light_color_temp` | `number`  | 150–500              | Color temperature (mireds) |

### Order Bindings

| Alias        | Type      | Min | Max | Description                    |
| ------------ | --------- | --- | --- | ------------------------------ |
| `state`      | `boolean` | —   | —   | Toggle light on/off            |
| `brightness` | `number`  | 0   | 254 | Set brightness                 |
| `color_temp` | `number`  | 150 | 500 | Set color temperature (mireds) |

### Zone Aggregation

- `light_state` → **COUNT** on / total

### UI Control

- Toggle + brightness slider + color temp slider (future)
- Same as `light_dimmable` currently

---

## 4. shutter — Roller Shutter / Blind

Motorized roller shutter with position and directional commands.

### Data Bindings

| Alias      | Category           | Type     | Values | Description                        |
| ---------- | ------------------ | -------- | ------ | ---------------------------------- |
| `position` | `shutter_position` | `number` | 0–100  | 0 = fully closed, 100 = fully open |

### Order Bindings

| Alias      | Type     | Enum Values                 | Min | Max | Description            |
| ---------- | -------- | --------------------------- | --- | --- | ---------------------- |
| `state`    | `enum`   | `["OPEN", "CLOSE", "STOP"]` | —   | —   | Directional command    |
| `position` | `number` | —                           | 0   | 100 | Set exact position (%) |

### Zone Aggregation

- `shutter_position` → **AVG** (`averageShutterPosition`) + **COUNT** open > 0 (`shuttersOpen` / `shuttersTotal`)

### Zone Orders

| Key                | Value            | Description                |
| ------------------ | ---------------- | -------------------------- |
| `allShuttersOpen`  | `position = 100` | Open all shutters in zone  |
| `allShuttersClose` | `position = 0`   | Close all shutters in zone |

### UI Control

- Position slider (0–100%)
- Three directional buttons: OPEN / STOP / CLOSE
- Compact: slider + buttons inline
- Read-only progress bar if no position order

---

## 5. gate — Motorized Gate / Garage Door

Motorized gate, garage door, or any binary open/close actuator.

### Data Bindings

| Alias   | Category     | Type   | Values                            | Description        |
| ------- | ------------ | ------ | --------------------------------- | ------------------ |
| `state` | `gate_state` | `enum` | `"open"`, `"closed"`, `"unknown"` | Gate current state |

The `state` binding is an **abstraction** — it represents the logical gate state regardless of the underlying device technology:

| Device type             | Raw data         | Mapping to `state`                 |
| ----------------------- | ---------------- | ---------------------------------- |
| LoRa (reed switches)    | RS1=0, RS2=0     | `"open"` (no contact = open)       |
| LoRa (reed switches)    | RS1=1, RS2=1     | `"closed"` (all contacts = closed) |
| Zigbee contact sensor   | `contact: true`  | `"closed"`                         |
| Zigbee contact sensor   | `contact: false` | `"open"`                           |
| Any, after command sent | —                | `"unknown"` (transitioning)        |

This mapping is done via **computed data** in the backend, not in the UI. The UI only sees `state = "open" | "closed" | "unknown"`.

### Order Bindings

| Alias     | Type   | Enum Values (examples)                                            | Description  |
| --------- | ------ | ----------------------------------------------------------------- | ------------ |
| `command` | `enum` | `["open", "close"]` or `["latch"]` or `["open", "close", "stop"]` | Gate command |

The enum values are **device-specific** — they come from the underlying device capabilities:

- A relay-based gate (LoRa) may only support `["latch"]` (momentary pulse)
- A Zigbee smart gate may support `["open", "close", "stop"]`
- The UI adapts: single value → auto-resolved, multiple → shown as buttons/select

### State After Command

When a command is sent, `state` is set to `"unknown"` until the next sensor update confirms the new physical state. No timer, no travel_time — the sensors are the source of truth.

### Zone Aggregation

Not aggregated at zone level (each gate is individual).

### UI Control

- State display: open (orange), closed (green), unknown/transitioning (grey)
- Command button(s): adapts to available enum values
- Compact: state badge + command icon

### Implementation Status

> **Current state:** The `state` derivation (from RS1/RS2 reed switches) is currently done in `GateControl.tsx` (UI). This should be migrated to backend computed data so the abstraction is consistent regardless of which UI or API consumer reads the equipment state.

---

## 6. thermostat — Climate Control

HVAC unit, pellet stove, or any climate device with setpoint.

### Data Bindings

| Alias                | Category      | Type      | Values          | Description                    |
| -------------------- | ------------- | --------- | --------------- | ------------------------------ |
| `power`              | `generic`     | `boolean` | on/off          | Unit power state               |
| `mode`               | `generic`     | `enum`    | device-specific | Operating mode (see below)     |
| `setpoint`           | `temperature` | `number`  | °C              | Target temperature             |
| `temperature`        | `temperature` | `number`  | °C              | Current inside temperature     |
| `outsideTemperature` | `temperature` | `number`  | °C              | Outside temperature (optional) |
| `fanSpeed`           | `generic`     | `enum`    | device-specific | Fan speed (optional)           |
| `ecoMode`            | `generic`     | `boolean` | on/off          | Eco mode state (optional)      |
| `deviceState`        | `generic`     | `text`    | device-specific | Operational state (optional)   |

The `mode` binding is an abstraction — the actual enum values come from the device:

- HVAC: `"auto"`, `"cool"`, `"heat"`, `"dry"`, `"fan"`
- Pellet stove: `"dynamic"`, `"overnight"`, `"comfort"`
- The UI adapts to whatever values the device exposes

The `deviceState` binding reports the physical device state (for devices that expose it):

- MCZ stove: `"off"`, `"standby"`, `"running_eco"`, `"ignition"`, `"error_*"`
- HVAC: may not expose this

### Order Bindings

| Alias      | Type      | Enum Values     | Min        | Max        | Description                 |
| ---------- | --------- | --------------- | ---------- | ---------- | --------------------------- |
| `power`    | `boolean` | —               | —          | —          | Turn unit on/off            |
| `mode`     | `enum`    | device-specific | —          | —          | Set operating mode          |
| `setpoint` | `number`  | —               | device min | device max | Set target temperature (°C) |
| `fanSpeed` | `enum`    | device-specific | —          | —          | Set fan speed               |

### Zone Aggregation

- `temperature` → **AVG** (from `temperature` binding only, not setpoint)

### UI Control

- Hero: inside temperature (large, 36px) + outside temperature (optional)
- Device state badge when available (color-coded: green = running, orange = standby, red = error)
- Power toggle
- Setpoint with ±0.5°C increment buttons
- Mode selector (adapts to device enum values)
- Fan speed selector (when available)
- Optimistic updates: UI applies changes immediately, reverts on failure

### Implementation Status

> **Current state:** The thermostat uses device-specific aliases (`operationMode` vs `profile`, `stoveState`, `resetAlarm`) that leak integration details. Should be normalized to the abstract aliases above (`mode`, `deviceState`).

- Optimistic updates: UI applies changes immediately, reverts on failure

---

## 7. sensor — Environmental Sensor

Read-only device reporting environmental data.

### Data Bindings

| Alias (examples) | Category                          | Type      | Description                 |
| ---------------- | --------------------------------- | --------- | --------------------------- |
| `temperature`    | `temperature`                     | `number`  | Temperature (°C)            |
| `humidity`       | `humidity`                        | `number`  | Humidity (%)                |
| `pressure`       | `pressure`                        | `number`  | Atmospheric pressure (hPa)  |
| `illuminance`    | `luminosity`                      | `number`  | Light level (lux)           |
| `occupancy`      | `motion`                          | `boolean` | Motion detected             |
| `contact`        | `contact_door` / `contact_window` | `boolean` | false = open, true = closed |
| `water_leak`     | `water_leak`                      | `boolean` | Leak detected               |
| `smoke`          | `smoke`                           | `boolean` | Smoke detected              |
| `co2`            | `co2`                             | `number`  | CO2 level (ppm)             |
| `voc`            | `voc`                             | `number`  | VOC level                   |
| `battery`        | `battery`                         | `number`  | Battery level (%)           |
| `vcc`            | `voltage`                         | `number`  | Supply voltage (V)          |

### Order Bindings

None — sensors are read-only.

### Zone Aggregation

| Category         | Aggregation | Zone Field                       |
| ---------------- | ----------- | -------------------------------- |
| `temperature`    | AVG         | `temperature`                    |
| `humidity`       | AVG         | `humidity`                       |
| `luminosity`     | AVG         | `luminosity`                     |
| `motion`         | OR          | `motion` + `motionSensors` count |
| `contact_door`   | COUNT open  | `openDoors`                      |
| `contact_window` | COUNT open  | `openWindows`                    |
| `water_leak`     | OR          | `waterLeak`                      |
| `smoke`          | OR          | `smoke`                          |

### UI Control

- Compact badges per value
- Battery indicator (separate)
- Motion: elapsed time counter
- Contact: open/closed state with icon
- Boolean alerts: color-coded (red for leak/smoke)

---

## 8. button — Remote / Push Button

Device that emits actions (click, double-click, hold). No state, no orders — only data events that trigger automations.

### Data Bindings

| Alias    | Category | Type   | Values                           | Description        |
| -------- | -------- | ------ | -------------------------------- | ------------------ |
| `action` | `action` | `text` | `"single"`, `"double"`, `"hold"` | Button press event |

> **Note:** LoRa remotes send `"click"` which is normalized to `"single"` at the parser level.

### Order Bindings

None — buttons emit events, they don't receive commands.

### Button Action Bindings

Buttons are special: instead of order bindings, they have **action bindings** that map press types to effects:

| Action   | Effect Types                                                       |
| -------- | ------------------------------------------------------------------ |
| `single` | `mode_activate`, `mode_toggle`, `equipment_order`, `recipe_toggle` |
| `double` | same                                                               |
| `hold`   | same                                                               |

Each effect type has its own config:

| Effect            | Config                                |
| ----------------- | ------------------------------------- |
| `mode_activate`   | `{ modeId }`                          |
| `mode_toggle`     | `{ modeAId, modeBId }`                |
| `equipment_order` | `{ equipmentId, orderAlias, value? }` |
| `recipe_toggle`   | `{ instanceId, enabled }`             |

### Zone Aggregation

None — action events are transient, not aggregated.

### UI Control

- Sensor values display (shows last action + elapsed time)
- Button Actions section for configuring bindings

---

## 9. weather — Weather Station

Grouped environmental data from a weather station. Excluded from zone aggregation to prevent mixing indoor/outdoor data.

### Data Bindings

Organized by physical device:

**Outdoor module:**

| Alias         | Category      | Type     | Description                |
| ------------- | ------------- | -------- | -------------------------- |
| `temperature` | `temperature` | `number` | Outside temperature (°C)   |
| `humidity`    | `humidity`    | `number` | Outside humidity (%)       |
| `pressure`    | `pressure`    | `number` | Atmospheric pressure (hPa) |

**Wind module:**

| Alias           | Category | Type     | Description        |
| --------------- | -------- | -------- | ------------------ |
| `wind_strength` | `wind`   | `number` | Wind speed (km/h)  |
| `wind_angle`    | `wind`   | `number` | Wind direction (°) |
| `gust_strength` | `wind`   | `number` | Gust speed (km/h)  |

**Rain module:**

| Alias         | Category | Type     | Description         |
| ------------- | -------- | -------- | ------------------- |
| `rain`        | `rain`   | `number` | Current rain (mm/h) |
| `sum_rain_1`  | `rain`   | `number` | Rain last hour (mm) |
| `sum_rain_24` | `rain`   | `number` | Rain last 24h (mm)  |

### Order Bindings

None — weather stations are read-only.

### Zone Aggregation

**Excluded.** Weather equipments are not included in zone aggregation to avoid mixing outdoor readings with indoor data.

### UI Control

- One card per physical device (outdoor, wind, rain)
- Hero value (large, 32px) centered
- Secondary values below
- Battery level in corner
- Device-kind-specific icons and colors

---

## 10. switch — Generic Switch

Generic on/off device (power outlet, relay, etc.). Behaves like `light_onoff` for control, but semantically different.

### Data Bindings

| Alias   | Category      | Type      | Values               | Description         |
| ------- | ------------- | --------- | -------------------- | ------------------- |
| `state` | `light_state` | `boolean` | `true` / `"ON"` = on | Switch is on or off |

### Order Bindings

| Alias   | Type      | Values           | Description          |
| ------- | --------- | ---------------- | -------------------- |
| `state` | `boolean` | `true` / `false` | Toggle switch on/off |

### Zone Aggregation

- `light_state` → **COUNT** on / total (counted alongside lights)

### UI Control

- Toggle button (same as light_onoff)

---

## Zone Orders (Group Commands)

Zone orders execute a command on all matching equipments within one or more zones.

| Key                | Target Types                                   | Order      | Value   | Description         |
| ------------------ | ---------------------------------------------- | ---------- | ------- | ------------------- |
| `allLightsOn`      | `light_onoff`, `light_dimmable`, `light_color` | `state`    | `"ON"`  | Turn on all lights  |
| `allLightsOff`     | `light_onoff`, `light_dimmable`, `light_color` | `state`    | `"OFF"` | Turn off all lights |
| `allShuttersOpen`  | `shutter`                                      | `position` | `100`   | Open all shutters   |
| `allShuttersClose` | `shutter`                                      | `position` | `0`     | Close all shutters  |

---

## Value Resolution

When an order is executed without an explicit value:

1. If the order binding has `enumValues` with exactly one entry → use that value automatically
2. If `enumValues` has multiple entries → caller must specify
3. If no `enumValues` and type is `number` → caller must specify
4. If no `enumValues` and type is `boolean` → toggle behavior

This allows simplified UX: a gate toggle with `enumValues: ["latch"]` doesn't require the user to type "latch".

---

## Data Category Reference

Categories drive zone aggregation and UI icon/color selection.

| Category           | Type      | Aggregation      | Unit   | Icon            |
| ------------------ | --------- | ---------------- | ------ | --------------- |
| `temperature`      | `number`  | AVG              | °C     | Thermometer     |
| `humidity`         | `number`  | AVG              | %      | Droplets        |
| `pressure`         | `number`  | —                | hPa    | —               |
| `luminosity`       | `number`  | AVG              | lux    | Sun             |
| `motion`           | `boolean` | OR + COUNT       | —      | PersonStanding  |
| `contact_door`     | `boolean` | COUNT open       | —      | DoorOpen/Closed |
| `contact_window`   | `boolean` | COUNT open       | —      | DoorOpen/Closed |
| `light_state`      | `boolean` | COUNT on/total   | —      | Lightbulb       |
| `light_brightness` | `number`  | —                | 0–254  | SunDim          |
| `light_color_temp` | `number`  | —                | mireds | —               |
| `shutter_position` | `number`  | AVG + COUNT open | %      | Blinds          |
| `battery`          | `number`  | —                | %      | Battery         |
| `voltage`          | `number`  | —                | V      | —               |
| `power`            | `number`  | —                | W      | —               |
| `energy`           | `number`  | —                | kWh    | —               |
| `water_leak`       | `boolean` | OR               | —      | Droplet         |
| `smoke`            | `boolean` | OR               | —      | Flame           |
| `co2`              | `number`  | —                | ppm    | —               |
| `voc`              | `number`  | —                | —      | —               |
| `wind`             | `number`  | —                | km/h   | Wind            |
| `rain`             | `number`  | —                | mm     | CloudRain       |
| `action`           | `text`    | —                | —      | CircleDot       |
| `generic`          | any       | —                | —      | —               |
