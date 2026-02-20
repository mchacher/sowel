# Architecture: V0.6 Sensor Equipment Support

## Data Model Changes

No backend data model changes. The `sensor` EquipmentType already exists in `types.ts`. No new SQLite tables or columns.

## Event Bus Events

No new events. Existing `equipment.data.changed` events already propagate sensor data updates through bindings.

## MQTT Topics

No new MQTT subscriptions. Sensor devices (Aqara, PIR, etc.) are already auto-discovered and their data is already parsed by the zigbee2mqtt parser with correct DataCategory inference (temperature, motion, contact_door, humidity, etc.).

## API Changes

No API changes. `POST /api/v1/equipments` already accepts `type: "sensor"`.

## UI Changes

### 1. EquipmentForm — Add sensor type

**File**: `ui/src/components/equipments/EquipmentForm.tsx`

Add `{ value: "sensor", label: "Capteur" }` to `EQUIPMENT_TYPES` array.

### 2. DeviceSelector — Merge sensor categories

**File**: `ui/src/components/equipments/DeviceSelector.tsx`

Update `EQUIPMENT_TYPE_CATEGORIES` for `sensor` to include ALL sensor categories:
```
sensor: ["temperature", "humidity", "pressure", "luminosity", "co2", "voc", "motion", "contact_door", "contact_window", "water_leak", "smoke"]
```

### 3. Auto-binding — Add sensor data mapping

**File**: `ui/src/pages/EquipmentsPage.tsx`

Add `sensor` entry to `isRelevantData()`:
```
sensor: ["temperature", "humidity", "pressure", "luminosity", "co2", "voc", "motion", "contact_door", "contact_window", "water_leak", "smoke"]
```

No order bindings for sensors (sensors are read-only).

### 4. Sensor icon helper — New utility

**File**: `ui/src/components/equipments/sensorUtils.tsx` (new)

Shared utility for determining the dynamic icon and formatting for a sensor equipment based on its actual data bindings:

```typescript
function getSensorIcon(dataBindings: DataBindingWithValue[]): React.ReactNode
function getSensorLabel(dataBindings: DataBindingWithValue[]): string
function formatSensorValue(value: unknown, category: DataCategory, unit?: string): string
```

Category-to-icon mapping:
- `motion` → PersonStanding
- `temperature` → Thermometer
- `humidity` → Droplets
- `pressure` → Gauge
- `luminosity` → Sun
- `contact_door` → DoorOpen / DoorClosed (based on value)
- `contact_window` → DoorOpen / DoorClosed
- `co2`, `voc` → Wind
- `water_leak` → Droplet
- `smoke` → Flame

Priority order for primary icon (when multiple categories): motion > contact > temperature > humidity > luminosity > pressure > other

### 5. CompactEquipmentCard — Sensor-specific display

**File**: `ui/src/components/maison/CompactEquipmentCard.tsx`

For `equipment.type === "sensor"`:
- **Icon**: Dynamic via `getSensorIcon()` based on data categories. Orange when motion detected, teal/primary when contact open, gray otherwise.
- **Values**: Show all binding values inline: `21.5°C  45%  1013hPa`
- **Motion**: PersonStanding icon changes color (orange when `true`, gray when `false`)
- **Contact**: Small badge "Ouvert" (orange) / "Fermé" (gray)

### 6. EquipmentCard — Dynamic sensor icon

**File**: `ui/src/components/equipments/EquipmentCard.tsx`

For `equipment.type === "sensor"` (or `motion_sensor` / `contact_sensor`), replace the static `TYPE_ICONS[equipment.type]` with `getSensorIcon(equipment.dataBindings)`.

Also update TYPE_LABELS to show a dynamic label.

### 7. EquipmentDetailPage — Sensor data panel

**File**: `ui/src/pages/EquipmentDetailPage.tsx`

Add a `<SensorDataPanel>` component (rendered when `isSensor`), similar placement to the light "Controls" panel:

```
┌─ Sensor Data ──────────────────────────────────┐
│                                                  │
│  🌡  Temperature     21.5 °C                    │
│  💧  Humidity        45 %                        │
│  👤  Motion          Mouvement détecté    🟠     │
│  🚪  Contact         Fermé               ⚪     │
│  📊  Pressure        1013 hPa                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

Each row:
- Category icon (Lucide)
- Category label (French)
- Large value (28px font, monospace)
- Unit
- For boolean categories: colored indicator dot

### 8. New component: SensorDataPanel

**File**: `ui/src/components/equipments/SensorDataPanel.tsx` (new)

Renders the sensor data widgets for EquipmentDetailPage:
- Groups bindings by category
- Each category gets a dedicated row with icon, label, value
- Motion: PersonStanding + "Mouvement détecté" / "Aucun mouvement" + orange/gray dot
- Contact: DoorOpen/DoorClosed + "Ouvert" / "Fermé" + orange/gray dot
- Numeric: icon + label + large value + unit

## File Changes

| File | Change |
|------|--------|
| `ui/src/components/equipments/EquipmentForm.tsx` | Add "Capteur" to EQUIPMENT_TYPES |
| `ui/src/components/equipments/DeviceSelector.tsx` | Merge all sensor categories into `sensor` entry |
| `ui/src/pages/EquipmentsPage.tsx` | Add `sensor` to `isRelevantData()` |
| `ui/src/components/equipments/sensorUtils.tsx` | **NEW** — Shared sensor icon/label/format helpers |
| `ui/src/components/equipments/SensorDataPanel.tsx` | **NEW** — Sensor data widgets for detail page |
| `ui/src/components/maison/CompactEquipmentCard.tsx` | Sensor-specific multi-value display + dynamic icon |
| `ui/src/components/equipments/EquipmentCard.tsx` | Dynamic sensor icon based on data categories |
| `ui/src/pages/EquipmentDetailPage.tsx` | Add SensorDataPanel for sensor equipments |
