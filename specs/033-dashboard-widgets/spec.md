# Dashboard Widgets

## Summary

Add a configurable dashboard page as the **default home page** with a grid of widgets that displays equipment data and zone-grouped controls. The dashboard is designed mobile-first and responsive up to desktop. It serves as the foundation for a future PWA (Progressive Web App) that will provide a native-like mobile experience.

The feature is split into **two milestones**:

- **Milestone A — Dashboard Widgets** (this spec): new page, widget system, grid layout, config API, responsive design
- **Milestone B — PWA & Mobile Login** (separate spec, depends on A): manifest.json, service worker, QR code login, offline shell

## Reference

- sowel-spec.md §15 (Design System)
- sowel-webapp-v0.1.md §5 (PWA)

## Acceptance Criteria

### Milestone A — Dashboard Widgets

- [x] New `/dashboard` page as the **default landing page** (same level as Maison, Modes, Analyse, Administration in sidebar)
- [x] Grid of uniform-size widget cards, responsive: 2 columns on mobile, 3 on tablet, 4 on desktop
- [x] Two widget types:
  - **Equipment widget**: displays one equipment's primary data + inline controls (toggle, slider, open/close)
  - **Zone widget**: displays all equipments of a **family** within a zone (including child zones), with grouped controls
- [x] Widget configuration stored in SQLite (global, shared by all users)
- [x] Admin can add, remove, and reorder widgets
- [x] Reorder via drag & drop (`@dnd-kit/sortable`, touch-friendly)
- [x] Widgets update in real-time via existing WebSocket events
- [x] Each widget shows appropriate controls based on equipment type
- [x] Widgets have auto-generated labels, renamable by admin (inline rename in edit mode)
- [x] Customizable widget icon from a curated icon picker with **custom SVG icons** (stateful, animated)
- [x] Empty state when no widgets are configured
- [x] Fixed-height cards (`h-[240px]`) with horizontal layout: icon centered, state/controls on right
- [x] Custom SVG icons at 96×96 rendered size with state-driven appearance (e.g., light on/off, shutter level, thermometer mercury)
- [x] Shutter widgets show "Ouvert"/"Fermé" labels at 0%/100% instead of percentage
- [x] Thermostat widgets: power button next to temperature, setpoint −/+ controls in bottom zone
- [x] Dimmable light widgets: vertical slim slider

### Milestone B — PWA & Mobile Login (separate spec)

- [ ] `manifest.json` with app name, icons, theme color, `display: standalone`
- [ ] Service Worker via `vite-plugin-pwa` (Workbox): cache-first for assets, network-first for API
- [ ] QR code login: admin generates a QR code on desktop containing an API token, mobile scans to authenticate
- [ ] "Add to Home Screen" prompt/banner
- [ ] Offline shell: cached UI loads immediately, shows "offline" banner when API is unreachable

## Scope

### In Scope (Milestone A)

- Dashboard page as default home page
- Equipment widget type (single equipment)
- Zone widget type (equipment family within a zone + child zones)
- Widget CRUD API (add, remove, reorder, rename)
- Edit mode toggle for admin users
- Responsive grid layout (mobile -> desktop)
- Real-time updates via WebSocket
- Drag & drop reordering (`@dnd-kit`)
- SQLite migration for widget config table

### Out of Scope (deferred to Milestone B or later)

- PWA manifest, service worker, offline support
- QR code login
- Push notifications
- Widget resize (all widgets same size)
- Custom widget sizes (1x1, 2x1, 2x2)
- Per-user dashboard configuration (global config for now)
- Chart/sparkline widgets
- Weather widgets
- Mode toggle widgets

## Widget Types

### Equipment Widget

Displays a single equipment with its primary data and inline controls.

