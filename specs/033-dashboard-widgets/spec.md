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

- [ ] New `/dashboard` page as the **default landing page** (same level as Maison, Modes, Analyse, Administration in sidebar)
- [ ] Grid of uniform-size widget cards, responsive: 2 columns on mobile, 3 on tablet, 4 on desktop
- [ ] Two widget types:
  - **Equipment widget**: displays one equipment's primary data + inline controls (toggle, slider, open/close)
  - **Zone widget**: displays all equipments of a **family** within a zone (including child zones), with grouped controls
- [ ] Widget configuration stored in SQLite (global, shared by all users)
- [ ] Admin can add, remove, and reorder widgets
- [ ] Reorder via drag & drop (`@dnd-kit/sortable`, touch-friendly)
- [ ] Widgets update in real-time via existing WebSocket events
- [ ] Each widget shows appropriate controls based on equipment type (same controls as CompactEquipmentCard)
- [ ] Widgets have auto-generated labels, renamable by admin
- [ ] Customizable widget icon from a curated icon picker (~40 home-automation icons from Lucide)
- [ ] Empty state when no widgets are configured

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
| `heating`  | `thermostat`, `heater`                         | -- (individual controls)          |
| `sensors`  | `sensor`                                       | -- (read only, aggregated values) |

The zone widget shows:

- Auto-generated label: "Family - Zone" (e.g., "Volets - RDC"). Renamable.
- List of equipment names with their current state
- Grouped action buttons where applicable (all on/off, all open/close)

Examples:

- "Volets - RDC" -> all `shutter` equipments in zone "RDC" and its children (Salon, Cuisine, Entree), with "Open all" / "Close all"
- "Lumieres - Salon" -> all `light_*` equipments in zone "Salon", with "All on" / "All off"

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

## Icon Picker

Widgets get a default icon based on type/family. Admin can change it via a curated picker.

### Default icons

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

### Curated icon list (~40 icons)

**Lighting**: Lightbulb, LampDesk, LampFloor, Lamp, Sun, Sparkles, SunDim
**Shutters/Doors**: DoorOpen, DoorClosed, ArrowUpDown, Blinds, Lock, Unlock
**Climate**: Thermometer, Flame, Snowflake, Fan, Wind, Droplets, CloudRain
**Security**: Shield, ShieldCheck, Camera, Bell, Eye, AlertTriangle
**Sensors**: Gauge, Activity, Zap, Power, Battery, Signal, Wifi
**Rooms**: Home, Sofa, Bed, CookingPot, Bath, Car, Trees, Flower2
**General**: Star, Heart, CircleDot, ToggleLeft, Settings, Radio

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

- Mobile (< 640px): 2-column grid, cards touch-friendly (min height 80px)
- Tablet (640-1024px): 3-column grid
- Desktop (> 1024px): 4-column grid, max-width 1200px centered

### Edit Mode

- Admin clicks "Edit" button in dashboard header -> enters edit mode
- In edit mode:
  - Each widget shows a delete button (X corner)
  - Drag handle appears for reordering (touch + mouse)
  - "Add Widget" card appears at the end of the grid
  - Tap on widget label to rename
- "Add Widget" opens a modal:
  - Tab 1: Equipment -> select an equipment from the list
  - Tab 2: Zone -> select a zone + equipment family
- "Done" button exits edit mode

### Visual Design

- Cards follow existing design system: `bg-surface`, `border border-border`, `rounded-[10px]`
- Equipment icon + name at top, controls/values below
- Touch targets minimum 44x44px for mobile
- Dark mode support (existing Tailwind dark: classes)
