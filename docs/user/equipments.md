# Equipments

Equipments are the core concept in Sowel. An equipment is a **functional unit** that you interact with daily -- "Living Room Spots", "Bedroom Shutters", "Kitchen Sensor".

**A Device is what's on the network, an Equipment is what's in the room.** You never think about the Zigbee dimmer module installed behind the wall -- you think about your living room lights.

## Creating an equipment

Go to **Administration > Equipments** and click **Add Equipment**.

### Step 1: Basic information

| Field       | Required | Description                                                            |
| ----------- | -------- | ---------------------------------------------------------------------- |
| Type        | Yes      | The equipment category (see [Equipment types](#equipment-types) below) |
| Name        | Yes      | A meaningful name like "Living Room Spots" or "Kitchen Sensor"         |
| Zone        | Yes      | Which room or area this equipment belongs to                           |
| Description | No       | A note for yourself                                                    |

!!! info "Type cannot be changed after creation"
Choose the type carefully -- it determines which devices are compatible and how the equipment is displayed.

### Step 2: Select devices

Click **Next: Select devices** to see a list of compatible devices. Sowel filters devices automatically based on the equipment type.

- Select one or more devices
- Click **Create**

**That's it.** Sowel automatically creates all the data and command bindings. Every value the device exposes (temperature, humidity, battery...) becomes immediately available on the equipment.

!!! tip "You can skip device selection"
You can create an equipment without a device and bind one later from the detail page.

### Multi-device binding

A single equipment can bind to **multiple devices**. This is one of Sowel's most powerful features.

**Example:** Three separate IKEA dimmer modules power the spotlights in your living room. Create one "Living Room Spots" equipment and bind all three. A single toggle turns all three on. A single slider dims all three.

---

## Equipment types

### Lights

#### Light (On/Off)

Simple on/off light control.

- **Controls:** Toggle ON/OFF
- **Expected data:** state (on/off)

#### Light (Dimmable)

Brightness-controllable light.

- **Controls:** Toggle ON/OFF + brightness slider
- **Expected data:** state, brightness level

#### Light (Color)

Color-capable light with optional color temperature.

- **Controls:** Toggle + brightness slider + color controls
- **Expected data:** state, brightness, color, color temperature

---

### Shutters

#### Shutter

Motorized roller blind, cover, or shutter.

- **Controls:** Open / Stop / Close buttons, position display
- **Expected data:** position (0% = closed, 100% = open)

---

### Climate

#### Thermostat

Heating or cooling control -- air conditioning, pellet stove, heat pump.

- **Controls:** Temperature display, setpoint adjustment (+/-), power on/off
- **Expected data:** current temperature, target setpoint, power state
- **Additional data** (depends on device): operating mode, fan speed, eco mode

#### Heater

Individual electric heater controlled via fil pilote relay.

- **Controls:** Comfort / Eco toggle
- **Expected data:** relay state (ON = eco, OFF = comfort)

---

### Access

#### Gate

Gate, sliding gate, or garage door.

- **Controls:** Open/Close button with state indicator
- **Expected data:** gate state (open, closed, opening, closing)

!!! tip "Dashboard icon"
You can choose a specific icon for gates on the dashboard: standard gate, sliding gate, or garage door.

---

### Sensors

#### Sensor

Generic sensor that displays one or more measured values. Sowel adapts the display automatically based on what the device exposes.

- **Controls:** Read-only value display with appropriate icons and units
- **Typical data:** temperature, humidity, pressure, CO2, VOC, luminosity, noise, battery
- **Boolean sensors:** motion (Movement/Calm), contact (Open/Closed), water leak, smoke

#### Weather Station

Outdoor weather sensor providing current conditions.

- **Controls:** Multi-value display
- **Typical data:** temperature, humidity, pressure, rain, wind, noise, battery

#### Weather Forecast

Multi-day weather forecast from an API integration (e.g., Open-Meteo plugin).

- **Controls:** Day-by-day forecast cards with condition icons
- **Data per day (J+1 to J+5):** weather condition, temperature min/max, rain probability, wind gusts

#### Button / Remote

Physical button or remote control. Not directly controlled -- used as a trigger for automations.

- **Data:** action events (single press, double press, long press)
- **Usage:** Trigger [recipes](../technical/recipe-development.md) or toggle [modes](modes.md)

---

### Energy

#### Energy Meter

Tracks energy consumption for a specific circuit or device.

- **Controls:** Power (W) and daily energy (Wh/kWh) display
- **Expected data:** instantaneous power, cumulative energy

#### Main Energy Meter

Your home's main grid meter. Only one allowed per system.

- **Controls:** Same as energy meter, plus feeds the [Energy monitoring](energy.md) page
- **Expected data:** power, energy (with HP/HC tariff classification)

#### Energy Production Meter

Solar panel or other production source. Only one allowed per system.

- **Controls:** Production display with autoconsumption calculation
- **Expected data:** production power, cumulative production

---

### Other

#### Switch / Plug

Simple on/off switch or smart plug.

- **Controls:** Toggle ON/OFF with state badge
- **Expected data:** state (on/off)

---

## Managing equipments

### Detail page

Click on any equipment to see its detail page:

- **Live data** -- all values updated in real-time via WebSocket
- **Controls** -- interactive controls adapted to the equipment type
- **History chart** -- data trends over time (if historization is enabled)
- **Configuration** -- bound devices, data bindings, order bindings

### Changing the device

From the detail page, click **Change device** to rebind the equipment to different devices. Sowel removes all existing bindings and recreates them automatically from the new device(s).

### Historization

Each data value is historized to InfluxDB by default based on its category (temperature, humidity, power...). From the detail page, you can override this per binding:

- **Default** -- follows the category rule
- **Force ON** -- always historize this value
- **Force OFF** -- never historize this value

### Disabling an equipment

A disabled equipment:

- Does not appear in the Home view
- Is excluded from [zone aggregation](zones.md)
- Does not trigger recipes or mode impacts
- Can still be viewed and edited

### Deleting an equipment

Deleting removes the equipment from Sowel. The underlying devices are **not** affected -- they remain available for new equipments.

!!! warning
Deleting an equipment also removes any recipe instances and mode impacts that reference it.
