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

## Zone Orders (backend)

New zone-level orders to add to `EquipmentManager.ZONE_ORDERS`:

```typescript
allThermostatsPowerOn: {
  types: ["thermostat"],
  alias: "power",
  value: true,
},
allThermostatsPowerOff: {
  types: ["thermostat"],
  alias: "power",
  value: false,
},
allThermostatsSetpoint: {
  types: ["thermostat"],
  alias: "setpoint",
  value: "FROM_BODY",  // receives numeric setpoint value from request body
},
```

These follow the same pattern as existing `allLightsOn/Off` and `allLightsBrightness` orders.

## ThermometerIcon Enhancement

The `ThermometerIcon` SVG component in `WidgetIcons.tsx` must be enhanced to accept a `level` prop (0–1) representing the mercury fill level inside the thermometer:

```typescript
export function ThermometerIcon({ warm, level }: { warm: boolean; level?: number });
```

- `level` maps the setpoint to a 0–1 range: `(setpoint - 16) / (30 - 16)`
- The mercury fill height is proportional to `level`
- When `level` is undefined (e.g. no thermostats), show empty thermometer

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

| File                                              | Description                                            |
| ------------------------------------------------- | ------------------------------------------------------ |
| `ui/src/pages/DashboardPage.tsx`                  | Main dashboard page (default landing)                  |
| `ui/src/components/dashboard/EquipmentWidget.tsx` | Single equipment widget card (per-type sub-components) |
| `ui/src/components/dashboard/ZoneWidget.tsx`      | Zone family widget card (per-family sub-components)    |
| `ui/src/components/dashboard/AddWidgetModal.tsx`  | Modal to add a new widget                              |
| `ui/src/components/dashboard/WidgetGrid.tsx`      | Responsive grid + drag & drop + edit mode overlays     |
| `ui/src/components/dashboard/IconPicker.tsx`      | Custom SVG icon selector (popover, type-filtered)      |
| `ui/src/components/dashboard/widget-icons.ts`     | Icon registry, Lucide map, defaults, categories        |
| `ui/src/components/dashboard/WidgetIcons.tsx`     | Custom SVG icon components (17 icons, state-driven)    |
| `ui/src/store/useDashboard.ts`                    | Zustand store for widget config                        |

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

The `EquipmentWidget` has per-type sub-components (`LightEquipmentWidget`, `ShutterEquipmentWidget`, `ThermostatEquipmentWidget`, etc.) each following the 4-zone layout pattern.

The `ZoneWidget` collects equipments from `useEquipments` store:

1. Get all descendant zone IDs (recursive from selected zone)
2. Filter equipments by zone IDs + family types (`WIDGET_FAMILY_TYPES[family]`)
3. Render aggregated values (avg temp, avg brightness, avg position, etc.)
4. Add grouped action buttons using existing `executeZoneOrder` API

#### Zone Heating Widget — Special Layout

Unlike other zone widgets that follow the standard vertical 4-zone layout, the zone heating widget uses a horizontal arrangement for zones 2+3:

- **Zone 2+3 (Picto + Info)**: Thermometer SVG on the left, current avg temperature on the right (side by side)
- The thermometer SVG mercury level represents the **setpoint** (not current temp)
- Below the picto row: setpoint value displayed between `−` and `+` buttons
- **Zone 4 (Bouton)**: Power on/off toggle at the bottom

The `ThermometerIcon` component receives a `level` prop (0–1) that drives the mercury height inside the SVG.

### Drag & drop

`@dnd-kit/core` + `@dnd-kit/sortable`:

- Touch-friendly (mobile drag works out of the box)
- Keyboard accessible
- Lightweight (~10KB gzipped)
- On drop: call `PUT /api/v1/dashboard/widgets/order` with new order

### Icon Picker

Popover component showing **custom SVG icons** from `CUSTOM_ICON_REGISTRY`, filtered by equipment type or widget family. Icons are rendered at `scale-[0.45]` inside 48×48 buttons. Clicking an icon updates the widget via `PATCH`. The registry is defined in `widget-icons.ts` with component references, preview props, and type filters.

The picker shows relevant icons first (matching the widget's equipment type), then remaining icons in a separate "Other icons" section.

### Custom SVG Icon System

Custom SVG icons are defined in `WidgetIcons.tsx` as React components with state-driven props:

| Component              | Props                                | Description                                              |
| ---------------------- | ------------------------------------ | -------------------------------------------------------- |
| `LightBulbIcon`        | `on: boolean`                        | Light bulb with glow effect when on                      |
| `ShutterWidgetIcon`    | `level: number (0-4)`                | Shutter with configurable slat level                     |
| `ThermometerIcon`      | `warm: boolean, level: number (0-1)` | Mercury thermometer with fill level                      |
| `MultiSensorIcon`      | `{}`                                 | Multi-sensor box with signal waves (default for sensors) |
| `HumiditySensorIcon`   | `{}`                                 | Water droplet with fill level                            |
| `LuminositySensorIcon` | `{}`                                 | Sun with radiating rays                                  |
| `WaterLeakSensorIcon`  | `{}`                                 | Droplet falling into puddle                              |
| `SmokeSensorIcon`      | `{}`                                 | Round detector with smoke cloud                          |
| `Co2SensorIcon`        | `{}`                                 | Cloud with CO₂ text                                      |
| `PressureSensorIcon`   | `{}`                                 | Barometer dial with needle                               |
| `GateWidgetIcon`       | `open: boolean`                      | Swing gate (battant)                                     |
| `SlidingGateIcon`      | `open: boolean`                      | Sliding gate (coulissant)                                |
| `GarageDoorIcon`       | `open: boolean`                      | Garage door (oscillo-battante)                           |
| `HeaterWidgetIcon`     | `comfort: boolean`                   | Radiator with heat waves                                 |
| `PlugWidgetIcon`       | `on: boolean`                        | Power plug with glow                                     |
| `MotionSensorIcon`     | `active: boolean`                    | Motion sensor with detection waves                       |
| `ContactSensorIcon`    | `open: boolean`                      | Door/window contact sensor                               |

All icons render at 96×96 with `viewBox="0 0 56 56"` and use `useId()` for unique gradient IDs.

### Widget Rename

Inline rename in edit mode:

- Transparent button overlay on title area triggers rename on click
- Input field appears with auto-focus and text selection
- Commit on blur/Enter via `updateWidget(id, { label })`, cancel on Escape
- Uses `useDashboard` store's `updateWidget` which calls `PATCH /api/v1/dashboard/widgets/:id`

### CSS Additions

`slider-slim` class in `ui/src/index.css` for thinner range inputs:

- Track height: 3px (vs default)
- Thumb size: 12×12px
- Used by dimmable light vertical sliders
