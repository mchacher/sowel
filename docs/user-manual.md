# Corbel — User Manual

> Updated: 2026-02-19 — V0.1

## What is Corbel?

Corbel is a home automation engine that uses MQTT as its only data source. It connects to zigbee2mqtt, discovers your Zigbee devices automatically, and tracks their state in real-time.

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
npm run dev
```

On startup, the engine will:
1. Connect to your MQTT broker
2. Read the device list from zigbee2mqtt
3. Create a record for each device with its capabilities
4. Start tracking state changes in real-time
5. Expose a REST API on port 3000

---

## Features

### Device Auto-Discovery

Corbel reads `zigbee2mqtt/bridge/devices` and automatically creates a Device for each Zigbee device on your network. For each device, it parses the zigbee2mqtt `exposes` definition to determine:

- **Data** — readable properties (temperature, occupancy, battery, brightness, etc.)
- **Orders** — writable properties (state on/off, brightness level, etc.)
- **Category** — semantic classification used for future aggregation (motion, temperature, light_state, etc.)

New devices joining the network are detected automatically via `zigbee2mqtt/bridge/event`.

### Real-Time State Tracking

Every MQTT message from your devices is captured and stored. When a value changes, Corbel emits an event that can be observed via WebSocket.

A device that sends data is automatically marked as `online`.

### REST API

#### Health Check

```bash
curl http://localhost:3000/api/v1/health
```

Returns engine status: MQTT connection, device count, uptime.

#### List All Devices

```bash
curl http://localhost:3000/api/v1/devices
```

Returns all discovered devices with their current data values.

#### Device Detail

```bash
curl http://localhost:3000/api/v1/devices/<id>
```

Returns a single device with all its Data and Orders.

#### Update a Device

```bash
curl -X PUT http://localhost:3000/api/v1/devices/<id> \
  -H "Content-Type: application/json" \
  -d '{"name": "PIR Salon"}'
```

You can update the device `name` (display name) and `zoneId` (physical location).

#### Remove a Device

```bash
curl -X DELETE http://localhost:3000/api/v1/devices/<id>
```

Removes the device from Corbel. If the device is still on the Zigbee network, it will be re-discovered on next bridge/devices update.

#### Raw Expose Data

```bash
curl http://localhost:3000/api/v1/devices/<id>/raw
```

Returns the raw zigbee2mqtt expose definition for debugging.

### WebSocket — Live Events

Connect to the WebSocket to receive real-time events:

```bash
websocat ws://localhost:3000/ws
```

Events you'll see:

| Event | When | Example |
|-------|------|---------|
| `device.data.updated` | A sensor value changes | PIR detects motion, temperature changes |
| `device.status_changed` | Device goes online/offline | Device sends its first message |
| `device.discovered` | New device found | A new Zigbee device joins the network |

Example event:

```json
{
  "type": "device.data.updated",
  "deviceId": "4ac11f0e-...",
  "deviceName": "Ikea_PIR_00",
  "key": "occupancy",
  "value": true,
  "previous": false,
  "timestamp": "2026-02-19T14:48:34.642Z"
}
```

### Test Script

Run the included test script to get a quick overview of your network:

```bash
./scripts/test-api.sh
```

---

## Data Categories

Corbel classifies each device property into a semantic category. This classification will be used in future versions for zone aggregation and equipment type inference.

| Property | Category | Description |
|----------|----------|-------------|
| occupancy | motion | PIR motion sensor |
| temperature | temperature | Temperature reading |
| humidity | humidity | Humidity reading |
| illuminance | luminosity | Light level (lux) |
| battery | battery | Battery percentage |
| state (on light) | light_state | Light on/off |
| brightness | light_brightness | Light brightness level |
| color_temp | light_color_temp | Light color temperature |
| position | shutter_position | Shutter/cover position |
| contact | contact_door | Door/window contact |
| power | power | Instantaneous power (W) |
| energy | energy | Cumulative energy (kWh) |
| water_leak | water_leak | Water leak detection |

Properties not matching any known pattern are classified as `generic`.

---

## What's Next

| Version | Feature |
|---------|---------|
| **V0.2** | Equipments + Bindings — create user-facing functional units, bind to devices, execute orders |
| **V0.3** | Zones + Aggregation — spatial structure, auto-aggregate equipment data |
| **V0.4** | UI + Real-time — web dashboard with live state |
