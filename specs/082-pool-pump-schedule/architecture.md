# Spec 082 — Architecture

## Packaging

This is a **recipe plugin**, distributed from its own GitHub repo
(mirroring `sowel-recipe-auto-watering`). Nothing ships inside the
Sowel core repo except a bump of `plugins/registry.json`.

```
sowel-recipe-pool-pump-schedule/
├── manifest.json
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # createRecipe() — slots + instance factory
│   └── index.test.ts      # vitest unit tests
└── .github/
    └── workflows/
        └── release.yml    # same as auto-watering: tag → build → release
```

### `manifest.json`

```json
{
  "id": "pool-pump-schedule",
  "type": "recipe",
  "name": "Pool Pump Schedule",
  "version": "1.0.0",
  "description": "Scheduled on/off for a pool pump — up to 3 daily time windows",
  "icon": "Waves",
  "repo": "mchacher/sowel-recipe-pool-pump-schedule",
  "author": "mchacher",
  "tags": ["pool", "pump", "schedule", "automation"],
  "i18n": {
    "fr": {
      "name": "Programmation pompe piscine",
      "description": "Plages horaires on/off pour la pompe de piscine — jusqu'à 3 créneaux par jour"
    }
  },
  "sowelVersion": ">=1.3.0"
}
```

## Slot model

Six optional slots per instance plus the pump itself (slot 1 start/end
required):

| slot id       | type      | required | constraints                      |
| ------------- | --------- | -------- | -------------------------------- |
| `pump`        | equipment | yes      | `equipmentType: pool_pump`       |
| `slot1_start` | time      | yes      | HH:MM                            |
| `slot1_end`   | time      | yes      | HH:MM                            |
| `slot2_start` | time      | no       | HH:MM                            |
| `slot2_end`   | time      | no       | HH:MM (required if `_start` set) |
| `slot3_start` | time      | no       | HH:MM                            |
| `slot3_end`   | time      | no       | HH:MM (required if `_start` set) |

Grouping (for the UI picker) mirrors auto-watering:

- Group `slot1` — required, always visible.
- Group `slot2` and `slot3` — collapsed by default, expanded on
  demand.

## State tracked in `ctx.state`

| key           | type                   | meaning                                    |
| ------------- | ---------------------- | ------------------------------------------ |
| `status`      | `"idle"` / `"running"` | Is the pump currently driven ON by a slot? |
| `currentSlot` | `"HH:MM-HH:MM"`        | Active window label, or `null`             |
| `nextStart`   | `"HH:MM"`              | Next start-of-window, for the UI           |
| `nextEnd`     | `"HH:MM"`              | Next end-of-window, for the UI             |

## Scheduling logic

### `msUntilTime(hhmm: string): number`

Returns ms from now to the next occurrence of `HH:MM` local time. If
the time has already passed today, returns the delay until tomorrow.
Copy-paste from `auto-watering`.

### Per-slot scheduling

For each configured slot `{ start, end }`:

1. **Start timer** — `setTimeout` at `msUntilTime(start)`. On fire:
   - `executeOrder(pumpId, "state", "ON")`
   - Update state: `status = "running"`, `currentSlot = "HH:MM-HH:MM"`
   - Reschedule the start timer for tomorrow.
2. **End timer** — `setTimeout` at `msUntilTime(end)`. On fire:
   - `executeOrder(pumpId, "state", "OFF")`
   - Update state: `status = "idle"`, `currentSlot = null`
   - Reschedule the end timer for tomorrow.

Start and end are independent timers — no need to chain them via a
single setTimeout + duration. That also keeps the midnight-crossing
case trivial: `msUntilTime` handles it naturally.

### `stop()`

- Cancel every outstanding start and end timer.
- If `state.status === "running"`: issue an `OFF` (override — we don't
  leave the pump running when the recipe is disabled).
- Update state: `status = "idle"`, `currentSlot = null`.

## Value mapping

The `state` order alias on a pool_pump is typically an enum
`["ON","OFF"]` (Tasmota `power*` route). We always send the uppercase
strings `"ON"` and `"OFF"`; the equipment manager / plugin handles
the routing.

## Registry update (Sowel core)

Single line added to `plugins/registry.json` after the Tasmota entry:

```json
{
  "id": "pool-pump-schedule",
  "type": "recipe",
  "name": "Pool Pump Schedule",
  "description": "Scheduled on/off for a pool pump — up to 3 daily time windows",
  "icon": "Waves",
  "author": "mchacher",
  "repo": "mchacher/sowel-recipe-pool-pump-schedule",
  "version": "1.0.0",
  "tags": ["pool", "pump", "schedule", "automation"],
  "i18n": {
    "fr": {
      "name": "Programmation pompe piscine",
      "description": "Plages horaires on/off pour la pompe de piscine — jusqu'à 3 créneaux par jour"
    }
  },
  "sowelVersion": ">=1.3.0"
}
```

No schema change, no code change in the Sowel core repo beyond the
registry bump — per the "no Sowel release for registry updates" rule,
the bump lands on `main` as a chore commit without a version bump.

## Files to create / modify

### New repo: `sowel-recipe-pool-pump-schedule`

| File                            | Content                                 |
| ------------------------------- | --------------------------------------- |
| `manifest.json`                 | see above                               |
| `package.json`                  | copy of auto-watering with rename       |
| `tsconfig.json`                 | copy of auto-watering                   |
| `.github/workflows/release.yml` | copy of auto-watering                   |
| `src/index.ts`                  | `createRecipe()` implementation         |
| `src/index.test.ts`             | vitest suite (see Test Plan in plan.md) |
| `README.md`                     | short usage note                        |

### Sowel core

| File                    | Change                          |
| ----------------------- | ------------------------------- |
| `plugins/registry.json` | append pool-pump-schedule entry |
