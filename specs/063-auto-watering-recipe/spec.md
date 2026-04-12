# Spec 063 — Auto-watering recipe plugin

## Context

The `water_valve` equipment type (spec 062) and `rain_24h` computed data (spec 064) are now in place. This spec delivers the auto-watering recipe as an external recipe plugin (`sowel-recipe-auto-watering`), following the same architecture as existing recipes (state-watch, presence-thermostat, etc.).

The recipe automates garden irrigation on a configurable schedule, with optional rain-based skip logic. It targets the SONOFF SWV and similar smart water valves, using the `on_time` composite payload (plugin zigbee2mqtt v1.2.0) for timed watering.

## Goals

1. Scheduled watering with configurable time slots (1 or more per day)
2. Per-valve duration per slot (each valve can have a different duration per slot)
3. All selected valves open simultaneously
4. Optional rain-based skip: if `rain_24h` on a selected weather station exceeds a threshold, the slot is skipped
5. Optional forecast-based skip: if `j1_rain_prob > 75%` on the auto-detected weather_forecast equipment, the slot is skipped
6. Recipe state visible on the zone page via pills (idle / watering / skipped)
7. Detailed logging of every decision (triggered, skipped, opened, closed)

## Non-Goals

- Soil moisture sensor integration (no device available)
- Duration adjustment based on temperature / wind / ETo
- Sequential valve operation (all valves open simultaneously)
- Manual actions (arroser maintenant, sauter le prochain créneau)
- Restriction horaire (interdire l'arrosage en journée)
- Notifications (handled by the notification system, not the recipe)
- Multi-zone sequencing (user creates one instance per zone if needed)

## Recipe Parameters (Slots)

### Core slots

| Slot ID  | Type             | Required | Description                                        |
| -------- | ---------------- | -------- | -------------------------------------------------- |
| `zone`   | zone             | yes      | Zone where the recipe operates                     |
| `valves` | equipment (list) | yes      | Water valves to control. Constraint: `water_valve` |

### Time slots (dynamic list)

The user can add 1 or more time slots. Each slot has:

| Field       | Type         | Description                                                                            |
| ----------- | ------------ | -------------------------------------------------------------------------------------- |
| `time`      | time (HH:MM) | Hour of the day to trigger                                                             |
| `durations` | object       | Duration per valve (in minutes). Key = valve equipment ID, value = duration in minutes |

Stored in params as:

```json
{
  "slots": [
    {
      "time": "06:00",
      "durations": {
        "valve-id-1": 15,
        "valve-id-2": 10
      }
    },
    {
      "time": "20:00",
      "durations": {
        "valve-id-1": 5,
        "valve-id-2": 8
      }
    }
  ]
}
```

### Rain condition (optional)

| Slot ID          | Type      | Required                            | Description                                                         |
| ---------------- | --------- | ----------------------------------- | ------------------------------------------------------------------- |
| `weatherStation` | equipment | no                                  | Weather station equipment (type: `weather`) to read `rain_24h` from |
| `rainThreshold`  | number    | no (required if weatherStation set) | Skip if `rain_24h > threshold` (in mm)                              |

### Forecast condition (optional)

| Slot ID           | Type    | Required | Description                                                                                                                 |
| ----------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `useRainForecast` | boolean | no       | Enable forecast-based skip. Only shown if a `weather_forecast` equipment exists. If enabled and `j1_rain_prob > 75%` → skip |

## Behavior

### Scheduling

- The recipe uses `setTimeout` / cron-like scheduling to trigger at each configured time
- At boot / instance start, the next trigger time is computed and a timer is set
- After each trigger, the next one is scheduled

### Trigger evaluation

When a time slot fires:

1. **Rain check** (if `weatherStation` configured):
   - Read `rain_24h` computed data from the weather equipment
   - If `rain_24h > rainThreshold` → skip, log reason, update state pill
2. **Forecast check** (if `useRainForecast` enabled):
   - Find the `weather_forecast` equipment (auto-detect, first found)
   - Read `j1_rain_prob` binding
   - If `j1_rain_prob > 75` → skip, log reason, update state pill
3. **Open valves**: for each valve in `valves`, execute order `state` with `{state: "ON", on_time: duration * 60}` (composite payload)
4. **Log**: "Arrosage créneau 06:00 — Vanne Potager 15 min, Vanne Pelouse 10 min"
5. **Update state**: set `status` = "watering", `currentSlot` = "06:00"
6. **Schedule close tracking**: after `max(durations)` seconds, update state to "idle" and log completion

### State (pills)

The recipe exposes state via `ctx.state`:

| Key              | Values                                            | Pill display      |
| ---------------- | ------------------------------------------------- | ----------------- |
| `status`         | `idle` / `watering` / `skipped`                   | Zone page pill    |
| `nextSlot`       | "06:00" / "20:00" / null                          | "Prochain: 06:00" |
| `currentSlot`    | "06:00" / null                                    | "Arrosage 06:00"  |
| `lastSkipReason` | "rain_24h=3.2mm (>2mm)" / "pluie J+1: 85%" / null | "Skippé: pluie"   |

### Logging

All actions logged via `ctx.log()`:

- Slot triggered: `"Créneau 06:00 — évaluation des conditions"`
- Slot skipped (rain): `"Créneau 06:00 skippé — rain_24h = 3.2 mm (seuil: 2 mm)"`
- Slot skipped (forecast): `"Créneau 06:00 skippé — probabilité pluie J+1 = 85%"`
- Valve opened: `"Vanne Potager ouverte pour 15 min"`
- Watering complete: `"Arrosage créneau 06:00 terminé"`
- Instance started: `"Recette démarrée — 2 créneaux, 2 vannes"`
- Instance stopped: `"Recette arrêtée"`

## i18n

French translations for all slot names, descriptions, group labels, state labels, and log messages. English as fallback.

## Acceptance Criteria

- [ ] Recipe plugin `sowel-recipe-auto-watering` is installable via PackageManager
- [ ] User can create an instance with: zone, valves, at least 1 time slot with per-valve durations
- [ ] Valves open simultaneously at the configured time using `on_time` composite payload
- [ ] Each valve gets its own duration (different `on_time` values)
- [ ] Rain skip works: if `rain_24h > threshold`, slot is skipped with log
- [ ] Forecast skip works: if `j1_rain_prob > 75%` and checkbox enabled, slot is skipped
- [ ] Zone page shows state pill (idle / watering / skipped)
- [ ] All actions logged in recipe log
- [ ] Recipe survives Sowel restart (timers re-scheduled from state)
- [ ] Instance can be enabled/disabled without losing configuration
- [ ] Multiple time slots work independently
- [ ] TypeScript compiles clean, tests pass

## Edge Cases

- **Valve offline**: `executeOrder` fails → log error, continue with other valves
- **Weather station not configured**: no rain check, always water
- **No weather_forecast equipment exists**: forecast checkbox hidden, no forecast check
- **rain_24h is null** (InfluxDB empty): treat as 0 — don't skip (no data ≠ no rain)
- **Sowel restart during watering**: the `on_time` is device-side, so the valve will close by itself. Recipe state resets to idle on restart.
- **All valves in a slot have duration 0**: skip slot silently
- **Time slot in the past for today**: schedule for tomorrow

## Related

- **Depends on**: spec 062 (water_valve equipment), spec 064 (rain_24h computed data), plugin zigbee2mqtt v1.2.0 (composite payload)
- **Repo**: `mchacher/sowel-recipe-auto-watering` (new, to be created)
- **Pattern follows**: `sowel-recipe-presence-thermostat`, `sowel-recipe-state-watch`
