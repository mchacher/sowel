# Architecture: V0.5 UI Restructuring

## Data Model Changes

No backend data model changes. All changes are frontend-only.

## Event Bus Events

No new events. Consumes existing events:
- `zone.created`, `zone.updated`, `zone.removed` — to refresh sidebar treeview
- `equipment.data.changed` — to update equipment values in zone view
- `equipment.created`, `equipment.updated`, `equipment.removed` — to refresh zone view

## MQTT Topics

No changes.

## API Changes

No new endpoints. Uses existing:
- `GET /api/v1/zones` — load zone tree for sidebar
- `GET /api/v1/equipments` — load all equipments (filtered client-side by zoneId)
- `POST /api/v1/equipments/:id/orders/:alias` — execute equipment orders

## UI Changes

### New Components

| Component | Location | Description |
|-----------|----------|-------------|
| `SidebarZoneTree` | `ui/src/components/layout/SidebarZoneTree.tsx` | Compact zone treeview for the sidebar, with expand/collapse and selection state |
| `ZoneEquipmentsView` | `ui/src/components/maison/ZoneEquipmentsView.tsx` | Main panel: displays equipments for a zone, grouped by type |
| `CompactEquipmentCard` | `ui/src/components/maison/CompactEquipmentCard.tsx` | One-line card: icon + name + primary value + inline control (toggle/slider) |
| `MaisonPage` | `ui/src/pages/MaisonPage.tsx` | Route handler for `/maison/:zoneId`, loads zone + renders ZoneEquipmentsView |

### Modified Components

| Component | Changes |
|-----------|---------|
| `Sidebar.tsx` | Complete restructure: two sections (Maison with SidebarZoneTree, Settings with nav links). Remove Dashboard. Add Scenarios (disabled) to Settings. |
| `App.tsx` | Add `/maison/:zoneId` route. Change default redirect from `/devices` to `/maison`. |

### Store Changes

| Store | Changes |
|-------|---------|
| `useZones.ts` | Already has `tree` and `fetchZones()`. No changes needed — reuse existing store. |
| `useEquipments.ts` | Already has `equipments` and `fetchEquipments()`. Add a `getByZoneId(zoneId)` selector. No API changes. |

### Routing

| Route | Component | Description |
|-------|-----------|-------------|
| `/maison` | `MaisonPage` | Redirects to first zone or shows empty state |
| `/maison/:zoneId` | `MaisonPage` | Zone view with equipments |
| `/devices` | `DevicesPage` | Unchanged |
| `/devices/:id` | `DeviceDetailPage` | Unchanged |
| `/equipments` | `EquipmentsPage` | Unchanged |
| `/equipments/:id` | `EquipmentDetailPage` | Unchanged |
| `/zones` | `ZonesPage` | Unchanged (Home Topology config) |
| `/zones/:id` | `ZoneDetailPage` | Unchanged |
| `*` | Redirect to `/maison` | Default route |

### Equipment Type Grouping

Group equipments by these categories for display:

| Group Label | Equipment Types |
|-------------|----------------|
| Eclairages | `light_onoff`, `light_dimmable`, `light_color` |
| Volets | `shutter` |
| Capteurs | `sensor`, `motion_sensor`, `contact_sensor` |
| Climat | `thermostat` |
| Securite | `lock`, `alarm` |
| Multimedia | `media_player`, `camera` |
| Autres | `switch`, `generic` |

### Compact Equipment Card Design

```
┌─────────────────────────────────────────────────┐
│ 💡  Spots Salon          ON    [━━━━━●━] 70%   │
└─────────────────────────────────────────────────┘
```

Single row layout:
- Left: type icon (from existing TYPE_ICONS)
- Name: equipment name, truncated if needed
- Value: primary data value (state badge for booleans, number+unit for numeric)
- Control: inline toggle for on/off, compact slider for dimmable

## File Changes

| File | Change |
|------|--------|
| `ui/src/components/layout/Sidebar.tsx` | Restructure into Maison + Settings sections |
| `ui/src/components/layout/SidebarZoneTree.tsx` | New: compact zone treeview for sidebar |
| `ui/src/components/maison/ZoneEquipmentsView.tsx` | New: zone equipment grid grouped by type |
| `ui/src/components/maison/CompactEquipmentCard.tsx` | New: one-line equipment card with controls |
| `ui/src/pages/MaisonPage.tsx` | New: route handler for /maison/:zoneId |
| `ui/src/App.tsx` | Add maison routes, change default redirect |
