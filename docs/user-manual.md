# Corbel — User Manual

> Updated: 2026-02-20 — V0.8 (MQTT + Devices + Zones + Equipments + Sensors + Shutters + Zone Aggregation + Recipes)

## What is Corbel?

Corbel is a home automation engine that uses MQTT as its only data source. It connects to zigbee2mqtt, discovers your Zigbee devices automatically, and lets you organize them into Equipments and Zones with real-time controls and aggregated status.

---

## Getting Started

### Prerequisites

- Node.js 20+
- An MQTT broker with zigbee2mqtt running

### Installation

```bash
git clone <repo>
cd corbel
cp .env.example .env
npm install
```

### Configuration

Edit `.env` with your MQTT broker address:

```env
MQTT_URL=mqtt://192.168.0.45:1883
Z2M_BASE_TOPIC=zigbee2mqtt
API_PORT=3000
LOG_LEVEL=info
```

### Start

```bash
# Terminal 1 — Start the engine
npm run dev

# Terminal 2 — Start the UI
cd ui && npm install && npm run dev
```

On startup, the engine will:
1. Connect to your MQTT broker
2. Read the device list from zigbee2mqtt
3. Create a record for each device with its capabilities
4. Start tracking state changes in real-time
5. Compute zone aggregations from equipment data
6. Expose a REST API on port 3000

Then open **http://localhost:5173** in your browser to access the web UI.

---

## Concepts

### Three-Layer Architecture

| Layer | What | Example |
|-------|------|---------|
| **Device** | Physical hardware on the MQTT network (auto-discovered) | "Ikea Dimmer Module 0x1234" |
| **Equipment** | User-facing functional unit (you create these) | "Spots Salon" |
| **Zone** | Physical space in the home (nestable) | "Salon", "Cuisine", "Étage 1" |

**Key insight**: a Device is what's on the network, an Equipment is what's in the room. The user thinks about "Spots Salon", not "Ikea Dimmer Module 0x1234".

### Supported Equipment Types

| Type | Description | UI Controls |
|------|-------------|-------------|
| Light (On/Off) | Simple on/off light | Toggle button |
| Light (Dimmable) | Dimmable light | Toggle + brightness slider |
| Light (Color) | Color-capable light | Toggle + brightness slider |
| Shutter | Cover, blind, roller shutter | Open / Stop / Close buttons + position % |
| Switch / Prise | On/off switch or plug | State badge |
| Capteur | Generic sensor (temperature, humidity...) | Auto-adaptive value display |
| Capteur mouvement | Motion detector | Motion/Calm status |
| Capteur contact | Door/window contact sensor | Open/Closed status |

---

## UI Guide

### Home (daily view)

The **Home** page is the primary daily-use view. The sidebar shows a zone treeview (Home > Floor > Room). Clicking a zone displays:

1. **Zone Status Header** — aggregated pills showing:
   - Temperature, humidity, luminosity (averages)
   - Motion status with duration ("Mouvement · 5 min" or "Calme · 12 min")
   - Lights on/total count
   - Shutters open/total count with average position
   - Door/window open alerts
   - Water leak / smoke alerts

2. **Equipment Groups** — equipments organized by type:
   - **Lights**: inline toggle + brightness slider
   - **Shutters**: inline Open/Stop/Close buttons + position (Fermé / Ouvert / %)
   - **Sensors**: multi-value display with battery indicator
   - **Switches**: state badge

### Equipments (settings)

The **Equipments** page lists all equipments grouped by zone. Each card shows:
- Type icon (color changes based on state)
- Equipment name (clickable → detail page)
- Quick controls (light toggle, shutter buttons, sensor values)

**Creating an equipment:**
1. Click "Add Equipment"
2. Choose type, name, and zone
3. Click "Next: Select devices"
4. Pick compatible devices to bind
5. Click "Create"

### Equipment Detail

Shows full details for an equipment:
- Data bindings (bound device values)
- Order bindings (available commands)
- Controls: light toggle/slider, shutter Open/Stop/Close + position bar, sensor data panel
- Edit name/zone, delete equipment

