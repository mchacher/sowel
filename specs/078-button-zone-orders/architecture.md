# Spec 078 — Architecture

## Data Model Changes

### Types (`src/shared/types.ts`)

Add `zone_order` to `ButtonEffectType`:

```typescript
export type ButtonEffectType =
  | "mode_activate"
  | "mode_toggle"
  | "equipment_order"
  | "recipe_toggle"
  | "zone_order";
```

### Config shape for `zone_order`

```typescript
// Stored in button_action_bindings.config (JSON)
{
  zoneId: string;       // Target zone ID
  orderKey: string;     // One of VALID_ZONE_ORDER_KEYS (e.g. "allLightsOn")
  value?: unknown;      // Only for parametric orders (brightness, setpoint)
}
```

### Database

No schema change. The existing `button_action_bindings` table stores `effect_type` as TEXT and `config` as JSON — both already flexible enough.

## Event Flow

```
Button equipment action value changes
  → ButtonActionManager.handleActionEvent()
    → Matches binding with effectType "zone_order"
      → zoneManager.getDescendantIds(zoneId)
      → equipmentManager.executeZoneOrder(zoneIds, orderKey, value)
```

Same flow as zone order API route, but triggered by button action instead of REST call.

## API Changes

### Validation update (`src/api/routes/button-actions.ts`)

Add `"zone_order"` to the allowed `effectType` values in POST/PUT validation.

No new endpoints — zone orders are executed internally by `ButtonActionManager`, not via a new API call.

## Files to Modify

### Backend

| File                                   | Change                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `src/shared/types.ts`                  | Add `"zone_order"` to `ButtonEffectType`                                |
| `src/buttons/button-action-manager.ts` | Add `zone_order` case in `executeEffect()` — calls `executeZoneOrder()` |
| `src/api/routes/button-actions.ts`     | Add `"zone_order"` to effectType validation                             |

### Frontend

| File                                                    | Change                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `ui/src/types.ts`                                       | Add `"zone_order"` to `ButtonEffectType`                         |
| `ui/src/components/equipments/ButtonActionsSection.tsx` | Zone-first selector for `equipment_order`, new `zone_order` form |

### Translations

| File                          | Change                                            |
| ----------------------------- | ------------------------------------------------- |
| `ui/src/i18n/locales/en.json` | Labels for zone_order effect type and group names |
| `ui/src/i18n/locales/fr.json` | Same in French                                    |

## UI Design

### `equipment_order` form (modified)

```
┌─ Zone ──────────────────────┐
│ [Dropdown: all zones]       │
└─────────────────────────────┘
┌─ Equipment ─────────────────┐
│ [Dropdown: zone equipments] │  ← filtered by selected zone
└─────────────────────────────┘
┌─ Order ─────────────────────┐
│ [existing order selector]   │
└─────────────────────────────┘
┌─ Value ─────────────────────┐
│ [existing value input]      │
└─────────────────────────────┘
```

### `zone_order` form (new)

```
┌─ Zone ──────────────────────┐
│ [Dropdown: all zones]       │
└─────────────────────────────┘
┌─ Group Action ──────────────┐
│ [Dropdown: zone order keys] │
│  Lights ON                  │
│  Lights OFF                 │
│  Lights Brightness          │
│  Shutters Open              │
│  Shutters Stop              │
│  Shutters Close             │
│  Thermostats Power ON       │
│  Thermostats Power OFF      │
│  Thermostats Setpoint       │
└─────────────────────────────┘
┌─ Value ─────────────────────┐  ← only for brightness/setpoint
│ [Number input]              │
└─────────────────────────────┘
```
