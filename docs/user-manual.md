# Winch — User Manual

> Updated: 2026-02-21 — V0.9 Modes & Calendar

---

## Why Winch?

Home automation platforms are powerful but complex. Home Assistant drowns users in YAML and flat entity lists. Jeedom buries features behind paid plugins. Both demand hours of configuration before anything works.

Winch takes the opposite approach: **structure first, simplicity always**.

|                     | Home Assistant                                                    | Jeedom                               | **Winch**                                                                            |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| **Architecture**    | Flat entity list (thousands of `sensor.`, `light.`, `switch.`...) | Nested objects & commands            | **3 clear layers**: Device → Equipment → Zone                                        |
| **Device setup**    | Integration + entity config per device                            | Plugin per protocol (often paid)     | **Zero config** — auto-discovery from zigbee2mqtt                                    |
| **Room status**     | Create template sensors manually for each aggregation             | Write virtual devices + scenarios    | **Automatic** — motion, temperature, lights count, all computed in real-time         |
| **Automations**     | YAML automations or Node-RED (extra component)                    | Block-based scenario editor          | **Recipes** — pre-built templates, just pick the zone and the light                  |
| **Operating modes** | Manual: create `input_boolean` + automation per mode per room     | Manual: virtual switches + scenarios | **Built-in Modes** — define once, configure per zone, activate by button or calendar |
| **Scheduling**      | External calendar or `time` triggers in each automation           | Cron in each scenario                | **Built-in Calendar** — weekly profiles, drag-and-drop mode scheduling               |
| **Stack**           | Python + Docker Supervisor + add-ons + HACS                       | PHP + Apache + MySQL + plugins       | **Node.js + SQLite** — single process, instant startup                               |

### The key insight

> A **Device** is what's on the network. An **Equipment** is what's in the room. The user thinks _"Spots Salon"_, not _"IKEA TRADFRI LED1837R5 0x00158D00062B1234"_.

Winch separates the physical (Device) from the functional (Equipment), then organizes everything spatially (Zone). This is what makes aggregation, recipes, and modes possible without any configuration.

---

## Core Concepts

### 1. Devices — auto-discovered, never configured

Devices are physical hardware on the MQTT network. Winch subscribes to zigbee2mqtt and discovers everything automatically: sensors, lights, switches, shutters, buttons. Each device exposes **Data** (readable properties like temperature, state, brightness) and **Orders** (writable commands).

You never configure a Device. You just look at the list, and they're there.

### 2. Equipments — the functional unit

An Equipment is what the user actually interacts with. "Spots Salon" is an Equipment of type `light_dimmable`. It is **bound** to one or more Devices.

**Why this matters**: a single "Spots Salon" Equipment can bind to 3 separate IKEA dimmer modules. One toggle turns all three on. One slider dims all three. The user doesn't care how many physical devices are behind it.

| Equipment Type   | What it controls                        | UI                             |
| ---------------- | --------------------------------------- | ------------------------------ |
| Light (On/Off)   | Simple on/off                           | Toggle                         |
| Light (Dimmable) | Brightness control                      | Toggle + slider                |
| Light (Color)    | Color-capable                           | Toggle + slider                |
| Shutter          | Roller blind / cover                    | Open / Stop / Close + position |
| Switch / Plug    | On/off relay                            | State badge                    |
| Sensor           | Temperature, humidity, pressure, CO2... | Auto-adaptive value display    |
| Button / Remote  | Physical button (for triggers)          | —                              |

### 3. Zones — the spatial structure

Zones form a tree: `Maison → Étage 1 → Salon`. Each Equipment belongs to exactly one Zone.

**Automatic aggregation**: Winch computes real-time status for every zone:

- **Temperature, humidity, luminosity** — averaged across all sensors in the zone
- **Motion** — OR across all motion sensors (plus duration tracking)
- **Lights on / total** — count of active lights
- **Shutters open / total** — count + average position
- **Door/window contacts** — open alerts
- **Water leak, smoke** — immediate alerts

This aggregation propagates upward: "Étage 1" automatically merges data from Salon, Cuisine, and Chambre. No configuration needed.

### 4. Recipes — automation without code

A Recipe is a pre-built automation template. Instead of writing rules from scratch, the user picks a Recipe and fills in the parameters.

**Example — Motion Light**:

- Pick a zone (Salon)
- Pick a light (Spots Salon)
- Set a timeout (10 minutes)

That's it. Winch handles all the edge cases: motion detected → light ON, motion stops → start timer, timer expires → light OFF, manual turn-on → start timer if no motion, manual turn-off → cancel timer.

