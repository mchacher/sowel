# Zones

> **Layer 1 -- Topology**: the spatial structure of the home. Zones form a tree hierarchy and aggregate equipment data automatically.

## Zone

A **Zone** represents a spatial area in the home. Zones form a **tree hierarchy**.

### 1 Interface

```typescript
interface Zone {
  id: string; // UUID v4
  name: string; // "Cuisine", "Etage 1", "Maison"
  parentId: string | null; // null = root zone
  icon?: string; // Lucide icon name
  description?: string;
  displayOrder: number; // Sort order among siblings (0-based)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

interface ZoneWithChildren extends Zone {
  children: ZoneWithChildren[];
}
```

### 2 Hierarchy

Zones are nestable to any depth. Typical structure:

```
Maison                    (root, parentId: null)
+-- RDC                   (floor, parentId: Maison)
|   +-- Cuisine             (room, parentId: RDC)
|   +-- Salon              (room, parentId: RDC)
|   +-- Entree            (room, parentId: RDC)
+-- Etage                 (floor, parentId: Maison)
|   +-- Chambre Parentale (room, parentId: Etage)
|   +-- Salle de Bain     (room, parentId: Etage)
+-- Exterieur             (area, parentId: Maison)
    +-- Jardin            (area, parentId: Exterieur)
    +-- Garage            (area, parentId: Exterieur)
```

### 3 Zone Aggregated Data

The engine **automatically computes** aggregated data for each Zone based on the Equipments it contains. Aggregation is **recursive**: a parent Zone aggregates its own Equipments plus all children Zones.

```typescript
interface ZoneAggregatedData {
  temperature: number | null; // AVG of bindings with category=temperature
  humidity: number | null; // AVG, category=humidity
  luminosity: number | null; // AVG, category=luminosity
  motion: boolean; // OR over category=motion
  motionSensors: number; // COUNT of motion sensors in zone subtree
  motionSince: string | null; // ISO timestamp of last motion edge
  openDoors: number; // COUNT(open), category=contact_door
  openWindows: number; // COUNT(open), category=contact_window
  waterLeak: boolean; // OR, category=water_leak
  smoke: boolean; // OR, category=smoke
  lightsOn: number; // COUNT(on), category=light_state
  lightsTotal: number; // COUNT(all light equipments)
  shuttersOpen: number; // COUNT(open), category=shutter_position, type=shutter ONLY
  shuttersTotal: number; // COUNT(all shutter equipments), type=shutter ONLY
  averageShutterPosition: number | null; // AVG of shutter_position (%) on shutters only
  // Awnings (type=awning) and pool covers (type=pool_cover) share the
  // shutter_position category but are intentionally NOT aggregated at the
  // zone level — their dashboard widgets compute their own counts locally.
  // Aggregating them here would surface phantom zone-level "all shutters"
  // commands on zones that contain only awnings or pool covers.
  waterValvesOpen: number;
  waterValvesTotal: number;
  waterFlowTotal: number | null; // SUM of current water flow (when supported)
  sunrise: string | null; // From SunlightManager (computed from home location)
  sunset: string | null;
  isDaylight: boolean | null;
}
```

> **Note**: aggregation rules are encoded in `src/zones/zone-aggregator.ts`. New attributes are added there as new EquipmentTypes and DataCategories appear (energy totals, CO2/VOC, etc. -- see roadmap entries in specs).

### 4 Zone Auto-Orders

Zones expose bulk commands that fan out to all Equipments of matching types within the zone subtree. The valid keys are defined in `EquipmentManager.ZONE_ORDERS`:

| Order Key                | Target EquipmentTypes                    | OrderCategory dispatched | Value                  |
| ------------------------ | ---------------------------------------- | ------------------------ | ---------------------- |
| `allLightsOn`            | light_onoff, light_dimmable, light_color | `light_toggle`           | `"ON"`                 |
| `allLightsOff`           | light_onoff, light_dimmable, light_color | `light_toggle`           | `"OFF"`                |
| `allLightsBrightness`    | light_dimmable, light_color              | `set_brightness`         | from request body      |
| `allShuttersOpen`        | shutter                                  | `shutter_move`           | `"OPEN"`               |
| `allShuttersStop`        | shutter                                  | `shutter_move`           | `"STOP"`               |
| `allShuttersClose`       | shutter                                  | `shutter_move`           | `"CLOSE"`              |
| `allAwningsRetract`      | awning                                   | `shutter_move`           | `"OPEN"`               |
| `allAwningsStop`         | awning                                   | `shutter_move`           | `"STOP"`               |
| `allAwningsExtend`       | awning                                   | `shutter_move`           | `"CLOSE"`              |
| `allThermostatsPowerOn`  | thermostat                               | `toggle_power`           | `true`                 |
| `allThermostatsPowerOff` | thermostat                               | `toggle_power`           | `false`                |
| `allThermostatsSetpoint` | thermostat                               | `set_setpoint`           | from request body (°C) |

### 5 SQLite Schema

```sql
CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

> **Removed**: `EquipmentGroup` no longer exists. Earlier versions of this document described it; the entity and its table were removed before 1.0. Use Zones (with deeper nesting if needed) and bulk zone orders instead.

---
