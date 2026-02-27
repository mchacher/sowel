# V0.8e: Presence Thermostat Recipe

## Summary

A recipe that automatically adjusts a thermostat setpoint based on zone presence. When motion is detected, the thermostat is set to the **comfort** temperature. After a configurable timeout with no motion, it switches to the **eco** temperature. Optional features: **night** setpoint during a night window, **preheat** windows (weekday + weekend) that force comfort regardless of presence, and **manual override** detection.

## Reference

- Spec sections: §8 Recipes, §6 Zone Aggregation (motion)
- Related: specs/018-recipes-roadmap (Recipe 4: Window Thermostat — different scope)
- Pattern: follows motion-light.ts architecture (event-driven + timers + override)

## Acceptance Criteria

- [ ] Recipe `presence-thermostat` is registered and available in the UI
- [ ] Creating an instance requires: zone, thermostat, comfortTemp, ecoTemp, timeout
- [ ] Validation checks thermostat has a "setpoint" order binding
- [ ] When motion detected and currently eco → sends comfort setpoint
- [ ] After timeout with no motion and currently comfort → sends eco setpoint
- [ ] Night window (optional): overrides comfort temperature with nightTemp during nightStart..nightEnd
- [ ] Preheat weekday (optional): forces comfort during preheatStart..preheatEnd on Mon-Fri
- [ ] Preheat weekend (optional): forces comfort during weekendPreheatStart..weekendPreheatEnd on Sat-Sun
- [ ] During preheat window, no eco transition even without presence
- [ ] Manual override: if user changes setpoint externally, recipe suspends until next full absence cycle
- [ ] Self-triggered detection prevents recipe's own setpoint commands from triggering override
- [ ] On startup (`start()`), evaluates current zone state immediately (same as motion-light)
- [ ] i18n: French translations for all slots
- [ ] Comprehensive test coverage (validation, normal cycle, night window, preheat, override, startup)
- [ ] 0 type errors, all tests pass

## Slots

| Slot                  | Type      | Required | Default | Description                                               |
| --------------------- | --------- | -------- | ------- | --------------------------------------------------------- |
| `zone`                | zone      | yes      | —       | Zone to monitor for presence                              |
| `thermostat`          | equipment | yes      | —       | Thermostat equipment (must have "setpoint" order binding) |
| `comfortTemp`         | number    | yes      | —       | Setpoint when presence detected (°C)                      |
| `ecoTemp`             | number    | yes      | —       | Setpoint after absence timeout (°C)                       |
| `timeout`             | duration  | yes      | 30m     | Delay with no motion before switching to eco              |
| `nightTemp`           | number    | no       | —       | Setpoint during night window (°C)                         |
| `nightStart`          | time      | no       | —       | Start of night window (HH:MM)                             |
| `nightEnd`            | time      | no       | —       | End of night window (HH:MM)                               |
| `preheatStart`        | time      | no       | —       | Start of weekday preheat (HH:MM, Mon-Fri)                 |
| `preheatEnd`          | time      | no       | —       | End of weekday preheat (HH:MM, Mon-Fri)                   |
| `weekendPreheatStart` | time      | no       | —       | Start of weekend preheat (HH:MM, Sat-Sun)                 |
| `weekendPreheatEnd`   | time      | no       | —       | End of weekend preheat (HH:MM, Sat-Sun)                   |

## State Machine

```
COMFORT MODE (presence detected or preheat active)
  │
  ├─ motion event → stay in comfort (cancel eco timer if running)
  ├─ no motion + NOT in preheat window → start eco timer
  │                  │
  │                  └─ timer expires → send ecoTemp → ECO MODE
  │
  ├─ no motion + IN preheat window → stay in comfort (no eco timer)
  │
  ├─ user changes setpoint ──────────────────────┐
  │                                               ▼
  │                                        OVERRIDE MODE
  │                                          │
  │                                          ├─ motion → ignored
  │                                          ├─ no motion + timeout → send ecoTemp + clear override
  │                                          │                        ▼
  │◄──────────────────────────────────────── back to normal
  │
  └─ night window active → use nightTemp instead of comfortTemp

ECO MODE (no presence, outside preheat)
  │
  ├─ motion detected → send comfortTemp (or nightTemp) → COMFORT MODE
  ├─ no motion → stay in eco
  ├─ preheat window starts → send comfortTemp → COMFORT MODE
  │
  └─ user changes setpoint → OVERRIDE MODE
```

## Preheat Logic

- **Weekday preheat**: preheatStart and preheatEnd define a window on Monday-Friday
- **Weekend preheat**: weekendPreheatStart and weekendPreheatEnd define a window on Saturday-Sunday
- Each pair must be provided together (start + end)
- Weekend preheat is independent from weekday preheat (can have one without the other)
- During a preheat window:
  - Force comfort temperature (or nightTemp if night window overlaps)
  - Do NOT start eco timer even without presence
  - If eco timer was running, cancel it
- When preheat window ends:
  - If presence → stay in comfort (normal behavior)
  - If no presence → start eco timer immediately
- Implementation: periodic check via timer (every 60s) or on each zone event, evaluate `isInPreheatWindow()`
- Day detection: `new Date().getDay()` — 0=Sun, 6=Sat → weekend = day === 0 || day === 6

## Night Window Logic

- nightTemp, nightStart, and nightEnd must all be provided together (or all omitted)
- During the night window, `comfortTemp` is replaced by `nightTemp`
- ecoTemp is NOT affected by night window (eco is always the same)
- Night window only affects what temperature is sent when switching to comfort
- `getTargetComfortTemp()`: returns nightTemp during night window, comfortTemp otherwise
- Night window interacts with preheat: preheat forces comfort, but the comfort value may be nightTemp

## Override Mode

Same pattern as motion-light:

- **Self-triggered detection**: recipe sets `selfTriggeredUntil = Date.now() + 3000` before sending setpoint
- **Enter override**: when a "setpoint" data change is detected on the thermostat AND it's not self-triggered
- **In override**: motion events are ignored (no setpoint changes), only vacancy tracking continues
- **Exit override**: when no motion for timeout duration → sends ecoTemp + clears override
- **Preheat does NOT override manual override**: if user manually changed setpoint, respect that even during preheat

## Scope

### In Scope

- Presence-based comfort/eco setpoint control
- Night temperature window
- Weekday/weekend preheat windows
- Manual override detection with self-triggered guard
- Startup state evaluation
- Recipe state persistence (timerExpiresAt, overrideMode, currentMode)

### Out of Scope

- Thermostat on/off control (only setpoint adjustment)
- PID regulation / continuous control loop
- Multiple thermostats per instance (use separate instances)
- Window-open detection (separate recipe: Window Thermostat)
- Mode integration (suspend on vacation mode — future enhancement)
- Per-day preheat schedules (only weekday vs weekend split)

## Edge Cases

- Thermostat equipment has no "setpoint" order binding → validation error
- Zone has no motion sensors → validation warning (recipe will never trigger from presence, but preheat still works)
- nightTemp provided without nightStart/nightEnd → validation error
- preheatStart without preheatEnd → validation error (and vice versa)
- ecoTemp > comfortTemp → allowed (e.g., cooling scenario: comfort=22°C, eco=28°C)
- Thermostat goes offline → order dispatch logs error, recipe stays in current state
- Recipe enabled while no motion and outside preheat → stays in eco, no command sent
- Recipe enabled while motion present → sends comfort setpoint immediately
- Recipe enabled during preheat window → sends comfort setpoint immediately
- Preheat overlaps with night window → sends nightTemp (night overrides comfort value)
- Preheat starts while in override → override takes precedence (no forced comfort)
