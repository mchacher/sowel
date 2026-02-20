# Implementation Plan: V0.5 UI Restructuring

## Dependencies

- Requires V0.3 (Equipments) to be completed — Done
- Uses existing zone tree API and equipment API
- Uses existing WebSocket event handlers

## Tasks

1. [ ] Create `SidebarZoneTree` component — compact treeview with expand/collapse and NavLink selection
2. [ ] Restructure `Sidebar.tsx` — two sections (Maison with zone tree, Settings with config links)
3. [ ] Create `CompactEquipmentCard` component — one-line card with icon, name, value, inline controls
4. [ ] Create `ZoneEquipmentsView` component — equipment list grouped by type for a given zone
5. [ ] Create `MaisonPage` — route handler loading zone and rendering equipment view
6. [ ] Update `App.tsx` — add `/maison` routes, change default redirect
7. [ ] Handle edge cases — empty zones, no zones, zone deleted while viewing
8. [ ] TypeScript compilation check (zero errors)
9. [ ] Run existing tests (all pass)

## Testing

- Manual verification:
  - Navigate sidebar treeview, expand/collapse zones
  - Click zone → see its equipments grouped by type
  - Toggle a light from the compact card → verify MQTT command sent
  - Adjust brightness slider → verify real-time update
  - Create a new zone in Settings > Home Topology → appears in sidebar treeview
  - Delete a zone → sidebar updates, redirect if viewing deleted zone
  - WebSocket disconnect/reconnect → equipment values recover
