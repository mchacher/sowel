# Recipes Roadmap

Specification of future recipes to implement for Sowel.

## Design Principles

- **Recipes are reactive automations**: they respond to real-time events (motion, button press, sensor threshold) with dynamic logic (timers, state machines, conditions).
- **Modes are static configurations**: scheduled or manual activation of impacts (orders, recipe toggles). Time-based scheduling, night routines, comfort/eco profiles belong to the Modes system.
- **One recipe = one clear intent**: avoid monolithic recipes with too many options. Two simple recipes are better than one complex one.
- **Shared internals**: common logic (constant light regulation, duration parsing) is extracted into shared helpers, not exposed as standalone recipes.

---

## Recipe 1: Motion Light (implemented)

**Status:** Done (V0.8 + V0.8b)

**Intent:** Lights follow presence — auto-on when motion, auto-off after timeout.

**Slots:**
| Slot | Type | Required | Description |
|------|------|----------|-------------|
| zone | zone | Yes | Zone to monitor for motion |
| lights | equipment[] | Yes | Lights to control (light_onoff, light_dimmable, light_color) |
| timeout | duration | Yes | Delay before turning off (default: 10m) |
| luxThreshold | number | No | Block turn-on if luminosity above this value |
| maxOnDuration | duration | No | Failsafe: force off after this duration |

**Future enhancements:**

- Add optional `buttons` slot (equipment[], type: button) for manual override (toggle, force on, force off)
- Add optional `targetLux` + `luxSensor` slots for constant light regulation (see Constant Light module below)

---

## Recipe 2: Switch Light (to implement)

**Intent:** Lights follow manual commands — buttons/switches toggle lights, no automatic trigger.

This is the basic lighting recipe for rooms without PIR sensors, where users control lights via wall switches, remotes, or smart buttons.

**Slots:**
| Slot | Type | Required | Description |
|------|------|----------|-------------|
| zone | zone | Yes | Zone containing the lights |
| lights | equipment[] | Yes | Lights to control (light_onoff, light_dimmable, light_color) |
| buttons | equipment[] | Yes | Button/switch equipments that trigger actions |
| actionMapping | json | Yes | Map button actions to light behaviors (see below) |
| maxOnDuration | duration | No | Failsafe: force off after this duration |

**Action mapping:** Each button can have its action events mapped to light behaviors:

- `toggle` — Toggle all lights on/off
- `turn_on` — Turn on all lights
- `turn_off` — Turn off all lights
- `brightness_up` — Increase brightness by step
- `brightness_down` — Decrease brightness by step

Example mapping:

```json
{
  "<button_equipment_id>": {
    "single": "toggle",
    "double": "turn_off",
    "long": "brightness_up"
  }
}
```

**Behavior:**

1. Button action received → lookup mapping → execute light action
2. If `maxOnDuration` set and lights turned on → start failsafe timer
3. Lights turned off (by any means) → cancel failsafe

**Event subscriptions:**

- `equipment.data.changed` (alias: `action`) for button events
- `equipment.data.changed` (alias: `state`) for external light changes

**Future enhancements:**

- Add optional `targetLux` + `luxSensor` slots for constant light regulation

---

## Shared Module: Constant Light Regulation

**Intent:** Maintain a target illuminance level by dynamically adjusting light brightness based on a luminosity sensor.

This is NOT a standalone recipe. It is a shared internal module that can be activated as an option on Motion Light and Switch Light recipes.

**Additional slots (added to parent recipe when enabled):**
| Slot | Type | Required | Description |
|------|------|----------|-------------|
| targetLux | number | No | Target illuminance in lux (e.g., 300) |
| luxSensor | equipment | No | Luminosity sensor equipment to read from |
| regulationInterval | duration | No | How often to adjust (default: 30s) |

**Behavior:**

1. When lights are ON and `targetLux` is configured:
   - Read current luminosity from `luxSensor`
   - Compare to `targetLux`
   - Adjust brightness of dimmable lights proportionally (P-controller)
   - Clamp between min (5%) and max (100%)
2. Regulation runs on a periodic interval (default 30s)
3. Regulation pauses when lights are OFF
4. Regulation respects manual brightness override: if user manually sets brightness, pause regulation for N minutes

**Implementation notes:**

- Only applies to `light_dimmable` and `light_color` equipments (skip `light_onoff`)
- Use a simple proportional controller: `newBrightness = currentBrightness + K * (targetLux - currentLux)`
- K (gain) can be a hardcoded reasonable value initially, tuned later
- Needs careful hysteresis to avoid oscillation (dead band around target)

---

## Recipe 3: Welcome Light (to implement)

**Intent:** Lights turn on when a door opens, if it's dark enough. Auto-off after timeout.

Useful for entrance halls, garages, closets — areas with door contact sensors but no PIR.

**Slots:**
| Slot | Type | Required | Description |
|------|------|----------|-------------|
| zone | zone | Yes | Zone containing lights and door sensor |
| lights | equipment[] | Yes | Lights to control |
| doorSensors | equipment[] | Yes | Door contact sensor equipments (contact_door) |
| timeout | duration | Yes | Delay before turning off after door closes (default: 5m) |
| luxThreshold | number | No | Block turn-on if luminosity above this value |
| onlyOnOpen | boolean | No | Only trigger on door open (default: true). If false, also retrigger on close |

