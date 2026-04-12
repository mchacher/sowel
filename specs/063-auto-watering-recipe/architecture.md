# Architecture — Spec 063

## Overview

Two codebases involved:

1. **`sowel-recipe-auto-watering`** (new repo) — recipe plugin with scheduling logic, rain checks, valve control
2. **Sowel core** (this repo) — new `watering-schedule` slot type + UI component for the schedule editor

The schedule configuration (N time slots with per-valve durations) is too complex for existing flat slot types. A new slot type `watering-schedule` is added to the core, with a dedicated UI component that renders the time-slot / duration grid from the mockup.

## Recipe plugin — `sowel-recipe-auto-watering`

### Package structure

```
sowel-recipe-auto-watering/
├── manifest.json          # type: "recipe", id: "auto-watering"
├── package.json           # v1.0.0
├── tsconfig.json
├── src/
│   └── index.ts           # createRecipe() factory
└── dist/
    └── index.js           # Compiled output
```

### Recipe definition

```typescript
export function createRecipe(): RecipeDefinition {
  return {
    id: "auto-watering",
    name: "Auto Watering",
    description: "Scheduled irrigation with rain-aware skip logic",
    slots: [
      { id: "zone", type: "zone", required: true, name: "Zone", description: "Zone to manage" },
      {
        id: "valves",
        type: "equipment",
        list: true,
        required: true,
        name: "Water valves",
        description: "Valves to control",
        constraints: { equipmentType: "water_valve" },
      },
      {
        id: "schedule",
        type: "watering-schedule",
        required: true,
        name: "Watering schedule",
        description: "Time slots with per-valve durations",
      },
      {
        id: "weatherStation",
        type: "equipment",
        required: false,
        name: "Weather station",
        description: "Weather equipment to read rain_24h from",
        constraints: { equipmentType: "weather" },
        group: "weather",
      },
      {
        id: "rainThreshold",
        type: "number",
        required: false,
        name: "Rain threshold",
        description: "Skip if rain_24h exceeds this (mm)",
        constraints: { min: 0.1, max: 50 },
        group: "weather",
      },
      {
        id: "useRainForecast",
        type: "boolean",
        required: false,
        name: "Use rain forecast",
        description: "Skip if rain probability J+1 > 75%",
        defaultValue: false,
      },
    ],
    i18n: {
      fr: {
        name: "Arrosage Auto",
        description: "Arrosage programmé avec gestion intelligente de la pluie",
        slots: {
          zone: { name: "Zone", description: "Zone d'arrosage" },
          valves: { name: "Vannes d'arrosage", description: "Vannes à piloter" },
          schedule: { name: "Créneaux", description: "Horaires et durées par vanne" },
          weatherStation: { name: "Station météo", description: "Pour lire rain_24h" },
          rainThreshold: {
            name: "Seuil de pluie",
            description: "Skip si rain_24h dépasse ce seuil (mm)",
          },
          useRainForecast: {
            name: "Prévisions météo",
            description: "Skip si probabilité de pluie J+1 > 75%",
          },
        },
        groups: { weather: "Conditions météo" },
      },
    },
    validate(params, ctx) {
      /* ... */
    },
    createInstance(params, ctx) {
      /* ... */
    },
  };
}
```

### Params format

```typescript
{
  zone: "zone-id",
  valves: "valve-id-1,valve-id-2",     // comma-separated (existing convention)
  schedule: [                            // JSON array (new watering-schedule type)
    {
      time: "06:00",
      durations: { "valve-id-1": 15, "valve-id-2": 10 }
    },
    {
      time: "20:00",
      durations: { "valve-id-1": 5, "valve-id-2": 8 }
    }
  ],
  weatherStation: "weather-eq-id",       // optional
  rainThreshold: "2",                    // optional, string (existing convention)
  useRainForecast: "true"                // optional, boolean as string
}
```

### Instance lifecycle

**`createInstance(params, ctx)`:**

1. Parse and validate schedule
2. Compute next trigger time for each slot
3. Set timers via `setTimeout`
4. Set initial state: `status=idle`, `nextSlot=<soonest>`
5. Subscribe to no events (timer-driven, not event-driven)
6. Return `{ stop() }` handle

**Timer trigger flow:**

