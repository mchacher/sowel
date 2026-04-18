# Spec 077 — Architecture

## Type Changes

### New type: OrderCategory

```typescript
export type OrderCategory =
  | "light_toggle"
  | "set_brightness"
  | "set_color_temp"
  | "set_color"
  | "shutter_move"
  | "set_shutter_position"
  | "toggle_power"
  | "set_setpoint"
  | "gate_trigger"
  | "valve_toggle"
  | "toggle_mute"
  | "set_input";
```

### Updated interfaces

- `DiscoveredDevice.orders[].category?: OrderCategory` — plugin provides during discovery
- `DeviceOrder.category?: OrderCategory` — stored in DB
- `OrderBindingWithDetails.category?: OrderCategory` — returned by equipment queries
- `OrderBindingJoinRow.category: string | null` — raw SQL row

## Database Migration

```sql
ALTER TABLE device_orders ADD COLUMN category TEXT;
```

Nullable — backward compatible with existing data.

## File Changes

### 1. `src/shared/types.ts`

- Add `OrderCategory` type
- Add `category?: OrderCategory` to `DeviceOrder` and `OrderBindingWithDetails`

### 2. `ui/src/types.ts`

- Mirror `OrderCategory` type and updated interfaces

### 3. `migrations/003_device_order_category.sql`

- ALTER TABLE device_orders ADD COLUMN category TEXT

### 4. `src/devices/device-manager.ts`

- Add `category?` to `DiscoveredDevice.orders`
- Update SQL INSERT/UPDATE statements to include category
- Handle null category for backward compat

### 5. `src/equipments/equipment-manager.ts`

- Update `OrderBindingJoinRow` — add `category: string | null`
- Update SQL queries to SELECT category from device_orders
- Update `rowToOrderBindingWithDetails` to include category
- Replace ZONE_ORDERS `category` field with `orderCategory` (uses OrderCategory, not DataCategory)
- Replace brute-force loop in `executeZoneOrder` with category-based lookup:

```typescript
const orderBinding = details.orderBindings.find((ob) => ob.category === mapping.orderCategory);
```

### 6. All plugins with orders

Each plugin adds `category` to its discovered orders:

**zigbee2mqtt** (z2m-parser.ts):

- Light state orders → `light_toggle`
- Light brightness → `set_brightness`
- Shutter state (OPEN/CLOSE/STOP) → `shutter_move`
- Shutter position (0-100) → `set_shutter_position`
- Color temp → `set_color_temp`

**lora2mqtt**:

- Light R1 (on/off) → `light_toggle`
- Gate R1 (latch) → `gate_trigger`

**legrand-control**:

- Light on → `light_toggle`
- Brightness → `set_brightness`
- Shutter target_position → `set_shutter_position`

**panasonic-cc**:

- Power → `toggle_power`
- Target temperature → `set_setpoint`
- Other orders (mode, fan, swing) → no category (null)

**mcz-maestro**:

- Power → `toggle_power`
- Target temperature → `set_setpoint`
- Other orders (profile, eco, alarm) → no category (null)

**smartthings**:

- Power → `toggle_power`
- Mute → `toggle_mute`
- Input source → `set_input`

## Events / API / WebSocket

No changes.
