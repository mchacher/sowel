# Architecture — Spec 218

## Flow

```
UI menu (Maison bar / zone widget / button action)
  POST /zones/:id/orders/allHeatersMode { value: "eco" }
    EquipmentManager.executeZoneOrder(subtree, "allHeatersMode", "eco")
      for each enabled heater:
        resolveHeaterState(data, orders)          (spec 217)
        heaterModeOrder(state, orders, "eco")     (new, shared)
          pilot  → { alias of set_pilot_wire_mode, "eco" }  | null if not accepted
          relay  → { alias of the toggle, "ON" }            | null if not comfort/eco
        executeOrder(eq, alias, value)
```

## Shared contract (`src/shared/heater-contract.ts`)

```typescript
/** The order that puts one heater in `mode`, or null when it cannot (spec 218). */
export function heaterModeOrder(
  state: HeaterState,
  orders: readonly {
    alias: string;
    category?: string | null;
    enumValues?: readonly string[] | null;
  }[],
  mode: PilotWireMode,
): { alias: string; value: string } | null;

/** Modes offered for a set of heaters, and their common mode (spec 218). */
export function zoneHeaterModes(
  heaters: readonly { data: HeaterData[]; orders: HeaterOrder[] }[],
): { modes: PilotWireMode[]; common: PilotWireMode | null };
```

Relay toggle lookup: order category `toggle_power` or `light_toggle`, alias `state` as fallback;
values from `enumValues` matching `/^on$/i` / `/^off$/i`, else `"ON"` / `"OFF"`, exactly what
`RelayHeaterControl` sends today. A relay counts in `zoneHeaterModes` only with a toggle order; a
pilot heater only with a `set_pilot_wire_mode` order.

## Backend

`ZONE_ORDERS` gets `allHeatersMode: { types: ["heater"], orderCategory: "set_pilot_wire_mode",
value: "FROM_BODY", heaterMode: true }`. `executeZoneOrder` validates the value with
`isPilotWireMode` (400 otherwise) and, for a `heaterMode` entry, resolves each heater's order with
`heaterModeOrder` instead of the category filter. Skips are logged at debug.

No type, table, event or endpoint added. The UI `ZoneOrder` union gains `allHeatersMode`.

## Files changed

| Domain  | File                                                    | Change                                    |
| ------- | ------------------------------------------------------- | ----------------------------------------- |
| Shared  | `src/shared/heater-contract.ts`                         | `heaterModeOrder`, `zoneHeaterModes`      |
| Backend | `src/equipments/equipment-manager.ts`                   | `allHeatersMode` entry and dispatch       |
| UI      | `ui/src/lib/heater-contract.ts`                         | Re-export                                 |
| UI      | `ui/src/components/home/HeaterModeMenu.tsx` (new)       | Flame button + menu                       |
| UI      | `ui/src/components/home/ZoneCommands.tsx`               | Heaters group                             |
| UI      | `ui/src/pages/HomePage.tsx`                             | Subtree heater modes, order with value    |
| UI      | `ui/src/components/dashboard/ZoneWidget.tsx`            | Menu, common mode, on/off for thermostats |
| UI      | `ui/src/components/equipments/ButtonActionsSection.tsx` | Option and mode select                    |
| i18n    | `fr.json`, `en.json`                                    | Menu title, Mixed, button action label    |
