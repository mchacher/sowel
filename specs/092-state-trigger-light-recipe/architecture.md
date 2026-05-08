# Architecture — Spec 092

## Plugin shape

External recipe plugin packaged as `sowel-recipe-state-trigger-light`.
Mirrors the layout of `sowel-recipe-motion-light` (same RecipeContext
shape, same TS-only single-file plugin, same GitHub Actions release).

```
sowel-recipe-state-trigger-light/
├── src/index.ts            # plugin code (single file)
├── package.json
├── manifest.json
├── tsconfig.json
├── .gitignore
└── .github/workflows/release.yml
```

## Manifest

```json
{
  "id": "state-trigger-light",
  "type": "recipe",
  "name": "State-Triggered Light",
  "description": "Turn lights on for a fixed duration when a watched equipment's state changes to a configured value (e.g. gate → open at night).",
  "icon": "Bell",
  "repo": "mchacher/sowel-recipe-state-trigger-light",
  "author": "mchacher",
  "sowelVersion": ">=1.5.7"
}
```

`sowelVersion` is `>=1.5.7` because we rely on
`zoneAggregator.getByZoneId(rootZoneId).isDaylight` and on the existing
RecipeContext interface (no new APIs needed).

## Slot definitions

```ts
[
  { id: "zone", name: "Zone", type: "zone", required: true },
  {
    id: "trigger",
    name: "Trigger equipment",
    description: "Equipment whose state alias is watched",
    type: "equipment",
    required: true,
    // The DeviceSelector / equipment picker doesn't natively filter by
    // alias presence; the recipe form allows any equipment and we
    // validate at instance-create time that the equipment exposes a
    // `state` data binding. The picker UI may show a banner if not.
  },
  {
    id: "stateValue",
    name: "Target state value",
    description:
      "Recipe fires when the equipment's state changes to this value (e.g. 'open', 'ON', 'true')",
    type: "text",
    required: true,
  },
  {
    id: "lights",
    name: "Lights",
    type: "equipment",
    required: true,
    list: true,
    constraints: { equipmentType: "light_onoff" },
  },
  {
    id: "duration",
    name: "Duration",
    description: "How long the lights stay on after a trigger",
    type: "duration",
    required: true,
    defaultValue: "5m",
  },
  {
    id: "nightOnly",
    name: "Night only",
    description: "Only fire when it's dark outside (uses sunrise/sunset)",
    type: "boolean",
    required: false,
    defaultValue: true,
  },
];
```

## Event flow

```
equipment.data.changed (alias=state, equipmentId=trigger)
  → if value === stateValue && previous !== value:
      → if nightOnly && root.isDaylight === true: skip
      → if any light already ON: skip (manual override)
      → turnOnLights(lights)
      → schedule offTimer = duration ms
        → ctx.state.set("expiresAt", iso)

equipment.data.changed (alias=state on a light, value=OFF, while timer running)
  → external/manual off — cancelOffTimer + clear state

offTimer fires
  → turnOffLights(lights)
  → ctx.state.delete("expiresAt")
```

## State persistence

A single state key on the recipe instance: `expiresAt` (ISO 8601). On
`createInstance`:

1. Read `ctx.state.get("expiresAt")`.
2. If present and in the future: arm `offTimer` for the remaining
   duration. If lights are off (e.g. user turned them off while Sowel
   was down), don't re-light them — just clear state.
3. If present and in the past: fire the off action once
   (`turnOffLights`), clear state.

## Validate

- `zone` exists.
- `trigger` exists and exposes a `state` data binding (alias === "state").
- `stateValue` is non-empty trimmed string.
- `lights` is non-empty, all ids exist with type `light_onoff`.
- `trigger` ∉ `lights` (no self-watching).
- `duration` parses, is > 0.

## i18n

```ts
i18n: {
  fr: {
    name: "Lumière sur changement d'état",
    description: "Allume des lumières pour une durée fixe quand l'état d'un équipement change vers une valeur cible (ex: portail ouvert la nuit).",
    slots: {
      zone:        { name: "Zone", description: "Zone des lumières" },
      trigger:     { name: "Équipement déclencheur", description: "Équipement dont l'état est surveillé (alias 'state')" },
      stateValue:  { name: "Valeur cible", description: "La recette se déclenche quand l'état devient cette valeur (ex: 'open', 'ON')" },
      lights:      { name: "Lumières", description: "Lumières à allumer" },
      duration:    { name: "Durée", description: "Durée d'allumage après le déclenchement" },
      nightOnly:   { name: "Seulement la nuit", description: "Ne se déclenche que si le soleil est couché" },
    },
  },
}
```

## Files

| Action | File                                                             |
| ------ | ---------------------------------------------------------------- |
| add    | `sowel-recipe-state-trigger-light/src/index.ts`                  |
| add    | `sowel-recipe-state-trigger-light/package.json`                  |
| add    | `sowel-recipe-state-trigger-light/manifest.json`                 |
| add    | `sowel-recipe-state-trigger-light/tsconfig.json`                 |
| add    | `sowel-recipe-state-trigger-light/.gitignore`                    |
| add    | `sowel-recipe-state-trigger-light/.github/workflows/release.yml` |
| edit   | `Sowel/plugins/registry.json` — add the plugin entry             |

No changes to Sowel core.
