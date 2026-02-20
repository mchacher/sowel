# Implementation Plan: V0.3 Equipments + Bindings + Orders

## Tasks

### Phase 1: Types & Migration
1. [ ] Add EquipmentType, Equipment, DataBinding, OrderBinding, EquipmentWithDetails, DataBindingWithValue, OrderBindingWithDetails to `src/shared/types.ts`
2. [ ] Add new EngineEvent variants (equipment.created/updated/removed, equipment.data.changed, equipment.order.executed)
3. [ ] Create migration `migrations/003_equipments.sql` (equipments, data_bindings, order_bindings)

### Phase 2: Equipment Manager (backend core)
4. [ ] Create `src/equipments/equipment-manager.ts` with:
   - Equipment CRUD (create, getById, getAll, getAllWithDetails, update, delete)
   - DataBinding management (addDataBinding, removeDataBinding)
   - OrderBinding management (addOrderBinding, removeOrderBinding)
   - `getEquipmentData()` — resolve bindings to current values with simple aggregation
   - Reactive handler: listen to `device.data.updated`, find affected bindings, emit `equipment.data.changed`
   - Order execution: resolve OrderBindings for alias, publish MQTT payloads in parallel
5. [ ] Update `src/zones/zone-manager.ts` — extend delete guard to check for equipments in zone

### Phase 3: API Routes
6. [ ] Create `src/api/routes/equipments.ts` with all endpoints
7. [ ] Update `src/api/server.ts` — add EquipmentManager to deps, register routes
8. [ ] Update `src/api/websocket.ts` — broadcast equipment.* events

### Phase 4: Wire up in index.ts
9. [ ] Update `src/index.ts` — instantiate EquipmentManager, register event handler for device.data.updated

### Phase 5: Frontend types & API
10. [ ] Update `ui/src/types.ts` — mirror new types + events
11. [ ] Update `ui/src/api.ts` — add equipment/binding/order API functions

### Phase 6: Frontend store
12. [ ] Create `ui/src/store/useEquipments.ts` — Zustand store for equipments
13. [ ] Update `ui/src/store/useWebSocket.ts` — handle equipment events

### Phase 7: Frontend components & pages
14. [ ] Create `ui/src/components/equipments/EquipmentCard.tsx` — card with icon, state, quick controls
15. [ ] Create `ui/src/components/equipments/LightControl.tsx` — toggle + brightness slider
16. [ ] Create `ui/src/components/equipments/DeviceSelector.tsx` — filtered device picker
17. [ ] Create `ui/src/components/equipments/EquipmentForm.tsx` — create/edit modal with binding wizard
18. [ ] Create `ui/src/pages/EquipmentsPage.tsx` — list equipments grouped by zone
19. [ ] Create `ui/src/pages/EquipmentDetailPage.tsx` — detail with bindings and controls
20. [ ] Update `ui/src/App.tsx` — add /equipments routes
21. [ ] Update `ui/src/components/layout/Sidebar.tsx` — enable Equipments link

### Phase 8: Tests
22. [ ] Create `src/equipments/equipment-manager.test.ts` — unit tests for CRUD, bindings, aggregation, order execution
23. [ ] TypeScript compilation: backend `npx tsc --noEmit` + frontend `cd ui && npx tsc --noEmit`
24. [ ] Run full test suite `npm test`

### Phase 9: Documentation
25. [ ] Update `docs/implementation-status.md` — mark V0.3 as complete
26. [ ] Mark spec acceptance criteria as completed

## Dependencies

- Requires V0.2 (Zones + Equipment Groups) to be completed — **DONE**
- Requires V0.1 (Devices) for DataBinding and OrderBinding targets — **DONE**

## Testing

### Automated
- Equipment CRUD: create, read, update, delete
- DataBinding: add, remove, unique constraint, cascade on equipment delete
- OrderBinding: add, remove, multi-device dispatch, cascade
- Reactive pipeline: mock device.data.updated -> verify equipment.data.changed emitted
- Aggregation: multiple bindings with same alias -> verify OR (boolean) and AVG (number)
- Order execution: mock MQTT publish, verify correct topic/payload
- Guards: delete zone with equipment must fail

### Manual (with real zigbee2mqtt)
- Create a light Equipment, bind to a real dimmer device
- Toggle light from UI -> verify MQTT message published
- Change brightness slider -> verify MQTT message
- Turn light on physically -> verify UI updates in real-time
- Multi-device: bind 2 lights to one Equipment, toggle -> both respond