### Zones (settings)

The **Zones** page manages the spatial topology:
- Create/edit/delete zones
- Nest zones (Home → Floor → Room)
- View zone tree

### Devices (settings)

The **Devices** page shows all auto-discovered MQTT devices:
- Sortable table (name, manufacturer, model, battery, LQI, last seen)
- Filter by name
- Click for detail: raw data, orders, expose viewer, inline name editor

---

## REST API

### Health

```bash
curl http://localhost:3000/api/v1/health
```

### Devices

```bash
# List all
curl http://localhost:3000/api/v1/devices

# Detail
curl http://localhost:3000/api/v1/devices/<id>

# Update name
curl -X PUT http://localhost:3000/api/v1/devices/<id> \
  -H "Content-Type: application/json" \
  -d '{"name": "PIR Salon"}'
```

### Zones

```bash
# Zone tree
curl http://localhost:3000/api/v1/zones/tree

# Create zone
curl -X POST http://localhost:3000/api/v1/zones \
  -H "Content-Type: application/json" \
  -d '{"name": "Salon", "parentId": "<parent-zone-id>"}'
```

### Equipments

```bash
# List all with bindings + data
curl http://localhost:3000/api/v1/equipments

# Create equipment
curl -X POST http://localhost:3000/api/v1/equipments \
  -H "Content-Type: application/json" \
  -d '{"name": "Spots Salon", "type": "light_dimmable", "zoneId": "<zone-id>"}'

# Execute an order
curl -X POST http://localhost:3000/api/v1/equipments/<id>/orders/state \
  -H "Content-Type: application/json" \
  -d '{"value": "ON"}'

# Execute shutter command
curl -X POST http://localhost:3000/api/v1/equipments/<id>/orders/state \
  -H "Content-Type: application/json" \
  -d '{"value": "OPEN"}'
```

### Zone Aggregation

```bash
# Get all zone aggregations
curl http://localhost:3000/api/v1/zones/aggregation

# Get aggregation for a specific zone
curl http://localhost:3000/api/v1/zones/<id>/aggregation
```

### Recipes

```bash
# List available recipes
curl http://localhost:3000/api/v1/recipes

# Get recipe details (slots, description)
curl http://localhost:3000/api/v1/recipes/motion-light

# Create a motion-light instance
curl -X POST http://localhost:3000/api/v1/recipe-instances \
  -H "Content-Type: application/json" \
  -d '{"recipeId": "motion-light", "params": {"zone": "<zone-id>", "light": "<equipment-id>", "timeout": "10m"}}'

# List active instances
curl http://localhost:3000/api/v1/recipe-instances

# Get instance execution log
curl http://localhost:3000/api/v1/recipe-instances/<id>/log

# Delete an instance (stops it)
curl -X DELETE http://localhost:3000/api/v1/recipe-instances/<id>
```

#### Available Recipes

| Recipe | Description | Slots |
|--------|-------------|-------|
| **motion-light** | Auto-light on motion, off after timeout | zone, light, timeout (default 10m) |

The motion-light recipe:
- Turns light ON when motion is detected in the zone
- Starts an extinction timer when motion stops
- Turns light OFF when the timer expires
- Handles manual turn-on: starts the timer if no motion is active
- Handles manual turn-off: cancels any running timer

### WebSocket — Live Events

```bash
websocat ws://localhost:3000/ws
```

Events: `device.data.updated`, `device.status_changed`, `device.discovered`, `equipment.data.changed`, `equipment.order.executed`, `zone.aggregation.changed`, `recipe.instance.created`, `recipe.instance.started`, `recipe.instance.stopped`, `recipe.instance.removed`, `recipe.instance.error`

---

## What's Next

| Version | Feature |
|---------|---------|
| **V0.9** | Scenario Engine — trigger/condition/action automation |
| **V0.10** | Computed Data — virtual Equipments that aggregate multiple Devices |
| **V0.11** | History — InfluxDB time-series charts |
| **V1.0+** | AI Assistant — natural language scenarios |
