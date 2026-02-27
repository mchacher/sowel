# Implementation Plan: V0.8e Presence Thermostat

## Tasks

1. [ ] Create `src/recipes/presence-thermostat.ts` — Recipe class with slots, i18n, validation
2. [ ] Implement `start()` — event subscriptions + preheat timer + startup state evaluation
3. [ ] Implement core logic — `onZoneChanged()`, `setComfort()`, `setEco()`, eco timer
4. [ ] Implement night window — `getTargetComfortTemp()` with time-based resolution
5. [ ] Implement preheat windows — `isInPreheatWindow()`, periodic check, weekday/weekend detection
6. [ ] Implement override mode — self-triggered guard, enter/exit, vacancy tracking
7. [ ] Register recipe in `src/index.ts`
8. [ ] Create `src/recipes/presence-thermostat.test.ts` — comprehensive tests
9. [ ] Type check + full test suite + lint

## Dependencies

- Requires existing Recipe engine (V0.8)
- Requires zone aggregation with motion (V0.7)
- Thermostat equipment must have "setpoint" order binding configured by user

## Testing

### Unit Tests (presence-thermostat.test.ts)

**Validation:**

- Required params (zone, thermostat, comfortTemp, ecoTemp, timeout)
- Thermostat must have "setpoint" order binding
- Thermostat must belong to the selected zone
- nightTemp requires nightStart + nightEnd
- preheatStart requires preheatEnd (and vice versa)
- weekendPreheatStart requires weekendPreheatEnd

**Normal cycle:**

- Motion detected → sends comfort setpoint
- No motion + timeout → sends eco setpoint
- Motion while in comfort → no redundant command, cancels eco timer
- Repeated motion → resets eco timer
- No motion while already eco → no redundant command

**Night window:**

- Motion during night → sends nightTemp (not comfortTemp)
- Motion outside night → sends comfortTemp
- Eco timer during night → still sends ecoTemp

**Preheat:**

- Entering weekday preheat → sends comfort setpoint
- Entering weekend preheat → sends comfort setpoint
- No eco transition during preheat even without motion
- Preheat ends + no motion → starts eco timer
- Preheat ends + motion present → stays in comfort
- Preheat + night window overlap → sends nightTemp

**Override:**

- Manual setpoint change → enters override
- Self-triggered setpoint → ignored (no override)
- Override: motion ignored, only vacancy tracking
- Override: timeout → sends eco + clears override
- Preheat does NOT break override

**Startup:**

- Start with motion present → sends comfort immediately
- Start without motion → stays eco (no command)
- Start during preheat → sends comfort immediately

### Manual Verification

- Create thermostat equipment with "setpoint" order binding (MCZ or Z2M TRV)
- Create recipe instance, verify comfort/eco transitions in logs
- Test preheat by setting window to current time
- Test override by manually changing setpoint via UI
