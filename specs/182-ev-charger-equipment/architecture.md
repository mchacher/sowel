# Spec 182 — Architecture

No SQLite migration, no new event, no new API route: `ev_charger` is a new value of `EquipmentType`, the four categories are new values of `DataCategory` / `OrderCategory`, and all plumbing (bindings, orders, WebSocket, zones, metering, arbiter) is already type-agnostic. The work is the contract, the binding rules that honour it, and the surfaces that render it.

## The contract module

`src/shared/ev-charger-contract.ts` — pure TypeScript, no backend dependency, bundled by the UI directly (the spec 150 / 177 pattern):

```ts
export const EV_VEHICLE_STATE_VALUES = ["disconnected", "connected", "charging"] as const;
export type EvVehicleState = (typeof EV_VEHICLE_STATE_VALUES)[number];

export const EV_CHARGER_ALIASES = {
  state: "state",
  vehicle: "vehicle",
  power: "power",
  energy: "energy",
  chargeCurrent: "charge_current",
  sessionEnergy: "session_energy",
  current: "current",
  voltage: "voltage",
  /** Not core: the charger's own temperature, kept out of the zone average. */
  temperature: "charger_temperature",
} as const;

export interface EvChargerCoreEntry {
  alias: string;
  data: boolean;
  order: boolean;
}
export const EV_CHARGER_CORE: readonly EvChargerCoreEntry[]; // the spec's table
export const EV_CHARGER_CATEGORY_ALIASES: Readonly<Record<string, string>>; // category → alias
export const EV_CHARGER_IDENTITY_DATA_CATEGORY = "ev_vehicle_state";
export const EV_CHARGER_IDENTITY_ORDER_CATEGORY = "set_ev_charge_current";
export function isEvChargerDevice(data, orders): boolean;
export function isEvVehicleState(value: unknown): value is EvVehicleState;
export function splitEvChargerExtras(dataBindings, orderBindings): { extraData; extraOrders };
/** IEC 61851 floor and the common single-phase ceiling, for an order without min/max. */
export const EV_CHARGE_CURRENT_FALLBACK = { min: 6, max: 32 } as const;
```

`EV_CHARGER_CATEGORY_ALIASES` is the category → alias map the UI binding code uses for this type (`appliance_state`/`light_state` → `state`, `toggle_power`/`light_toggle` → `state`, `ev_vehicle_state` → `vehicle`, `power` → `power`, `energy` → `energy`, `ev_charge_current`/`set_ev_charge_current` → `charge_current`, `ev_session_energy` → `session_energy`, `current` → `current`, `voltage` → `voltage`, `temperature`/`temperature_device` → `charger_temperature`). Data and order categories are disjoint namespaces, so one map serves both, as `TYPE_CATEGORY_ALIASES` already assumes.

## Types and constants

| File                                                   | Change                                                                                                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                                  | `EquipmentType` += `ev_charger`; `DataCategory` += `ev_vehicle_state`, `ev_charge_current`, `ev_session_energy`; `OrderCategory` += `set_ev_charge_current`                                                                 |
| `ui/src/types.ts`                                      | Same four unions, hand-kept mirror                                                                                                                                                                                          |
| `src/shared/constants.ts`                              | `CATEGORY_EXPECTED_TYPE` (`ev_vehicle_state` enum, the two others number); `WIDGET_FAMILY_TYPES.power` += `ev_charger`; `defaultEnergyClassFor` → `deferrable`; `defaultEnergyTimingsFor` → `{ minOnS: 600, minOffS: 300 }` |
| `ui/src/lib/energy-profile.ts`                         | The duplicated pair, kept in sync (the copy the form uses — without it the energy panel cannot be enabled)                                                                                                                  |
| `src/equipments/equipment-manager.ts`                  | `VALID_EQUIPMENT_TYPES` += `ev_charger` (the API gate)                                                                                                                                                                      |
| `src/equipments/metering.ts`, `ui/src/lib/metering.ts` | `METERING_RELAY_TYPES` += `ev_charger` (live power on cards, submeter ranking). `NON_SUBMETER_TYPES` and `METERING_EQUIPMENT_TYPES` untouched: a charger is a load, not a meter                                             |

Not added to `STREAMING_CATEGORIES`: `power`, `energy`, `current`, `voltage` already are; the three new categories change on events, not on a stream, so they keep the default freshness window.

## Binding