| Equipment Type   | Display                                 | Controls                   |
| ---------------- | --------------------------------------- | -------------------------- |
| `light_onoff`    | Name, ON/OFF state                      | Toggle switch              |
| `light_dimmable` | Name, brightness %                      | Toggle + brightness slider |
| `light_color`    | Name, brightness %                      | Toggle + brightness slider |
| `shutter`        | Name, position %                        | Open/Close/Stop buttons    |
| `sensor`         | Name, sensor values (temp, humidity...) | -- (read only)             |
| `thermostat`     | Name, current temp, setpoint            | Setpoint +/-               |
| `gate`           | Name, open/closed state                 | Open/Close button          |
| `heater`         | Name, mode, power                       | Mode selector              |
| `switch`         | Name, ON/OFF state                      | Toggle switch              |
| `button`         | Name, last action                       | -- (read only)             |

Auto-generated label: equipment name (e.g., "Spots Salon"). Renamable.

### Zone Widget

Displays all equipments of a **family** within a zone (including child zones recursively), with grouped controls.

#### Equipment Families

| Family     | Equipment Types included                       | Grouped controls                  |
| ---------- | ---------------------------------------------- | --------------------------------- |
| `lights`   | `light_onoff`, `light_dimmable`, `light_color` | All on / All off                  |
| `shutters` | `shutter`                                      | All open / All close              |
| `heating`  | `thermostat`, `heater`                         | Setpoint +/-, All power on/off    |
| `sensors`  | `sensor`                                       | -- (read only, aggregated values) |

The zone widget shows:

- Auto-generated label: "Family - Zone" (e.g., "Volets - RDC"). Renamable.
- List of equipment names with their current state
- Grouped action buttons where applicable (all on/off, all open/close)

Examples:

- "Volets - RDC" -> all `shutter` equipments in zone "RDC" and its children (Salon, Cuisine, Entree), with "Open all" / "Close all"
- "Lumieres - Salon" -> all `light_*` equipments in zone "Salon", with "All on" / "All off"
- "Chauffage - Maison" -> all `thermostat`/`heater` in zone "Maison", with setpoint +/- and power on/off

### Zone Heating Widget — Detailed Layout

The zone heating widget uses a special layout where the thermometer icon is interactive:

```
┌────────────────────────┐
│    Chauffage - Maison  │  ← Zone 1: Titre (centered)
│                        │
│    ┌──────┐            │
│    │ ⊙    │  21.0 °C   │  ← Zone 2+3: Picto + Info side by side
│    │ ████ │            │     Thermometer SVG with mercury level = setpoint
│    │ ████ │            │     Current avg temperature displayed to the right
│    │ ████ │            │
│    └──────┘            │
│     - 20.5 +           │  ← Setpoint value with +/- buttons (step 0.5°C)
│                        │
│       ⏻                │  ← Zone 4: Power toggle button
└────────────────────────┘
```

**Thermometer as setpoint indicator:**

- The mercury level inside the thermometer SVG represents the **setpoint** (consigne), not the current temperature
- Mercury height is proportional to setpoint within the range 16–30°C
- When setpoint is low (16°C), mercury is at the bottom; at 30°C, mercury fills the thermometer
- The thermometer color reflects the power state: warm (red/orange) when ON, cold (blue/grey) when OFF

**Current temperature:**

- Displayed to the **right** of the thermometer icon (not below)
- Shows the average temperature across all thermostats in the zone
- Format: `21.0 °C` (1 decimal, monospace font)

**Setpoint controls:**

- Display the average setpoint across all thermostats in the zone
- Buttons `−` and `+` adjust all thermostats' setpoint by 0.5°C
- Limits: 16°C min, 30°C max
- Uses zone order `allThermostatsSetpoint` with `FROM_BODY` value

**Power button:**

- Toggle all thermostats ON/OFF in the zone
- Uses zone orders `allThermostatsPowerOn` / `allThermostatsPowerOff`

## Configuration Model

```typescript
type WidgetFamily = "lights" | "shutters" | "heating" | "sensors";

interface DashboardWidget {
  id: string; // UUID
  type: "equipment" | "zone";
  label?: string; // Custom name (auto-generated if null)
  icon?: string; // Lucide icon name (auto-assigned if null, customizable)
  // For type "equipment":
  equipmentId?: string;
  // For type "zone":
  zoneId?: string;
  family?: WidgetFamily; // Which equipment family to show
  // Common:
  displayOrder: number;
  createdAt: string;
}
```

