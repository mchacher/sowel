# Architecture: Dashboard Widgets

## Data Model Changes

### New SQLite table: `dashboard_widgets`

```sql
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('equipment', 'zone')),
  label TEXT,
  icon TEXT,
  equipment_id TEXT,
  zone_id TEXT,
  family TEXT CHECK(family IN ('lights', 'shutters', 'heating', 'sensors')),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_id) REFERENCES equipments(id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);
```

- `type = 'equipment'`: `equipment_id` is set, `zone_id` and `family` are NULL
- `type = 'zone'`: `zone_id` and `family` are set, `equipment_id` is NULL
- `label`: custom name, NULL = auto-generated from equipment name or "Family - Zone"
- `icon`: Lucide icon name, NULL = default based on type/family
- `ON DELETE CASCADE`: widget auto-deleted when equipment/zone is removed

### New types in `src/shared/types.ts`

```typescript
export type WidgetFamily = "lights" | "shutters" | "heating" | "sensors";

export interface DashboardWidget {
  id: string;
  type: "equipment" | "zone";
  label?: string;
  icon?: string;
  equipmentId?: string;
  zoneId?: string;
  family?: WidgetFamily;
  displayOrder: number;
  createdAt: string;
}
```

### Family to EquipmentType mapping (constant)

```typescript
export const WIDGET_FAMILY_TYPES: Record<WidgetFamily, EquipmentType[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
};
```

## Event Bus Events

No new event bus events needed. The dashboard relies on existing events:

- `equipment.data.changed` -- real-time data updates
- `zone.data.changed` -- zone aggregation updates
- `equipment.created` / `equipment.updated` / `equipment.removed`
- `zone.created` / `zone.updated` / `zone.removed`

## API Changes

### New endpoints

| Method | Path                              | Auth  | Description                              |
| ------ | --------------------------------- | ----- | ---------------------------------------- |
| GET    | `/api/v1/dashboard/widgets`       | any   | List all widgets ordered by displayOrder |
| POST   | `/api/v1/dashboard/widgets`       | admin | Create a widget                          |
| PATCH  | `/api/v1/dashboard/widgets/:id`   | admin | Update label, icon                       |
| DELETE | `/api/v1/dashboard/widgets/:id`   | admin | Delete a widget                          |
| PUT    | `/api/v1/dashboard/widgets/order` | admin | Reorder widgets (batch update)           |

#### GET /api/v1/dashboard/widgets

Response:

```json
[
  {
    "id": "uuid",
    "type": "equipment",
    "label": null,
    "icon": null,
    "equipmentId": "uuid",
    "displayOrder": 0,
    "createdAt": "2026-03-08T..."
  },
  {
    "id": "uuid",
    "type": "zone",
    "label": "Volets RDC",
    "icon": "ArrowUpDown",
    "zoneId": "uuid",
    "family": "shutters",
    "displayOrder": 1,
    "createdAt": "2026-03-08T..."
  }
]
```

#### POST /api/v1/dashboard/widgets

Body (equipment widget):

```json
{
  "type": "equipment",
  "equipmentId": "uuid"
}
```

Body (zone widget):

```json
{
  "type": "zone",
  "zoneId": "uuid",
  "family": "shutters"
}
```

Response: 201 + created widget

#### PATCH /api/v1/dashboard/widgets/:id

Body:

```json
{
  "label": "My custom name",
  "icon": "Flame"
}
```

Response: 200 + updated widget

#### DELETE /api/v1/dashboard/widgets/:id

Response: 204

#### PUT /api/v1/dashboard/widgets/order

Body:

```json
{
  "order": ["widget-id-1", "widget-id-2", "widget-id-3"]
}
```

Response: 200

## WebSocket

No new WebSocket events. The dashboard page subscribes to existing topics (`equipments`, `zones`) which already push real-time data updates.

## UI Changes

### New files

| File                                              | Description                           |
| ------------------------------------------------- | ------------------------------------- |
| `ui/src/pages/DashboardPage.tsx`                  | Main dashboard page (default landing) |
| `ui/src/components/dashboard/EquipmentWidget.tsx` | Single equipment widget card          |
| `ui/src/components/dashboard/ZoneWidget.tsx`      | Zone family widget card               |
| `ui/src/components/dashboard/AddWidgetModal.tsx`  | Modal to add a new widget             |
| `ui/src/components/dashboard/WidgetGrid.tsx`      | Responsive grid + drag & drop         |
| `ui/src/components/dashboard/IconPicker.tsx`      | Curated icon selector (popover)       |
| `ui/src/components/dashboard/widget-icons.ts`     | Curated icon list + defaults          |
| `ui/src/store/useDashboard.ts`                    | Zustand store for widget config       |

### Modified files

| File                                   | Change                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `ui/src/App.tsx`                       | Add `/dashboard` route as default, redirect `/` to `/dashboard` |
| `ui/src/components/layout/Sidebar.tsx` | Add "Dashboard" nav item (first position)                       |
| `ui/src/api.ts`                        | Add dashboard API functions                                     |
| `ui/src/types.ts`                      | Add `DashboardWidget`, `WidgetFamily` types                     |
| `src/shared/types.ts`                  | Add `DashboardWidget`, `WidgetFamily` types                     |
| `src/shared/constants.ts`              | Add `WIDGET_FAMILY_TYPES` mapping                               |

### New backend files

| File                                   | Description          |
| -------------------------------------- | -------------------- |
| `src/api/routes/dashboard.ts`          | Dashboard API routes |
| `migrations/031_dashboard_widgets.sql` | SQLite migration     |

### Component Architecture

```
DashboardPage
├── Header (title + Edit/Done button)
├── WidgetGrid (@dnd-kit/sortable, responsive CSS grid)
│   ├── EquipmentWidget (reuses LightControl, ShutterControl, etc.)
│   │   ├── Icon (customizable) + Label (renamable)
│   │   └── Controls (same as CompactEquipmentCard)
│   ├── ZoneWidget (lists equipments of family in zone + children)
│   │   ├── Icon + Label
│   │   ├── Equipment list with states
│   │   └── Grouped action buttons (all on/off, open/close)
│   └── AddWidgetCard (visible in edit mode only)
├── AddWidgetModal
│   ├── Tab: Equipment picker (grouped by zone)
│   └── Tab: Zone + Family picker
└── IconPicker (popover with curated icon grid)
```

### Widget rendering strategy

The `EquipmentWidget` reuses existing control components (`LightControl`, `ShutterControl`, `ThermostatCard`, `GateControl`, `HeaterControl`, `SensorValues`) from `ui/src/components/equipments/`. This avoids duplicating control logic.

The `ZoneWidget` collects equipments from `useEquipments` store:

1. Get all descendant zone IDs (recursive from selected zone)
2. Filter equipments by zone IDs + family types (`WIDGET_FAMILY_TYPES[family]`)
3. Render equipment list with states
4. Add grouped action buttons using existing `executeZoneOrder` API

### Drag & drop

`@dnd-kit/core` + `@dnd-kit/sortable`:

- Touch-friendly (mobile drag works out of the box)
- Keyboard accessible
- Lightweight (~10KB gzipped)
- On drop: call `PUT /api/v1/dashboard/widgets/order` with new order

### Icon Picker

Small popover component showing the curated ~40 icons in a grid. Clicking an icon updates the widget via `PATCH`. The icon list is defined in `widget-icons.ts` as a simple array of Lucide icon names, grouped by category for display.