**Behavior:**

1. Door opens + lights OFF + not too bright → turn ON lights, start off-timer
2. Door opens + lights ON → reset off-timer
3. Door closes → start/reset off-timer (unless `onlyOnOpen` is false, then also turn on)
4. Timer expires → turn OFF lights
5. Light turned off externally → cancel timer

**Event subscriptions:**

- `equipment.data.changed` (category: `contact_door`) for door sensor events
- `zone.data.changed` for luminosity (lux threshold check)
- `equipment.data.changed` (alias: `state`) for external light changes

---

## Recipe 4: Window Thermostat (to implement)

**Intent:** Pause thermostat when a window opens to save energy. Resume when window closes.

Classic energy-saving automation. Prevents heating/cooling from running with open windows.

**Slots:**
| Slot | Type | Required | Description |
|------|------|----------|-------------|
| windowSensors | equipment[] | Yes | Window contact sensor equipments (contact_window) |
| thermostat | equipment | Yes | Thermostat equipment to pause/resume |
| delay | duration | No | Delay before pausing after window opens (default: 1m) — avoids quick open/close |
| resumeDelay | duration | No | Delay before resuming after window closes (default: 30s) |

**Behavior:**

1. Window opens → start pause delay timer
2. Pause delay expires + window still open → save current thermostat state, send power_off or set to away mode
3. Window closes → start resume delay timer
4. Resume delay expires + all windows closed → restore thermostat to saved state
5. Multiple windows: only pause once (first open), only resume when ALL are closed

**State persistence:**

- `savedMode` — Thermostat mode before pause
- `savedTemperature` — Thermostat setpoint before pause
- `paused` — Whether thermostat is currently paused by this recipe

**Event subscriptions:**

- `equipment.data.changed` (category: `contact_window`) for window sensor events

---

## Recipe 5: Security Alert (to implement — requires notification system)

**Intent:** Immediate response to water leak or smoke detection.

**Slots:**
| Slot | Type | Required | Description |
|------|------|----------|-------------|
| zone | zone | Yes | Zone to monitor |
| alertType | enum | Yes | `water_leak`, `smoke`, or `both` |
| lights | equipment[] | No | Lights to turn on as visual alert |
| notificationChannel | text | No | Notification channel (future) |

**Behavior:**

1. Water leak or smoke detected in zone → turn on all specified lights + send notification
2. Alert cleared → log event, lights remain on (manual reset required for safety)

**Depends on:** Notification system (not yet implemented). Can ship without notifications initially (lights-only + recipe log).

---

## Recipe 6: Temperature Alert (to implement — requires notification system)

**Intent:** Alert when temperature crosses a threshold.

Useful for: freezer monitoring, server room, greenhouse, baby room.

**Slots:**
| Slot | Type | Required | Description |
|------|------|----------|-------------|
| zone | zone | Yes | Zone to monitor |
| minTemp | number | No | Alert if temperature drops below this value |
| maxTemp | number | No | Alert if temperature rises above this value |
| hysteresis | number | No | Dead band to avoid alert flapping (default: 1°C) |
| notificationChannel | text | No | Notification channel (future) |

**Behavior:**

1. Temperature drops below `minTemp - hysteresis` → alert triggered, log + notify
2. Temperature rises above `maxTemp + hysteresis` → alert triggered, log + notify
3. Temperature returns to normal range → alert cleared, log + notify
4. Hysteresis prevents rapid on/off flapping

**State persistence:**

- `alertActive` — Whether alert is currently active
- `lastAlertType` — `cold` or `hot`

**Depends on:** Notification system for full value. Can ship with recipe log only initially.

---

## Implementation Priority

| Priority | Recipe                     | Reason                                                                     |
| -------- | -------------------------- | -------------------------------------------------------------------------- |
| 1        | **Switch Light**           | Completes the basic lighting toolkit (PIR + button). Most homes have both. |
| 2        | **Motion Light + buttons** | Extend existing recipe with manual override — common need.                 |
| 3        | **Constant Light module**  | Shared module, then wire into both lighting recipes.                       |
| 4        | **Welcome Light**          | New trigger type (contact), validates recipe pattern reuse.                |
| 5        | **Window Thermostat**      | First non-lighting recipe, introduces stateful pause/resume pattern.       |
| 6        | **Security Alert**         | High value but depends on notification system. Ship lights-only first.     |
| 7        | **Temperature Alert**      | Same dependency on notifications.                                          |

---

## Technical Notes

### Shared helpers to extract

When implementing recipes 2+, extract from `motion-light.ts`:

- `parseDuration()` / `formatDuration()` → `src/recipes/engine/duration.ts`
- Light state helpers (isAnyLightOn, turnOn, turnOff with error collection) → `src/recipes/engine/light-helpers.ts`
- Constant light regulation → `src/recipes/engine/constant-light.ts`

### New slot types needed

- `json` type for action mapping (Switch Light) — or a structured `actionMapping` type
- `enum` type for alertType (Security Alert) — already in spec but not implemented

### Button action data flow

Button equipments emit `equipment.data.changed` with `alias: "action"` and values like `"single"`, `"double"`, `"long"`, `"arrow_left_click"`, etc. (Zigbee2MQTT convention). The Switch Light recipe maps these action values to light behaviors.
