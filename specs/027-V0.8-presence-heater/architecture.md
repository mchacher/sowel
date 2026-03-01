# Architecture: V0.8 Presence Heater

## Data Model Changes

Add `"heater"` to `EquipmentType` union in `types.ts`. No database schema changes. No new tables.

## Event Bus Events

**Consumed (existing):**

- `zone.data.changed` — motion detection (existing subscription pattern)
- `equipment.data.changed` — relay state for override detection (existing pattern)

**No new events emitted.**

## State Machine

```
ECO ──motion──→ COMFORT ──timeout──→ ECO
 │                │
 │ nightStart     │ nightStart
 ↓                ↓
ECO (forced)      ECO (forced)
 │
 ├─ nightEnd + motion → COMFORT
 ├─ nightEnd + no motion → ECO
 └─ manual relay change → OVERRIDE → timeout → ECO
```

## Relay Mapping

| invertRelay | Comfort action | Eco action  |
| ----------- | -------------- | ----------- |
| false       | state → ON     | state → OFF |
| true        | state → OFF    | state → ON  |

## Recipe Slots

| Slot          | Type      | Required | Group | Default |
| ------------- | --------- | -------- | ----- | ------- |
| zone          | zone      | yes      | —     | —       |
| heaters       | equipment | yes      | —     | —       |
| timeout       | duration  | yes      | —     | 30m     |
| invertRelay   | boolean   | no       | —     | false   |
| nightStart    | time      | no       | night | —       |
| nightEnd      | time      | no       | night | —       |
| maxOnDuration | duration  | no       | —     | —       |

## File Changes

| File                                    | Change                                      |
| --------------------------------------- | ------------------------------------------- |
| `src/shared/types.ts`                   | Add `"heater"` to EquipmentType union       |
| `src/equipments/equipment-manager.ts`   | Add `"heater"` to VALID_EQUIPMENT_TYPES set |
| `src/recipes/presence-heater.ts`        | New recipe class                            |
| `src/recipes/presence-heater.test.ts`   | Tests                                       |
| `src/recipes/engine/recipe-registry.ts` | Register presence-heater recipe             |