- **Backend `binding-candidates.ts`**: no case for `ev_charger` — the `default` branch returns the single "all data / all orders" candidate, which is right for a charger (one device, one charger). Not in `CANDIDATE_BASED_TYPES`.
- **UI `bindingUtils.ts`**:
  - `RELEVANT_DATA.ev_charger` = the contract's data categories plus `temperature`, `temperature_device` and `generic`, so the extras (status, last session) bind too.
  - `RELEVANT_ORDER_CATEGORIES.ev_charger` = `toggle_power`, `light_toggle`, `set_ev_charge_current`; `RELEVANT_ORDERS.ev_charger` = `["state"]` as the key fallback for a plain relay.
  - `TYPE_CATEGORY_ALIASES.ev_charger` = `EV_CHARGER_CATEGORY_ALIASES` (imported, not restated).
- **Device picker**: `DeviceSelector` filters with `isEvChargerDevice` (data OR order identity, like `isThermostatDevice`); `EQUIPMENT_TYPE_CATEGORIES.ev_charger` lists the contract data categories for the other readers of that map.

## Arbiter

No code change. `isPowerAlias` finds the `power`-category binding; `isStateAlias` finds the `appliance_state` (or `light_state`, or alias `state`) binding. Both are what the contract binds. The class and timings come from `defaultEnergyClassFor` / `defaultEnergyTimingsFor`.

## UI

| Surface           | File                                                            | Change                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type meta         | `components/equipments/equipment-type-meta.tsx`                 | `TYPE_ICONS.ev_charger` (Lucide `EvCharger`), `TYPE_LABELS`, `EQUIPMENT_TYPE_CATEGORIES`                                                                                              |
| Type picker       | `components/equipments/EquipmentForm.tsx`                       | Entry after `water_heater`                                                                                                                                                            |
| Shared read model | `components/equipments/evChargerState.ts` (new)                 | `evChargerStateOf(equipment)`: on, vehicle, power (via `resolvePowerReading`), session energy, setpoint, setpoint order with its bounds — one reader for every surface                |
| Control           | `components/equipments/EvChargerControl.tsx` (new)              | Start/stop (`LightControl`), vehicle badge, power, session energy, current stepper (`set_ev_charge_current`), measured current/voltage — used by the detail page and the mobile sheet |
| Detail page       | `pages/EquipmentDetailPage.tsx`                                 | Controls block rendering `EvChargerControl` when `type === "ev_charger"`                                                                                                              |
| Zone card         | `components/home/CompactEquipmentCard.tsx`                      | `TYPE_TINTS`, `isEvCharger` in `isKnownType`, `CompactEvCharger` row: badge + power + toggle                                                                                          |
| Zone grouping     | `components/home/ZoneEquipmentsView.tsx`                        | `ev_charger` in the "power" group                                                                                                                                                     |
| Desktop widget    | `components/dashboard/EquipmentWidget.tsx`                      | `EvChargerEquipmentWidget`: icon, badge, power, session energy and an explicit start/stop toggle; no tap-to-toggle on the tile                                                        |
| Mobile widget     | `components/dashboard/MobileWidgetCard.tsx`                     | State lines: badge text, power when charging                                                                                                                                          |
| Mobile tap        | `components/dashboard/widget-utils.ts`, `WidgetDetailSheet.tsx` | `needsDetailSheet` += `ev_charger`; the sheet renders `EvChargerControl`                                                                                                              |
| Widget icon       | `components/dashboard/widget-icons.ts`                          | `EvCharger` registered in `ICON_MAP` and the picker; `EQUIPMENT_DEFAULT_ICONS.ev_charger`                                                                                             |
| i18n              | `i18n/locales/{en,fr}.json`                                     | `equipments.type.ev_charger`, `equipments.evCharger.*` (vehicle states, session, current), `category.*` for the four categories                                                       |

The badge colours follow the existing pills: `charging` → accent (energy flowing), `connected` → primary, `disconnected` → neutral.

## Documentation

| Page                                                              | Change                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `docs/user/equipments.md`, `.fr.md`                               | EV charger section: what it is, the contract table, the plugin that provides it |
| `docs/technical/data-model/equipments.md` (+ `.fr.md` if present) | Type in the union list; the four categories                                     |
| `docs/user/energy.md`, `.fr.md`                                   | `ev_charger` in the flexible-load types                                         |
| `docs/specs-index.md`, `.fr.md`                                   | Row 182                                                                         |

## Data flow (unchanged pipeline)

```
tuya plugin (v0.2.0 publishes the contract categories)
  → device.data.updated (vehicle, power, energy, charge_current, session_energy…)
    → equipment ev_charger, bindings resolved to contract aliases
      → equipment.data.changed → zone power sum (submeter), history (energy deltas)
      → capacity arbiter: live draw = `power`, on/off = `state`
      → UI: CompactEvCharger / widgets / EvChargerControl
UI start/stop → order `state` (toggle_power) → dispatcher maps ON/OFF to the device's valueOn/valueOff → plugin
UI stepper    → order `charge_current` (set_ev_charge_current) → plugin
```