### 5. Modes — house-level operating states

A Mode is a named operating profile for the entire home. Examples:

- **Confort** — heating on, lights warm
- **Cocoon** — dim lights, close shutters
- **Absent** — all off, security active

Each Mode defines **impacts per zone**: what happens in each room when the mode activates. An impact can be:

- **Order**: send a command to an equipment (turn on a light, close a shutter)
- **Recipe toggle**: enable or disable a recipe (stop the motion-light in the bedroom at night)

Modes can be activated:

- **Manually** from the UI (one tap)
- **By event trigger** — a button press or sensor value (press the Cocoon button → activate Cocoon mode)
- **By calendar** — weekly schedule (8:00 weekdays → activate Confort)

### 6. Calendar — weekly mode scheduling

The Calendar manages **weekly profiles** (e.g., "Travail", "Vacances"). Each profile contains **time slots**: a day + time + modes to activate.

| Profile      | Slot            |         |
| ------------ | --------------- | ------- |
| **Travail**  | Lun–Ven 07:00   | Confort |
|              | Lun–Ven 09:00   | Absent  |
|              | Lun–Ven 18:00   | Confort |
|              | Lun–Ven 22:30   | Cocoon  |
| **Vacances** | Every day 09:00 | Confort |
|              | Every day 23:00 | Cocoon  |

Switch between profiles with one tap. The active profile's slots run automatically.

---

## UI Guide

### Home — the daily view

The **Home** page is where you spend 95% of your time. The sidebar shows a zone tree. Click a zone to see:

1. **Status header** — aggregated pills: temperature, humidity, motion status + duration, lights count, shutter status, alerts
2. **Equipment groups** — automatically organized by type:
   - **Lights**: inline toggle + brightness slider
   - **Shutters**: Open / Stop / Close buttons + position
   - **Sensors**: multi-value display with battery indicator
3. **Behaviors** — two sections:
   - **Recipes**: active recipe instances for this zone (add, delete, view logs)
   - **Modes**: all defined modes with per-zone impact configuration, triggers, and activate/deactivate

### Administration > Modes

Create and manage global mode definitions:

- Name, description
- View all event triggers (which button activates this mode)
- View all zone impacts (which zones are affected and how many actions)
- Activate / deactivate

### Administration > Calendar

Manage weekly scheduling:

- Switch between profiles (Travail, Vacances...)
- Set the active profile
- Add/remove time slots (days + time + modes to activate)

### Administration > Equipments

Create and bind equipments:

1. Click "Add Equipment"
2. Choose type, name, zone
3. Select compatible devices to bind
4. Done — the equipment appears in the Home view

### Administration > Zones

Build the spatial topology:

- Create zones (Maison, Étage 1, Salon...)
- Nest them (drag into hierarchy)
- Zone tree appears in Home sidebar

### Administration > Devices

Browse auto-discovered hardware:

- Sortable table (name, manufacturer, model, battery, LQI, last seen)
- Click for detail: raw data, orders, expose viewer
- Delete removes from Winch only (re-discovered if still active)

### Administration > Integrations

Configure zigbee2mqtt connection:

- MQTT broker URL, credentials, Z2M base topic
- Connection status indicator
- Save + reconnect without restarting

### Settings

- Profile: display name
- Password change
- Language: French / English
- API tokens for external access
- Backup / Restore (admin)
- User management (admin)

---

## Getting Started

### Prerequisites

- Node.js 20+
- An MQTT broker with zigbee2mqtt running

### Installation

```bash
git clone <repo>
cd winch
npm install
```

### Configuration

Optionally edit `.env` for engine settings:

```env
SQLITE_PATH=./data/winch.db
API_PORT=3000
JWT_SECRET=your-secret-here
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:5173
```

> **Note**: MQTT and Zigbee2MQTT settings are configured from the UI (Administration > Integrations), not from `.env`.

### Start

```bash
# Terminal 1 — Engine
npm run dev

# Terminal 2 — UI
cd ui && npm install && npm run dev
```

Open **http://localhost:5173**.

### First run

1. **Setup page** appears — create your admin account
2. Go to **Administration > Integrations** — configure your MQTT broker
3. Devices appear automatically
4. Go to **Administration > Zones** — create your home topology (Maison → Étage → Pièces)
5. Go to **Administration > Equipments** — create equipments and bind them to devices
6. Go to **Home** — enjoy your real-time dashboard

---

## REST API

