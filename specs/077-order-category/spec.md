# Spec 077 — Order Categories

**Depends on**: spec 067 (apiVersion 2 deployed)

## Summary

Add a `category` field to device orders, mirroring the existing `category` on device data. Plugins declare the semantic role of each order during discovery. Zone orders use this category to find the right order binding on each equipment, eliminating alias guessing.

## Problem

Today, device orders have no semantic metadata. The zone order "allLightsOn" must guess which order binding to use (alias "state"? "on"? try all?). This is fragile and breaks across integrations.

Device DATA already has `category` (e.g., `light_state`, `shutter_position`). Device ORDERS should have the same, so the system knows: "this order controls the light state" vs "this order sets the brightness."

## Design

### Plugin discovery

Orders gain an optional `category` field:

```typescript
orders: [
  { key: "state", type: "enum", category: "light_state", enumValues: ["ON", "OFF"] },
  { key: "brightness", type: "number", category: "light_brightness", min: 0, max: 254 },
];
```

### Database

Add `category` column to `device_orders` table (nullable, for backward compat).

### Zone orders

Zone order finds the ORDER binding by category:

```typescript
const orderBinding = details.orderBindings.find((ob) => ob.category === mapping.category);
```

No more alias guessing, enum scanning, or brute-force trying.

### Automatic flow

```
Plugin discovery → device order with category
  → device_orders table (category stored)
  → equipment order binding (category inherited)
  → zone order finds by category
```

No user intervention — fully automatic.

## Categories for orders

| Equipment type | Order category     | Meaning                |
| -------------- | ------------------ | ---------------------- |
| light_onoff    | `light_state`      | Toggle on/off          |
| light_dimmable | `light_state`      | Toggle on/off          |
| light_dimmable | `light_brightness` | Set brightness level   |
| shutter        | `shutter_state`    | Open/close/stop        |
| shutter        | `shutter_position` | Set position 0-100     |
| thermostat     | `power`            | Power on/off           |
| thermostat     | `setpoint`         | Set target temperature |
| gate           | `gate_state`       | Latch/toggle gate      |
| water_valve    | `valve_state`      | Open/close valve       |
| media_player   | `power`            | Power on/off           |

Note: new category `shutter_state` needed (distinct from `shutter_position` which is numeric).

## Acceptance Criteria

- [ ] `category` field added to `DiscoveredDevice.orders`
- [ ] `category` column added to `device_orders` table (migration)
- [ ] `OrderBindingWithDetails` includes `category`
- [ ] Zone orders resolve by order category
- [ ] All plugins updated to declare order categories
- [ ] Zone orders work for lights, shutters, thermostats across all integrations
- [ ] Existing tests pass + new tests for category-based zone order dispatch

## Plugins to update

- zigbee2mqtt
- lora2mqtt
- legrand-control
- panasonic-cc
- mcz-maestro
- smartthings

## Out of scope

- Removal of dispatch_config (spec 074, separate)
- UI changes (order categories are backend only)