```
Timer fires for slot "06:00"
  ├─ Check rain condition (if weatherStation set)
  │    ├─ Read rain_24h from equipment computed data
  │    └─ If rain_24h > threshold → skip, log, set state, schedule next
  ├─ Check forecast condition (if useRainForecast)
  │    ├─ Find weather_forecast equipment (auto-detect)
  │    ├─ Read j1_rain_prob binding
  │    └─ If > 75 → skip, log, set state, schedule next
  ├─ Open all valves simultaneously
  │    └─ For each valve: executeOrder("state", { state: "ON", on_time: duration * 60 })
  ├─ Log: "Créneau 06:00 — Vanne Potager 15 min, Vanne Pelouse 10 min"
  ├─ Set state: status=watering, currentSlot=06:00
  ├─ Schedule completion timer (max duration)
  │    └─ On completion: set state status=idle, log "terminé"
  └─ Schedule next trigger (same slot tomorrow, or next slot today)
```

**`stop()`:**

- Clear all pending timers (trigger timers + completion timers)
- Set state status=idle
- Log "Recette arrêtée"

### State keys

| Key              | Type                                  | UI rendering            |
| ---------------- | ------------------------------------- | ----------------------- |
| `status`         | `"idle"` / `"watering"` / `"skipped"` | Zone page pill color    |
| `nextSlot`       | `"06:00"` / null                      | Pill text when idle     |
| `currentSlot`    | `"06:00"` / null                      | Pill text when watering |
| `lastSkipReason` | string / null                         | Pill text when skipped  |

### Restart recovery

On `createInstance()` (called at boot for persisted instances):

1. Read `status` from state
2. If `status === "watering"`: the on_time is device-side, valve will close itself. Reset to idle.
3. Compute next trigger time relative to now
4. Schedule timers

## Sowel core changes

### New slot type: `watering-schedule`

**`src/shared/types.ts`:**

Add `"watering-schedule"` to the `RecipeSlotDef.type` union:

```typescript
type: "zone" |
  "equipment" |
  "number" |
  "duration" |
  "time" |
  "boolean" |
  "text" |
  "data-key" |
  "watering-schedule";
```

**`ui/src/types.ts`:** Mirror the type change.

### New UI component: `WateringScheduleEditor`

**`ui/src/components/recipes/WateringScheduleEditor.tsx`** (NEW)

A self-contained component that renders the schedule editor from the mockup:

- List of slot cards, each with time picker + per-valve duration inputs
- "Add slot" button
- "Remove slot" button per card
- Valve names resolved from the selected valve equipment IDs
- Stores value as JSON array

Props:

```typescript
interface WateringScheduleEditorProps {
  value: string; // JSON-encoded schedule array
  onChange: (value: string) => void; // JSON-encoded string back
  valveIds: string[]; // Selected valve equipment IDs (from "valves" slot)
  equipments: EquipmentWithDetails[]; // All equipments (to resolve valve names)
}
```

### Integration in `ZoneRecipesSection.tsx`

In the slot rendering switch, add a case for `watering-schedule`:

```typescript
} else if (slot.type === "watering-schedule") {
  // Resolve valve IDs from the "valves" slot value
  const valveIds = (editParams["valves"] ?? "").split(",").filter(Boolean);
  return (
    <WateringScheduleEditor
      value={editParams[slot.id] ?? "[]"}
      onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
      valveIds={valveIds}
      equipments={equipments}
    />
  );
}
```

## Files changed

### Sowel core (this repo)

| File                                                         | Change                                          |
| ------------------------------------------------------------ | ----------------------------------------------- |
| `src/shared/types.ts`                                        | Add `"watering-schedule"` to RecipeSlotDef.type |
| `ui/src/types.ts`                                            | Mirror the type change                          |
| `ui/src/components/recipes/WateringScheduleEditor.tsx` (NEW) | Schedule editor component                       |
| `ui/src/components/recipes/ZoneRecipesSection.tsx`           | Add `watering-schedule` rendering case          |
| `plugins/registry.json`                                      | Add `auto-watering` recipe entry                |
| `specs/063-auto-watering-recipe/`                            | Spec files                                      |

### Recipe plugin (new repo)

| File                            | Content                                           |
| ------------------------------- | ------------------------------------------------- |
| `manifest.json`                 | Recipe manifest (id: auto-watering, type: recipe) |
| `package.json`                  | Dependencies, build script                        |
| `tsconfig.json`                 | TypeScript config                                 |
| `src/index.ts`                  | Recipe definition + logic                         |
| `.github/workflows/release.yml` | GitHub Actions release (same as other recipes)    |

## No changes needed

- No SQLite migration (recipe instances use existing `recipe_instances` + `recipe_state` tables)
- No new API endpoints (recipes use existing `/api/v1/recipes/*` routes)
- No new WebSocket events
- No new event bus events
- No new InfluxDB queries (rain_24h is read from equipment computed data, not InfluxDB directly)