All endpoints (except auth) require a Bearer token:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/...
```

### Auth

```bash
# Check if setup is required
curl http://localhost:3000/api/v1/auth/status

# First-run setup
curl -X POST http://localhost:3000/api/v1/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "secret", "displayName": "Admin"}'

# Login → { accessToken, refreshToken, user }
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "secret"}'
```

### Devices

```bash
curl http://localhost:3000/api/v1/devices          # List all
curl http://localhost:3000/api/v1/devices/<id>      # Detail
curl -X PUT http://localhost:3000/api/v1/devices/<id> \
  -H "Content-Type: application/json" \
  -d '{"name": "PIR Salon"}'                        # Rename
curl -X DELETE http://localhost:3000/api/v1/devices/<id>  # Remove
```

### Zones

```bash
curl http://localhost:3000/api/v1/zones/tree        # Zone tree
curl -X POST http://localhost:3000/api/v1/zones \
  -H "Content-Type: application/json" \
  -d '{"name": "Salon", "parentId": "<parent-id>"}'
```

### Equipments

```bash
curl http://localhost:3000/api/v1/equipments        # List all
curl -X POST http://localhost:3000/api/v1/equipments \
  -H "Content-Type: application/json" \
  -d '{"name": "Spots Salon", "type": "light_dimmable", "zoneId": "<zone-id>"}'

# Execute an order
curl -X POST http://localhost:3000/api/v1/equipments/<id>/orders/state \
  -H "Content-Type: application/json" \
  -d '{"value": "ON"}'
```

### Modes

```bash
curl http://localhost:3000/api/v1/modes             # List all modes
curl http://localhost:3000/api/v1/modes/<id>        # Mode detail (with triggers + impacts)

# Create a mode
curl -X POST http://localhost:3000/api/v1/modes \
  -H "Content-Type: application/json" \
  -d '{"name": "Cocoon", "description": "Cozy evening mode"}'

# Activate / deactivate
curl -X POST http://localhost:3000/api/v1/modes/<id>/activate
curl -X POST http://localhost:3000/api/v1/modes/<id>/deactivate

# Add event trigger (button press activates mode)
curl -X POST http://localhost:3000/api/v1/modes/<id>/triggers \
  -H "Content-Type: application/json" \
  -d '{"equipmentId": "<button-id>", "alias": "action", "value": "toggle"}'

# Set zone impact (what happens in this zone when mode activates)
curl -X PUT http://localhost:3000/api/v1/modes/<id>/zones/<zone-id>/impact \
  -H "Content-Type: application/json" \
  -d '{"actions": [{"type": "order", "equipmentId": "<eq-id>", "orderAlias": "state", "value": "ON"}]}'
```

### Calendar

```bash
curl http://localhost:3000/api/v1/calendar/profiles           # List profiles
curl http://localhost:3000/api/v1/calendar/active              # Active profile

# Set active profile
curl -X PUT http://localhost:3000/api/v1/calendar/active \
  -H "Content-Type: application/json" \
  -d '{"profileId": "<profile-id>"}'

# Add time slot
curl -X POST http://localhost:3000/api/v1/calendar/profiles/<id>/slots \
  -H "Content-Type: application/json" \
  -d '{"days": [1,2,3,4,5], "time": "08:00", "modeIds": ["<mode-id>"]}'
```

### Recipes

```bash
curl http://localhost:3000/api/v1/recipes           # Available recipes
curl -X POST http://localhost:3000/api/v1/recipe-instances \
  -H "Content-Type: application/json" \
  -d '{"recipeId": "motion-light", "params": {"zone": "<zone-id>", "light": "<eq-id>", "timeout": "10m"}}'
```

### Backup / Restore

```bash
curl http://localhost:3000/api/v1/backup -o winch-backup.json
curl -X POST http://localhost:3000/api/v1/backup \
  -H "Content-Type: application/json" -d @winch-backup.json
```

### WebSocket

```bash
websocat ws://localhost:3000/ws
```

Events: `device.data.updated`, `device.discovered`, `equipment.data.changed`, `equipment.order.executed`, `zone.aggregation.changed`, `mode.activated`, `mode.deactivated`, `recipe.instance.*`, `calendar.profile.changed`

---

## What's Next

| Version | Feature                                                               |
| ------- | --------------------------------------------------------------------- |
| V0.10   | Computed Data — virtual data expressions (formulas across equipments) |
| V0.11   | History — InfluxDB time-series with charts in UI                      |
| V1.0+   | AI Assistant — natural language scenario creation                     |
