# Equipments

Equipments are the core concept in Sowel. An equipment is a **functional unit** that you interact with daily -- "Living Room Spots", "Bedroom Shutters", "Kitchen Temperature".

The key insight: **a Device is what's on the network, an Equipment is what's in the room.** You never think about the Zigbee dimmer module installed behind the wall -- you think about your living room lights.

## Creating an equipment

Go to **Administration > Equipments** and click **Add Equipment**.

The creation form has two steps:

### Step 1: Basic information

- **Name** -- a meaningful name like "Living Room Spots" or "Kitchen Sensor"
- **Type** -- the equipment category (see [Equipment types](#equipment-types) below)
- **Zone** -- which room or area this equipment belongs to
- **Description** (optional) -- a note for yourself

### Step 2: Device binding

Select which device(s) to bind to this equipment. Sowel shows compatible devices based on the equipment type you chose.

For each device, you bind its **data** (readable values like temperature, state, brightness) and **orders** (writable commands like turn on, set brightness) to the equipment.

!!! tip "Multi-device binding"
A single equipment can bind to multiple devices. This is one of Sowel's most powerful features.

    **Example**: Three separate IKEA dimmer modules power the spotlights in your living room. Create one "Living Room Spots" equipment and bind all three. A single toggle turns all three on. A single slider dims all three.

## Equipment types

### Light (On/Off)

Simple on/off light control.

- **UI**: Toggle switch
- **Data**: state (on/off)
- **Orders**: turn on, turn off

### Light (Dimmable)

Brightness-controllable light.

- **UI**: Toggle switch + brightness slider
- **Data**: state (on/off), brightness level
- **Orders**: turn on, turn off, set brightness

### Light (Color)

Color-capable light.

- **UI**: Toggle switch + brightness slider + color controls
- **Data**: state, brightness, color temperature, color
- **Orders**: turn on, turn off, set brightness, set color temperature, set color

### Shutter

Roller blind, cover, or shutter.

- **UI**: Open / Stop / Close buttons + position display
- **Data**: position (0% = closed, 100% = open)
- **Orders**: open, close, stop, set position

### Thermostat

Heating or cooling control (AC units, pellet stoves, radiators).

- **UI**: Temperature display, mode selector, power control
- **Data**: current temperature, target temperature, operating mode, power state
- **Orders**: set temperature, set mode, power on/off

### Gate

Gate or garage door control.

- **UI**: Open / Close / Stop controls with state indicator
- **Data**: gate state (open, closed, opening, closing)
- **Orders**: open, close, stop

### Sensor

Generic sensor that displays one or more measured values. Sowel automatically adapts the display based on the data categories.

- **UI**: Auto-adaptive value display with appropriate icons and units
- **Supported data**: temperature, humidity, pressure, CO2, VOC, luminosity, noise, rain, wind, UV
- **Battery**: If the sensor has a battery, the level is shown with a color-coded icon

### Motion sensor

Dedicated motion/presence detector.

- **UI**: Motion status indicator (Motion / Calm) with duration
- **Data**: motion (true/false)
- Used in zone aggregation for motion detection

### Contact sensor

Door or window contact sensor.

- **UI**: Open/Closed status with appropriate icon
- **Data**: contact state
- Used in zone aggregation for open door/window alerts

### Energy meter

Tracks energy consumption for a specific circuit or device.

- **UI**: Power (W) and cumulative energy (kWh) display
- **Data**: instantaneous power, cumulative energy

### Main energy meter

Your home's main energy meter (e.g., Netatmo Energy module on the main breaker).

- **UI**: Same as energy meter, plus feeds the Energy monitoring page
- **Data**: power, energy, with HP/HC tariff classification

### Energy production meter

Solar panel or other production source meter.

- **UI**: Production display with autoconsumption calculation
- **Data**: production power, cumulative production

### Weather station

Local weather data from an outdoor sensor.

- **UI**: Multi-value display (temperature, humidity, pressure, rain, wind, UV)
- **Data**: varies by sensor capabilities

### Weather forecast

Weather forecast data (from an API integration).

- **UI**: Forecast display with conditions
- **Data**: weather condition, temperature forecast

### Heater

Individual heater control (e.g., smart radiator valve).

- **UI**: Temperature + mode controls
- **Data**: temperature, mode
- **Orders**: set temperature, set mode

### Switch / Plug

Simple on/off switch or smart plug.

- **UI**: State badge showing current status
- **Data**: state (on/off)
- **Orders**: turn on, turn off

### Button / Remote

Physical button or remote (used as a trigger for automations, not directly controlled).

- **Data**: action events (single press, double press, long press)
- Used primarily as triggers in recipes and modes

## Managing equipments

### Editing an equipment

From the equipment list, click on any equipment to open its detail page. You can:

- Change the name or description
- Move it to a different zone
- Modify device bindings (add or remove bound devices)
- View real-time data values
- View and execute orders

### Disabling an equipment

You can disable an equipment without deleting it. A disabled equipment:

- Does not appear in the Home view
- Is excluded from zone aggregation
- Does not trigger recipes or mode impacts

This is useful when a device is temporarily unavailable or you are reorganizing your setup.

### Deleting an equipment

Deleting an equipment removes it from Sowel. The underlying devices are **not** affected -- they remain available for binding to new equipments.

!!! warning
Deleting an equipment also removes any recipe instances and mode impacts that reference it. Make sure no active automations depend on the equipment before deleting.

## Computed data

For advanced setups, an equipment can have **computed data** -- virtual values derived from expressions over multiple data sources.

**Examples**:

- A "Kitchen Lighting" equipment bound to two relays can have a computed `state` that is `OR(relay_1.state, relay_2.state)` -- showing "ON" if either relay is active
- A "Living Room Temperature" sensor bound to two Aqara sensors can compute `AVG(sensor_1.temperature, sensor_2.temperature)` for a more accurate reading

Available expressions: `OR`, `AND`, `NOT`, `AVG`, `MIN`, `MAX`, `SUM`, `IF`, `THRESHOLD`.

## Tips

- **Name clearly**: Use names that match how you refer to things in daily life. "Living Room Spots" is better than "TRADFRI LED1837R5 x3".
- **One equipment per function**: If you have separate ceiling lights and a floor lamp in the same room, create separate equipments for each.
- **Multi-device for redundancy**: If you have two temperature sensors in a large room, bind both to a single sensor equipment with an AVG computed data for better accuracy.
- **Zone matters**: The zone you assign determines where the equipment appears in the Home view and how it contributes to zone aggregation.
