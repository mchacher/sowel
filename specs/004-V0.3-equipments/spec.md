# V0.3: Equipments + Bindings + Orders

## Summary

Introduce the **Equipment** entity — the user-facing functional unit that bridges the physical Device layer and the spatial Zone layer. An Equipment binds to one or more Devices via **DataBindings** (read) and **OrderBindings** (write). The user creates, configures, and controls Equipments; Devices remain a technical layer.

V0.3 builds the **generic Equipment infrastructure** but focuses on **lighting** as the first supported type (on/off + dimmers).

## Reference

- Data model: `docs/data-model.md` — sections 5, 6, 7
- Spec: `docs/corbel-spec.md` — Equipment, Binding, Order concepts

## Acceptance Criteria

### Equipment CRUD
- [ ] User can create an Equipment (name, type, zoneId, groupId, description)
- [ ] User can list all Equipments
- [ ] User can get a single Equipment with its bindings and current data values
- [ ] User can update an Equipment (name, zoneId, groupId, description, enabled)
- [ ] User can delete an Equipment (cascades bindings)
- [ ] Equipment `type` is validated against the EquipmentType union

### DataBinding
- [ ] User can add a DataBinding to an Equipment (maps a DeviceData to an alias)
- [ ] User can remove a DataBinding from an Equipment
- [ ] DataBindings are returned with Equipment details (including current value from DeviceData)
- [ ] `UNIQUE(equipment_id, alias)` constraint enforced

### OrderBinding
- [ ] User can add an OrderBinding to an Equipment (maps a DeviceOrder to an alias)
- [ ] User can remove an OrderBinding from an Equipment
- [ ] OrderBindings are returned with Equipment details
- [ ] Multi-device dispatch: same alias can point to multiple DeviceOrders
- [ ] `UNIQUE(equipment_id, alias, device_order_id)` constraint enforced

### Order Execution
- [ ] User can execute an Equipment order via `POST /equipments/:id/orders/:alias`
- [ ] Order resolves all OrderBindings for that alias and publishes MQTT messages in parallel
- [ ] Order execution emits `equipment.order.executed` event
- [ ] Error handling: equipment not found, alias not found, MQTT not connected

### Reactive Pipeline (device.data.updated -> equipment)
- [ ] When a DeviceData changes (via MQTT), the Equipment Manager updates bound Equipment data
- [ ] `equipment.data.changed` event is emitted with equipmentId, alias, value, previous
- [ ] WebSocket broadcasts `equipment.data.changed` to connected UI clients

### Smart Device Filtering (UI)
- [ ] When creating a light Equipment, only devices with `light_state` DataCategory are shown
- [ ] Device filter is driven by a mapping: EquipmentType -> required DataCategories
- [ ] Devices are fetched with their data so the UI can filter client-side

### Multi-Device Aggregation (simple)
- [ ] When an Equipment has multiple DataBindings with the same alias from different devices:
  - Boolean values: OR aggregation (any ON = Equipment ON)
  - Number values: AVG aggregation (average brightness)
- [ ] This is simple auto-aggregation, not the full expression engine (deferred to V0.5)

### UI
- [ ] Equipments page: list all equipments grouped by zone
- [ ] Equipment detail page: show bindings, current data, execute orders
- [ ] Create Equipment form: select type, zone, group, then select compatible devices
- [ ] Quick toggle: turn light on/off from list view
- [ ] Brightness slider for dimmer type
- [ ] Nav sidebar: Equipments link enabled

## Scope

### In Scope
- Generic Equipment/DataBinding/OrderBinding infrastructure
- Equipment CRUD (API + UI)
- DataBinding and OrderBinding management
- Order execution (Equipment -> MQTT publish)
- Reactive data flow: device.data.updated -> equipment.data.changed
- Light-specific UI (on/off toggle, brightness slider)
- Smart device filtering by DataCategory
- Simple multi-device aggregation (OR for boolean, AVG for numbers)
- WebSocket events for equipment changes

### Out of Scope (deferred)
- Full expression engine for ComputedData (V0.5)
- Zone aggregation engine (V0.3+ / V0.4)
- Zone auto-orders (allLightsOff, etc.) (V0.3+)
- Other equipment types (shutters, sensors, thermostats) — infrastructure supports them, UI comes later
- InfluxDB history (V0.6)
- Scenario triggers on equipment data (V0.7)

## Edge Cases

- **Device goes offline**: Equipment keeps last known values. Status is informational only.
- **DeviceData deleted** (device re-discovered): DataBinding has `ON DELETE CASCADE` on device_data — binding is removed.
- **Equipment with no bindings**: Valid state. Shows "No bindings configured" in UI.
- **Execute order on disabled equipment**: Reject with 400 "Equipment is disabled".
- **Execute order with no matching alias**: Return 404 "Order alias not found".
- **MQTT not connected when executing order**: Return 503 "MQTT broker not connected".
- **Delete zone that has equipments**: Reject — zone delete guard must be extended to check for equipments.
- **Delete group that has equipments**: Equipment's groupId set to null (ON DELETE SET NULL).
