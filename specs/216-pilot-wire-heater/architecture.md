# Architecture — Spec 216

## Flow

```
module ─Zigbee─ Z2M  pilot_wire_mode: "comfort_-1"
                 │
   zigbee2mqtt plugin   translate, category pilot_wire_mode
                 │        "comfort_minus_1"
   Sowel device_data ── heater binding (alias pilot_wire_mode)
                 │
   resolveHeaterState() ── every heater surface
                 │  order: set_pilot_wire_mode = "eco"
   plugin executeOrder   translate back ── {"pilot_wire_mode":"eco"}
```

## Data model

Two category strings (TypeScript only), no migration. `heater-contract.ts` follows the spec 177/182
pattern: pure TypeScript in `src/shared/`, re-exported by `ui/src/lib/`.

```typescript
export const PILOT_WIRE_MODES = [
  "comfort",
  "comfort_minus_1",
  "comfort_minus_2",
  "eco",
  "frost_protection",
  "off",
] as const;
export type PilotWireMode = (typeof PILOT_WIRE_MODES)[number];

export type HeaterState =
  | { wiring: "relay"; mode: "comfort" | "eco"; modes: readonly ["comfort", "eco"] }
  | { wiring: "pilot"; mode: PilotWireMode | null; modes: readonly PilotWireMode[] };
```

Declared `enumValues` outside the vocabulary are not offered. With no `enumValues`, all six are.

`pilot_wire_mode` as alias, not `mode`: it is already the key, so a heater bound before the plugin
update needs no alias migration.

## Files changed — Sowel

| Domain  | File                                                                                                       | Change                                           |
| ------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Types   | `src/shared/types.ts`, `ui/src/types.ts`                                                                   | Two categories                                   |
| Shared  | `src/shared/heater-contract.ts` (new)                                                                      | Contract, resolver, binding selection            |
| Shared  | `src/shared/binding-candidates.ts`                                                                         | Heater candidate uses the selection              |
| Backend | `src/equipments/equipment-manager.ts`                                                                      | API auto-binding uses the selection              |
| UI      | `ui/src/lib/heater-contract.ts` (new)                                                                      | Re-export                                        |
| UI      | `bindingUtils.ts`, `equipment-type-meta.tsx`                                                               | Selection in the plan, alias, compatible devices |
| UI      | `HeaterControl.tsx`                                                                                        | Mode badge and selector                          |
| UI      | `equipment-running.ts`, `heaterMode.ts` (new)                                                              | Resolver                                         |
| UI      | `EquipmentWidget.tsx`, `MobileWidgetCard.tsx`, `WidgetDetailSheet.tsx`, `ZoneWidget.tsx`, `WidgetGrid.tsx` | Resolver, sheet on tap                           |
| i18n    | `fr.json`, `en.json`                                                                                       | Modes, category                                  |

`ui/src` imports from `src/shared`: check `docker build --target ui-build`, which copies files
explicitly.

## Files changed — sowel-plugin-zigbee2mqtt

| File                      | Change                                                          |
| ------------------------- | --------------------------------------------------------------- |
| `src/pilot-wire.ts` (new) | Value table, both directions                                    |
| `src/z2m-parser.ts`       | Categories, translated enum on discovery, translated payload    |
| `src/index.ts`            | Translate in `executeOrder`, only for the `pilot_wire_mode` key |
| `manifest.json`           | Minor version, `sowelVersion` = the release shipping the core   |

## Release order

Core release, then plugin release, then registry bump with its hash. The registry bump waits for
the check on a real module. No deployment is part of this spec.