## Icon System

### Two-tier icon architecture

1. **Custom SVG icons** (`CUSTOM_ICON_REGISTRY`): Rich, stateful SVG icons that reflect equipment state (on/off, open/closed, temperature level). These are the primary icons displayed in widgets and available in the icon picker.
2. **Lucide fallback icons** (`ICON_MAP`): Simple Lucide icons used as fallback when no custom SVG icon is assigned.

### Custom SVG Icons

| Key                 | Label              | Preview Props            | Applicable Types                                 |
| ------------------- | ------------------ | ------------------------ | ------------------------------------------------ |
| `light_bulb`        | Ampoule            | `on: true`               | light_onoff, light_dimmable, light_color, lights |
| `shutter`           | Volet              | `level: 2`               | shutter, shutters                                |
| `thermometer`       | Thermomètre        | `warm: true, level: 0.5` | thermostat, heating                              |
| `multi_sensor`      | Capteur multi      | `{}`                     | sensor, sensors                                  |
| `humidity_sensor`   | Humidité           | `{}`                     | sensor, sensors                                  |
| `luminosity_sensor` | Luminosité         | `{}`                     | sensor, sensors                                  |
| `water_leak_sensor` | Fuite d'eau        | `{}`                     | sensor, sensors                                  |
| `smoke_sensor`      | Fumée              | `{}`                     | sensor, sensors                                  |
| `co2_sensor`        | CO₂                | `{}`                     | sensor, sensors                                  |
| `pressure_sensor`   | Baromètre          | `{}`                     | sensor, sensors                                  |
| `gate`              | Portail battant    | `open: false`            | gate                                             |
| `sliding_gate`      | Portail coulissant | `open: false`            | gate                                             |
| `garage_door`       | Porte de garage    | `open: false`            | gate                                             |
| `heater`            | Radiateur          | `comfort: true`          | heater, heating                                  |
| `plug`              | Prise              | `on: true`               | switch                                           |
| `motion_sensor`     | Mouvement          | `active: true`           | sensor, sensors                                  |
| `contact_sensor`    | Ouverture          | `open: false`            | sensor, sensors                                  |

### Icon Picker

The icon picker is a popover that appears in **edit mode** when clicking the palette button on a widget. It shows:

1. **Relevant icons first**: filtered by equipment type or widget family
2. **Other icons**: remaining custom SVG icons from the registry

Icons are rendered at `scale-[0.45]` in 48×48 preview buttons. The currently selected icon is highlighted with a ring.

### Default Lucide icons (fallback)

| Widget                | Default icon |
| --------------------- | ------------ |
| Equipment: light\_\*  | Lightbulb    |
| Equipment: shutter    | ArrowUpDown  |
| Equipment: sensor     | Thermometer  |
| Equipment: thermostat | Thermometer  |
| Equipment: heater     | Flame        |
| Equipment: gate       | DoorOpen     |
| Equipment: switch     | ToggleLeft   |
| Equipment: button     | CircleDot    |
| Zone: lights          | Lightbulb    |
| Zone: shutters        | ArrowUpDown  |
| Zone: heating         | Flame        |
| Zone: sensors         | Gauge        |

## Edge Cases

- Equipment is deleted -> widget auto-deleted (ON DELETE CASCADE)
- Zone is deleted -> widget auto-deleted (ON DELETE CASCADE)
- Equipment has no data bindings -> widget shows name + "No data"
- Equipment is disabled -> widget shows controls greyed out
- Zone has no equipments of the selected family -> widget shows empty state
- Zone widget with child zones: recursively collect all equipments of the family
- No widgets configured -> dashboard shows empty state with "Add your first widget" prompt (admin only)

## UI/UX

### Layout

