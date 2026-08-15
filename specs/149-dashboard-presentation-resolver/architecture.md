# Spec 149 — Architecture

## Overview

A new `presentation/` layer under `ui/src/components/dashboard/` owns the per-type derivation of icon, state and controls. Surfaces (desktop widget, mobile card, mobile tap action, and later the detail sheet) render the descriptor instead of re-deriving it.

```
resolveWidgetPresentation(widget, equipment, t)
        │  (pure — no hooks, no JSX for controls)
        ▼
WidgetPresentation ── consumed by ──┬─ EquipmentWidget (desktop)  → PresentationWidget shell
                                    ├─ useMobileState (mobile card) → { icon, stateLines }
                                    └─ getMobileClickAction (tap)   → direct toggle from `toggle` control
```

`null` return = type not migrated → caller falls back to its legacy per-type path. The resolver and legacy paths coexist until the last type is migrated (final phase deletes the legacy derivations).

## New files

```
ui/src/components/dashboard/presentation/
├── types.ts                        # WidgetPresentation, WidgetControl, IconCtx
├── resolveWidgetPresentation.ts    # dispatcher + per-type resolvers (switch, media_player, pool_pump)
├── resolve-helpers.ts              # shared binding lookups (findToggleBinding, isOnFromBinding, …)
├── resolveWidgetPresentation.test.ts
└── PresentationWidget.tsx          # desktop renderer for a descriptor (WidgetCard shell + controls)
```

## Descriptor types

```ts
export interface IconCtx {
  /** Surface hint: mobile icons are ~96px pre-scale, desktop ~64. */
  surface: "desktop" | "mobile-card" | "detail";
}

export type WidgetControl =
  | {
      kind: "toggle";
      alias: string; // order binding alias to execute
      on: boolean; // current state (drives button tint)
      onValue: unknown; // value to send to turn ON  (enum match or boolean true)
      offValue: unknown; // value to send to turn OFF
    }
  | {
      kind: "buttons";
      buttons: Array<{ label: string; alias: string; value: unknown }>;
    };
// "slider" kind reserved for later phases (light brightness, shutter position,
// thermostat setpoint) — designed here so the union is stable, added when the
// first consumer type migrates.

export interface WidgetPresentation {
  icon: (ctx: IconCtx) => ReactNode; // ctx-dependent size/stroke; respects widget.icon custom override
  isActive: boolean; // drives active tint on state pill / icon
  state: { primary: string; secondary?: string[] }; // "ON", "1.5 kWh"; secondary = extra lines
  controls: WidgetControl[];
  accent?: "success" | "warning" | null;
}
```

Design notes:

- **Controls are declarative.** The resolver owns _which_ control exists and the exact order alias/values (killing the 7-copy toggle-resolution drift); each surface owns only pixels (desktop 40px button, mobile direct tap, sheet full-width button later).
- **`onValue`/`offValue` are precomputed** in the resolver: category-first binding lookup (`findOrderByCategory(["light_toggle", "pool_pump_toggle", "toggle_power"], ["state"])` with plain-`find` fallback), enum values matched case-insensitively with `"ON"`/`"OFF"` fallback, boolean orders map to `true`/`false`. The surface just sends `on ? offValue : onValue`.
- **Pure function, not a hook.** `useEquipmentState` reaches into `useWebSocket` (battery alerts) so it cannot be called from a pure resolver. The three phase-1 types don't need store state. When the sensor type migrates, store-derived context will be passed in as an explicit argument (e.g. `resolveWidgetPresentation(widget, equipment, t, ctx)`), keeping the function pure.
- **`state.primary` is pre-localized** (the resolver receives `t`). Surfaces never re-translate.
- **Custom icons**: the resolver applies the `widget.icon → CUSTOM_ICON_REGISTRY` override internally, so no surface can forget it (#318).

## Per-type resolvers (phase 1)

| Type           | icon                 | isActive         | state.primary               | state.secondary                               | controls                                             |
| -------------- | -------------------- | ---------------- | --------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `switch`       | `PlugWidgetIcon(on)` | `light_state` ON | `"ON"/"OFF"`                | —                                             | `[toggle]`                                           |
| `media_player` | `Tv` tinted          | `power === true` | source name or `"ON"/"OFF"` | —                                             | `[toggle on power alias]` (boolean)                  |
| `pool_pump`    | `PoolPumpIcon(on)`   | `light_state` ON | `"ON"/"OFF"`                | `[formatRuntime(runtime_daily)]` when present | `[toggle]` (category-first incl. `pool_pump_toggle`) |

`formatRuntime` moves from `EquipmentWidget.tsx` into `resolve-helpers.ts` (shared).

## Surface changes

### Desktop — `EquipmentWidget.tsx`

At the top of the dispatcher:

```ts
const presentation = resolveWidgetPresentation(widget, equipment, t);
if (presentation) return <PresentationWidget label sublabel equipment presentation onExecuteOrder />;
// …legacy per-type branches unchanged for unmigrated types
```

`PresentationWidget` reproduces the existing switch-family layout exactly: `WidgetCard` shell → centered icon grid + state pill (+ secondary lines) → bottom control row (toggle button with `Power` icon + `Loader2` while executing, gated on `equipment.enabled`). `SwitchEquipmentWidget`, `MediaPlayerEquipmentWidget`, `PoolPumpEquipmentWidget` are **deleted**.

### Mobile card — `MobileWidgetCard.tsx`

At the top of `useMobileState`:

```ts
const presentation = resolveWidgetPresentation(widget, equipment, t);
if (presentation)
  return {
    icon: presentation.icon({ surface: "mobile-card" }),
    stateLines: [presentation.state.primary, ...(presentation.state.secondary ?? [])],
  };
// …legacy branches for unmigrated types
```

The `switch`, `media_player`, `pool_pump` branches are **deleted**.

### Mobile tap — `getMobileClickAction` (extracted to `mobile-click-action.ts`)

The function moves out of `WidgetGrid.tsx` into its own module (react-refresh
forbids non-component exports from component files, and it is now unit-tested).
For migrated types, the direct-tap toggle comes from the descriptor:

```ts
const presentation = resolveWidgetPresentation(widget, equipment, t);
const toggle = presentation?.controls.find((c) => c.kind === "toggle");
if (presentation && toggle)
  return () => {
    onExecuteOrder(equipment.id, toggle.alias, toggle.on ? toggle.offValue : toggle.onValue);
  };
if (presentation) return undefined; // migrated, no toggle → no tap action
```

Requires threading `widget` + `t` into `getMobileClickAction` (call site already has both). `switch` and `pool_pump` leave the legacy hand-rolled list; `light_onoff`, `water_heater`, `water_valve` stay on it until migrated.

### Point fix — desktop gate multi-action (`EquipmentWidget.tsx`)

`GateEquipmentWidget`: when `enumValues.length > 1`, render one bottom-row button per enum value (same `handleCommand(val)` semantics as `GateDetailContent`), and drop the card-level single-tap. Single-action gates unchanged. This is a legacy-path fix; the gate type migrates to the resolver in a later phase (its confirm-guard logic — spec 146 — makes it a poor first candidate).

### Point fix — string-boolean sensor normalization (`MobileWidgetCard.tsx`)

No new helper: the desktop `SensorValues` (#315's fix) routes by **category**, not by runtime type — `isBooleanSensorCategory(b.category)` → `formatBooleanSensor(category, value, t)`, which already understands string `"ON"`/`"OFF"` itself. The mobile sensor branch converges on the exact same predicate: a boolean-category value goes through the category-aware formatter whatever its runtime type, others keep `formatSensorValue`. Both surfaces now share one normalization authority.

## Data model / API / events

None. UI-only refactor; no backend, DB, or WebSocket change.

## Retro-compatibility contract

- Existing component tests (`EquipmentWidget.test.tsx` — 6 tests incl. switch toggle semantics, `MobileWidgetCard.test.tsx` — energy meter) must pass **unchanged**: they pin the visual/behavior contract across the migration.
- Enum toggle value semantics preserved exactly: enum match case-insensitive, fallback literal `"ON"`/`"OFF"`; boolean orders send `true`/`false` — except a boolean order aliased `state`, which keeps the historical ON/OFF string contract (from the legacy switch/light/water-heater handlers). Deliberate unifications, all converging on one semantic instead of per-type drift:
  - the desktop switch's toggle lookup becomes category-first (`light_toggle`/`toggle_power` before generic boolean), aligning it with the mobile tap path;
  - a **boolean pool-pump toggle aliased `state`** now sends `"ON"`/`"OFF"` strings like every other relay (the deleted desktop handler sent raw booleans for that one case, while the mobile tap already sent strings — the backend `resolveWireValue` coerces where the device declares wire values, and the pool-pump auto-binding path is enum-typed anyway);
  - the mobile tap on a **disabled** migrated equipment is now inert (previously it fired and the backend rejected with 400);
  - a **media_player that is ON without a source** shows `"ON"` on mobile (the legacy card showed `"OFF"` — a bug), and the custom widget icon override now applies on mobile too (#318 contract).
