# Architecture: V0.8e Presence Thermostat

## Data Model Changes

No database changes. Uses existing:

- `recipe_instances` table for instance params + enabled status
- `recipe_state` table for runtime state persistence
- `recipe_log` table for execution logs

## Types

No new types needed. Existing types used:

- `RecipeSlotDef` with types: zone, equipment, number, duration, time
- `RecipeContext` (eventBus, equipmentManager, zoneManager, zoneAggregator, state, log)
- `EquipmentType: "thermostat"` (already defined)

## Events Consumed

| Event                                        | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `zone.data.changed`                          | Monitor motion in the zone (presence detection)   |
| `equipment.data.changed` (alias: "setpoint") | Detect manual setpoint changes → trigger override |

## Orders Sent

| Order Alias | Equipment  | Value                   | When                                                 |
| ----------- | ---------- | ----------------------- | ---------------------------------------------------- |
| `setpoint`  | thermostat | comfortTemp / nightTemp | Motion detected (eco→comfort), preheat window starts |
| `setpoint`  | thermostat | ecoTemp                 | Timeout expires (comfort→eco)                        |

## State Persistence

| Key              | Type                 | Purpose                                   |
| ---------------- | -------------------- | ----------------------------------------- |
| `currentMode`    | `"comfort" \| "eco"` | Track what setpoint was last sent         |
| `timerExpiresAt` | ISO string           | When eco timer will fire (for UI display) |
| `overrideMode`   | boolean              | Whether manual override is active         |

## File Changes

| File                                      | Change                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| `src/recipes/presence-thermostat.ts`      | **NEW** — Full recipe implementation (~400 LOC)         |
| `src/recipes/presence-thermostat.test.ts` | **NEW** — Comprehensive tests (~500 LOC)                |
| `src/index.ts`                            | Register `PresenceThermostatRecipe` with recipe manager |

## Architecture Diagram

```
zone.data.changed (motion)
  │
  ├─ motion=true ──────────────────────────► isInPreheatWindow()?
  │   └─ currentMode=eco?                       │
  │       └─ YES → setpoint(getTargetComfort())  │ YES → force comfort
  │                                              │ NO  → normal presence logic
  │
  ├─ motion=false ─────────────────────────► isInPreheatWindow()?
  │   └─ NOT in preheat?                        │
  │       └─ start eco timer ──► timeout ──► setpoint(ecoTemp)
  │
  └─ (override mode) → only track vacancy


equipment.data.changed (setpoint on thermostat)
  │
  ├─ selfTriggered? → ignore
  └─ NOT selfTriggered → enter override mode


Periodic preheat check (every 60s):
  │
  ├─ entering preheat window + not override → setpoint(getTargetComfort())
  └─ leaving preheat window + no motion → start eco timer
```
