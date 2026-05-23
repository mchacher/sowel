# Architecture — Spec 115 — Awning equipment type

## Design decisions

### D1 — Reuse `shutter_*` categories instead of `awning_*`

The data emitted by the bridge / Z2M plugin / etc. is byte-for-byte identical (a 0-100 percentage, an Open / Close / Stop verb). Forking the category set would mean:

- Every plugin that already emits `shutter_position` would have to learn about `awning_position` to be useful.
- Auto-binding would need a heuristic to choose category at discovery time (today plugins don't know the user's intent).
- Recipes filtering by category would need to handle both.

By keeping a single category and splitting only at the equipment-type layer, we get the UX separation the user asked for with zero plugin churn. `pool_cover` does the opposite (it has dedicated `pool_cover_position` / `pool_cover_move`) but the rationale was different there: pool covers have very different binding rules (horizontal arrows, slow motors, distinct safety considerations) that justified the separation. For an awning vs a roller shutter, the only difference is vocabulary.

### D2 — New widget family `awnings`, not under `shutters`

Confirmed with the user. The motivation is that recipes / zone commands like `allShuttersOpen` should never touch awnings (an awning extends in the morning to shade the terrace, then retracts when the sun moves — opposite of a roller shutter's daily cycle). Putting awnings in their own family makes the zone widget grouping match the user's mental model and prevents accidental cross-family commands.

### D3 — Single shared `ShutterControl` with a typed branch, not a new `AwningControl`

The position slider + 3-button command surface is identical between shutters and awnings; only the labels and the optional state-pill text change. Forking the component would duplicate 200 lines of UI for 4 string swaps. Instead, `ShutterControl` already has a branch for `pool_cover` (changes the arrow icons); we add a parallel branch for `awning` (changes the labels).

Trade-off: the component name stays `ShutterControl` even though it now handles three equipment types. Acceptable — the file already serves `shutter` and `pool_cover`; renaming would churn imports without a real gain.

### D4 — Aggregation: position > 0 ⇒ "deployed", same threshold as shutter

`shuttersOpen` counts shutters whose position > 0. We mirror that exactly: `awningsDeployed` counts awnings whose position > 0. Threshold consistency simplifies the aggregator (single rule per category) and matches user expectation ("any amount of canvas out is deployed enough to count").

### D5 — Plugin scope is out of this spec

The companion plugin `sowel-plugin-somfy-rts` lives in its own repo. This spec is plugin-agnostic on purpose: any integration that emits `shutter_position` works. We document the somfy-rts plugin separately, in its own spec file inside that repo. Keeping the Sowel-side change small and orthogonal means a v1.12.x release can ship the awning type immediately, and the plugin can ship on its own cadence.

## Data model

### Types (`src/shared/types.ts`)

```ts
// EquipmentType union — add "awning"
export type EquipmentType =
  | "light_onoff"
  | "light_dimmable"
  | "light_color"
  | "shutter"
  | "awning"        // NEW
  | "switch"
  | ...;

// WidgetFamily union — add "awnings"
export type WidgetFamily = "lights" | "shutters" | "awnings" | "heating" | "sensors" | "water" | "pool";

// ZoneAggregatedData — add two counters
export interface ZoneAggregatedData {
  ...
  shuttersOpen: number;
  shuttersTotal: number;
  awningsDeployed: number;  // NEW
  awningsTotal: number;     // NEW
  ...
}
```

No new `DataCategory` or `OrderCategory` — we reuse `shutter_position`, `shutter_move`, `set_shutter_position`.

### Constants (`src/shared/constants.ts`)

```ts
// WIDGET_FAMILY_TYPES — add "awnings"
export const WIDGET_FAMILY_TYPES: Record<WidgetFamily, EquipmentType[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  awnings: ["awning"], // NEW
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
  water: ["water_valve"],
  pool: ["pool_pump", "pool_cover", "pool_heat_pump"],
};
```

### Database

**No migration required.** Equipment type is a free-form string column in `equipments`; the union is enforced at the TypeScript / `VALID_EQUIPMENT_TYPES` layer, not at the schema level (existing convention since spec 062).

## Backend changes

### `src/equipments/equipment-manager.ts`

1. Add `"awning"` to `VALID_EQUIPMENT_TYPES` (line 31-53).
2. Add three new entries to `ZONE_COMMANDS` (around line 839):

```ts
allAwningsExtend:  { types: ["awning"], orderCategory: "shutter_move", value: "CLOSE" },
allAwningsStop:    { types: ["awning"], orderCategory: "shutter_move", value: "STOP" },
allAwningsRetract: { types: ["awning"], orderCategory: "shutter_move", value: "OPEN" },
```

Mapping rationale: at the RF / Tasmota layer, "CLOSE" means "move toward position 100" (motor down). For an awning, position 100 = deployed. So `Extend ⇒ CLOSE`, `Retract ⇒ OPEN`. The bridge's `invert` flag (set per-remote on the somfyrts2mqtt side) has already swapped the raw RF bits where needed, so Sowel's view stays consistent.

### `src/zones/zone-aggregator.ts`

1. Add to the `ZoneAggregateAccumulator` interface: `awningsDeployed: number; awningsTotal: number;`.
2. Initialise both to 0 in the empty accumulator.
3. Sum both in the merge function.
4. Add a branch alongside the existing `case "shutter_position"`:

```ts
case "shutter_position": {
  // The same data category powers shutter + awning aggregation;
  // the equipment type decides which counter increments.
  if (equipment.type === "awning") {
    acc.awningsTotal += 1;
    if (typeof binding.value === "number" && binding.value > 0) {
      acc.awningsDeployed += 1;
    }
  } else {
    acc.shuttersTotal += 1;
    if (typeof binding.value === "number" && binding.value > 0) {
      acc.shuttersOpen += 1;
    }
  }
  break;
}
```

The `equipment` is already in scope at that point in the aggregator (the iteration walks `equipment.dataBindings`). If not, we resolve it from the zone manager — to verify against the actual code, see line ~562 of `zone-aggregator.ts`.

5. Update the `aggregatedDataEqual` comparison and the public projection to include the two new fields.

## Frontend changes

### `ui/src/shared/types.ts` (mirror of backend types)

Same additions as the backend `types.ts`. The UI imports the shared types via the published `shared/` re-export.

### `ui/src/components/icons/AwningIcon.tsx` (new)

Lucide-style SVG: a wall line + a slanted canopy with 3 fabric stripes + a support arm.

```tsx
// Approximate primitive layout (drawn left-to-right at 24×24):
// - Wall vertical line: (4,3) → (4,21)
// - Canopy outer edge: (4,7) → (20,16)  (slanted ~30° down)
// - Canopy fold line:  (4,11) → (15,18)
// - Stripe 1: (5,8) → (8,9.5)
// - Stripe 2: (8,11) → (12,13)
// - Stripe 3: (12,14) → (16,16)
// - Support arm: (4,11) → (16,16)
```

Props mirror `WaterValveIcon`: `size`, `strokeWidth`, `className`, `title`.

### `ui/src/components/equipments/IconPicker.tsx`

Register `awning` as a custom icon next to `water_valve` (existing entry).

### `ui/src/components/equipments/EquipmentForm.tsx`

Add `{ value: "awning", labelKey: "equipments.type.awning" }` to the type dropdown options.

### `ui/src/components/equipments/DeviceSelector.tsx`

Add `"awning"` to the local type predicate list — same logic as `shutter`, so the same devices show up (any device with `shutter_position` data).

### `ui/src/components/equipments/bindingUtils.ts`

```ts
// RELEVANT_DATA
RELEVANT_DATA["awning"] = ["shutter_position"];

// RELEVANT_ORDERS
RELEVANT_ORDERS["awning"] = ["position", "state", "target_position"];

// CANDIDATE_BASED_TYPES — add "awning"
const CANDIDATE_BASED_TYPES: ReadonlySet<EquipmentType> = new Set<EquipmentType>([
  "pool_pump",
  "pool_cover",
  "pool_heat_pump",
  "light_onoff",
  "light_dimmable",
  "light_color",
  "switch",
  "shutter",
  "awning", // NEW
  "water_valve",
]);
```

No new entry in `STANDARD_ALIASES` — the existing category aliases (`shutter_move` → `state`, `set_shutter_position` → `position`) work for any equipment type.

### `ui/src/components/equipments/binding-candidates.ts`

Add an `awning` case in `computeBindingCandidates` that mirrors `shutter` line-for-line — group orders by shutter index. Drop-in copy of the `case "shutter"` block.

### `ui/src/components/equipments/useEquipmentState.ts`

```ts
const isShutter = equipment.type === "shutter";
const isAwning = equipment.type === "awning"; // NEW
```

Export `isAwning` in the returned object.

### `ui/src/components/equipments/ShutterControl.tsx`

1. Read `isAwning = equipment.type === "awning"` once.
2. Replace the hard-coded `controls.open` / `controls.close` t-strings with conditional keys:
   ```ts
   const openLabel = isAwning
     ? "controls.retract"
     : isHorizontal
       ? "controls.open"
       : "controls.open";
   const closeLabel = isAwning
     ? "controls.extend"
     : isHorizontal
       ? "controls.close"
       : "controls.close";
   const openPillKey = isAwning ? "controls.retracted" : "controls.closed";
   const closePillKey = isAwning ? "controls.deployed" : "controls.opened";
   ```
   (Note: shutter pill maps `100 → opened` and `0 → closed`; awning maps `100 → deployed` and `0 → retracted`. Easier to read once we extract the pill labels too.)
3. The arrow direction stays vertical for `awning` (ChevronUp / ChevronDown). `pool_cover` keeps horizontal.

### `ui/src/components/dashboard/widget-icons.ts`

Register `awning` and `awnings` in the custom-icon registry pointing to `AwningIcon` (same way `shutter` and `shutters` map to `ShutterWidgetIcon`).

### `ui/src/components/dashboard/widget-utils.ts`

Add `"awning"` to the types list that the dashboard considers a "widget-friendly" type.

### `ui/src/components/dashboard/AddWidgetModal.tsx`

```ts
const FAMILIES: WidgetFamily[] = ["lights", "shutters", "awnings", "heating", "sensors"];
```

(Pool + water are already excluded from this list deliberately — they're added via a separate flow. Awnings join the main list since they're commonly placed on the dashboard.)

### `ui/src/components/dashboard/ZoneWidget.tsx`

1. Add `awnings: ["awning"]` to the family-types map (line 31).
2. Add a branch `if (family === "awnings") return <ZoneAwningWidget ... />` next to the existing `family === "shutters"` branch.
3. Implement `ZoneAwningWidget` as a copy of `ZoneShutterWidget` with:
   - Icon: `AwningIcon` instead of `ShutterWidgetIcon`.
   - Three buttons dispatch `allAwningsExtend` / `allAwningsStop` / `allAwningsRetract`.
   - Title `zones.commands.allAwnings*`.
   - Counts deployed (position > 0) instead of "open".

### `ui/src/components/dashboard/MobileWidgetCard.tsx`

Add `isAwning` branch alongside `isShutter` (line 106). The compact rendering uses the same slider but pulls labels from the awning i18n keys.

### `ui/src/components/dashboard/WidgetDetailSheet.tsx`

1. Line ~69 (`if (isShutter || equipment.type === "pool_cover")`) — extend to `|| isAwning`.
2. The `ShutterDetailContent` component already reads the equipment props; once it inherits the labels logic from `ShutterControl`, no extra change here.
3. Line ~267 — add `awnings: ["awning"]` to the zone-family map.
4. Line ~329-486 — add a `family === "awnings"` branch with a `ZoneAwningsDetail` mirroring `ZoneShuttersDetail`.

### `ui/src/components/dashboard/WidgetGrid.tsx`

1. Line ~405 — add `awnings: ["awning"]` to the family-types map.
2. Line ~459 — add a `family === "awnings"` branch that mirrors the `shutters` branch, swapping the icon and pill text.

## Event flow

No new events. The change is purely structural:

- A user creates an `awning` equipment in a zone, bound to a `shutter_position` data + `shutter_move` order from a device.
- The device emits `shutter_position = 60` → `device.data.updated` → `equipment-manager` re-evaluates → `equipment.data.changed` → `zone-aggregator` increments `awningsDeployed` for the zone → `zone.data.changed` → WebSocket pushes to UI → dashboard widget re-renders with the new count.

Identical to shutter, just routed through the awning counter.

## File-level impact summary

| File                                                | Change                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                               | Add `"awning"` to `EquipmentType`, `"awnings"` to `WidgetFamily`, `awningsDeployed` + `awningsTotal` to `ZoneAggregatedData` |
| `src/shared/constants.ts`                           | Add `awnings: ["awning"]` to `WIDGET_FAMILY_TYPES`                                                                           |
| `src/equipments/equipment-manager.ts`               | `VALID_EQUIPMENT_TYPES` + 3 new entries in `ZONE_COMMANDS`                                                                   |
| `src/equipments/equipment-manager.test.ts`          | New tests for awning create + zone commands                                                                                  |
| `src/equipments/binding-candidates.ts`              | New `case "awning"` mirroring shutter                                                                                        |
| `src/equipments/binding-candidates.test.ts`         | New test for awning candidate computation                                                                                    |
| `src/zones/zone-aggregator.ts`                      | Branch by equipment type in the `shutter_position` case + new fields                                                         |
| `src/zones/zone-aggregator.test.ts`                 | New test for awning aggregation isolation                                                                                    |
| `ui/src/components/icons/AwningIcon.tsx`            | New file                                                                                                                     |
| `ui/src/components/equipments/IconPicker.tsx`       | Register `awning` icon                                                                                                       |
| `ui/src/components/equipments/EquipmentForm.tsx`    | Add awning to type dropdown                                                                                                  |
| `ui/src/components/equipments/DeviceSelector.tsx`   | Add awning to the candidate-types list                                                                                       |
| `ui/src/components/equipments/bindingUtils.ts`      | Add `RELEVANT_DATA["awning"]`, `RELEVANT_ORDERS["awning"]`, awning in `CANDIDATE_BASED_TYPES`                                |
| `ui/src/components/equipments/bindingUtils.test.ts` | New test for awning auto-bind                                                                                                |
| `ui/src/components/equipments/useEquipmentState.ts` | Export `isAwning`                                                                                                            |
| `ui/src/components/equipments/ShutterControl.tsx`   | Awning label branch                                                                                                          |
| `ui/src/components/dashboard/widget-icons.ts`       | Register `awning` / `awnings` icons                                                                                          |
| `ui/src/components/dashboard/widget-utils.ts`       | Add `awning` to widget-friendly types                                                                                        |
| `ui/src/components/dashboard/AddWidgetModal.tsx`    | Add `awnings` to FAMILIES                                                                                                    |
| `ui/src/components/dashboard/ZoneWidget.tsx`        | New `ZoneAwningWidget` + family map entry                                                                                    |
| `ui/src/components/dashboard/MobileWidgetCard.tsx`  | Add `isAwning` branch                                                                                                        |
| `ui/src/components/dashboard/WidgetDetailSheet.tsx` | Extend isShutter check + add ZoneAwningsDetail + family map                                                                  |
| `ui/src/components/dashboard/WidgetGrid.tsx`        | Add `awnings` family handling                                                                                                |
| `ui/src/i18n/locales/en.json`                       | New strings (FR12)                                                                                                           |
| `ui/src/i18n/locales/fr.json`                       | New strings (FR12)                                                                                                           |

Estimated diff: ~300 lines added, ~5-10 lines modified in existing logic. No deletions.

## Backwards compatibility

- Existing `shutter` equipments are untouched.
- Existing `shutter_position` device data flows unchanged.
- Existing `allShuttersOpen/Stop/Close` zone commands are untouched (they keep filtering on `types: ["shutter"]`).
- Existing dashboard widgets stay rendered identically.

The change is strictly additive. Any user not creating an `awning` equipment sees zero behavioural difference.

---

## Plugin `sowel-plugin-somfy-rts` (work-stream B)

The plugin lives in a separate repo and follows the standard Sowel plugin layout (spec 053+). It is a thin adapter between the bridge's Tasmota-style MQTT contract and Sowel's `IntegrationPlugin` interface.

### Repo layout (new repo)

```
sowel-plugin-somfy-rts/
├── src/
│   ├── index.ts                 # createPlugin entry
│   ├── plugin.ts                # main IntegrationPlugin class
│   ├── mqtt-client.ts           # mqtt.js wrapper, reconnect logic
│   ├── sensor-parser.ts         # pure parsers for SENSOR / LWT / stat payloads
│   ├── sensor-parser.test.ts
│   ├── order-dispatcher.ts      # Sowel order → cmnd topic translation
│   ├── order-dispatcher.test.ts
│   ├── plugin.test.ts           # integration test with fake mqtt
│   └── types.ts                 # local types (SensorPayload, etc.)
├── manifest.json
├── package.json
├── tsconfig.json
├── tsup.config.ts               # bundles dist/index.js
├── vitest.config.ts
├── .eslintrc.cjs
├── .github/workflows/release.yml  # builds tarball + GH release on tag
├── README.md
└── LICENSE                      # GPL-3.0
```

### Plugin API surface (consumed)

From `@sowel/plugin-api` (the published types — already used by other plugins):

| Dep                  | Used for                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| `deps.settings`      | Read `mqtt.url`, `mqtt.username`, `mqtt.password`, `bridges.roots`          |
| `deps.deviceManager` | `upsertFromDiscovery`, `updateDeviceData`, `markOffline` (when LWT changes) |
| `deps.eventBus`      | Emit `system.integration.connected` / `system.integration.disconnected`     |
| `deps.logger`        | Module logger (pino-style)                                                  |

All operations are scoped per spec 111 — settings reads/writes are limited to `integration.somfy-rts.*`; device mutations carry our `integrationId`; only the two allowed `system.integration.*` event types are emitted. No special opt-out needed; the soft isolation is transparent.

### Device shape

Per remote, one device with:

```ts
{
  id: "somfy-rts:somfyrts2mqtt:kitchen",   // <plugin>:<root>:<name>
  name: "Kitchen",                         // = the remote name from the bridge
  manufacturer: "Somfy",
  model: "RTS (via somfyrts2mqtt)",
  integrationId: "somfy-rts",
  data: [
    { key: "shutter_position", category: "shutter_position", type: "number", value: 0, min: 0, max: 100 }
  ],
  orders: [
    { key: "shutter_move", category: "shutter_move", type: "enum", enumValues: ["OPEN","STOP","CLOSE"] },
    { key: "set_shutter_position", category: "set_shutter_position", type: "number", min: 0, max: 100 }
  ],
  status: "online"   // mirrors the bridge's LWT
}
```

### MQTT topic <-> device map

For root `somfyrts2mqtt`:

| Direction      | Topic                                | Payload                                                               |
| -------------- | ------------------------------------ | --------------------------------------------------------------------- |
| In (subscribe) | `tele/somfyrts2mqtt/SENSOR`          | `{ kitchen: { Position, Direction, Target }, bedroom: { ... }, ... }` |
| In (subscribe) | `tele/somfyrts2mqtt/LWT`             | `"Online"` / `"Offline"` (retained)                                   |
| In (subscribe) | `stat/somfyrts2mqtt/<name>`          | `{ Position, Direction, Target }` or `{ error: "..." }`               |
| Out (publish)  | `cmnd/somfyrts2mqtt/<name>/Open`     | `""`                                                                  |
| Out (publish)  | `cmnd/somfyrts2mqtt/<name>/Close`    | `""`                                                                  |
| Out (publish)  | `cmnd/somfyrts2mqtt/<name>/Stop`     | `""`                                                                  |
| Out (publish)  | `cmnd/somfyrts2mqtt/<name>/Position` | `"0"`..`"100"`                                                        |

### Lifecycle (`start` / `stop`)

`start()`:

1. Read settings (4 keys). Validate `mqtt.url` is a `mqtt://` or `mqtts://` URL.
2. Parse `bridges.roots` (comma-separated, trim, dedupe).
3. Create `mqtt.js` client with reconnect period 5 s, exponential backoff to 60 s.
4. On `connect`, subscribe to all 3 topic patterns × N roots in one `subscribe` call.
5. Emit `system.integration.connected`.
6. On `close` / `offline`, emit `system.integration.disconnected`. Mark all owned devices as offline.

`stop()`:

1. Publish nothing (no clean-shutdown LWT to set — that's the bridge's job).
2. `client.end(false)` (no wait).
3. Clear any pending timers.

### Threading / concurrency model

`mqtt.js` is single-threaded callback-driven; all parsers run in the Node event loop. We don't queue orders client-side — the `mqtt.js` library handles publish buffering during reconnects (configurable `clean: false` session + `queueQoSZero: true`).

### Settings UI

For v1, settings come from a simple JSON Schema in the manifest (declarative form, like `legrand-energy` and `weather-forecast`). No custom React component needed. Schema:

```json
{
  "settingsSchema": {
    "type": "object",
    "properties": {
      "mqtt.url": {
        "type": "string",
        "title": "MQTT broker URL",
        "default": "mqtt://localhost:1883"
      },
      "mqtt.username": { "type": "string", "title": "MQTT username" },
      "mqtt.password": { "type": "string", "title": "MQTT password", "secret": true },
      "bridges.roots": {
        "type": "string",
        "title": "Bridge root topics",
        "default": "somfyrts2mqtt",
        "description": "Comma-separated list. One root per bridge if multi-bridge setup."
      }
    },
    "required": ["mqtt.url", "bridges.roots"]
  }
}
```

The plugin reads settings via `deps.settings.get("mqtt.url")` etc. — the scoped proxy prepends `integration.somfy-rts.` automatically.

### Reference plugin choice

`sowel-plugin-tasmota` is the closest sibling: same broker model, same shutter category emission, same lifecycle. We mirror its file layout, its tsup config, its release workflow, and its test patterns.

### Plugin → registry coupling

The plugin can be installed manually (drop tarball into `plugins/`) without a registry entry. Adding it to `plugins/registry.json` makes it appear in Admin → Plugins → Marketplace. That registry update is a separate PR after the plugin's first GitHub release, per CLAUDE.md spec 089 — the SHA256 is computed against the released tarball.

### What ships in which release

| Sowel release | Plugin release                 | What works                                                                                                                                      |
| ------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1.12.0      | none                           | `awning` equipment type usable manually if user binds it to any `shutter_position` device (Z2M cover, Legrand, etc.). Plugin not yet available. |
| ≥ 1.12.0      | v1.0.0 + registry entry merged | Full end-to-end: install plugin → discover remotes → bind → control                                                                             |

The Sowel-core spec is the gating piece. Plugin can follow on its own cadence.