- Mobile (< 640px): 2-column grid
- Tablet (640-1024px): 3-column grid
- Desktop (> 1024px): 4-column grid
- Fixed card height: `h-[240px]` with `overflow-hidden`

### Widget Card Layout (4-zone pattern)

Each widget card follows a consistent 4-zone vertical layout:

```
┌────────────────────────┐
│       Zone 1: Title    │  ← Widget label (centered, renamable)
│                        │
│  ┌──┐              ┌──┐│
│  │  │   [picto]    │  ││  ← Zone 2+3: Picto (centered) + State info
│  │  │              │  ││     Uses grid-cols-[1fr_auto_1fr]
│  └──┘              └──┘│     Icon 96×96, vertically centered (my-auto)
│                        │
│    [controls/buttons]  │  ← Zone 4: Action buttons (mt-auto, pushed to bottom)
└────────────────────────┘
```

- **Picto zone**: CSS Grid `grid-cols-[1fr_auto_1fr]` with spacer `<div />` for visual centering. Icon in center column, state info in right column.
- **Button zone**: `mt-auto pt-1` to push controls to the card bottom.
- **Vertical centering**: `my-auto` on the picto container for flex-col alignment.

### Widget-Specific Layouts

| Widget Type    | Picto (center)          | State (right)        | Controls (bottom)       |
| -------------- | ----------------------- | -------------------- | ----------------------- |
| Light on/off   | LightBulb SVG           | —                    | Toggle ON/OFF           |
| Light dimmable | LightBulb SVG           | Vertical slim slider | Toggle ON/OFF           |
| Shutter        | Shutter SVG             | %/Ouvert/Fermé       | Open/Stop/Close         |
| Thermostat     | Thermometer SVG         | Temp + Power btn     | Setpoint −/+            |
| Gate           | Gate/Sliding/Garage SVG | —                    | Open/Close              |
| Sensor         | Sensor SVG              | Values               | — (read-only)           |
| Heater         | Heater SVG              | —                    | Mode selector           |
| Switch         | Plug SVG                | —                    | Toggle ON/OFF           |
| Zone lights    | LightBulb SVG           | Vertical slim slider | All ON / All OFF        |
| Zone shutters  | Shutter SVG             | %/Ouvert/Fermé       | All Open/Stop/All Close |
| Zone heating   | Thermometer SVG         | Temp + Power btn     | Setpoint −/+            |
| Zone sensors   | Sensor SVG              | Temp + Humidity      | — (read-only)           |

**Shutter state display**: Shows "Ouvert" badge at 100%, "Fermé" badge at 0%, percentage for intermediate values.

**Thermostat layout**: Power ON/OFF button placed in the right column next to the temperature display. Setpoint −/+ controls alone in the bottom zone.

**Dimmable light slider**: Vertical orientation (`writingMode: "vertical-lr"`, `direction: "rtl"`) with `slider-slim` CSS class for thinner track (3px) and smaller thumb (12px).

### Edit Mode

- Admin clicks "Edit" button in dashboard header → enters edit mode
- In edit mode, each widget shows:
  - **Drag handle** (GripVertical icon, top-left) for reordering
  - **Icon picker button** (Palette icon, top-right before delete) to choose custom SVG icon
  - **Delete button** (X icon, top-right corner)
  - **Clickable title area**: tap to trigger inline rename
- Inline rename: input field replaces title, auto-focused with text selected. Commit on blur/Enter, cancel on Escape.
- "Add Widget" card appears at the end of the grid
- "Add Widget" opens a modal:
  - Tab 1: Equipment → select an equipment from the list
  - Tab 2: Zone → select a zone + equipment family
- "Done" button exits edit mode

### Visual Design

- Cards follow existing design system: `bg-surface`, `border border-border`, `rounded-[10px]`
- Custom SVG icons at 96×96 with `viewBox="0 0 56 56"`, state-driven colors and gradients
- Touch targets minimum 44×44px for mobile
- Dark mode support (existing Tailwind dark: classes)
