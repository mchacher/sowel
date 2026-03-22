# User Guide

Welcome to the Sowel user guide. This documentation covers everything you need to set up, configure, and use Sowel on a daily basis.

## What is Sowel?

Sowel is a home automation engine that brings **structure** to your smart home. Instead of managing hundreds of individual devices, Sowel organizes your home into three clear layers:

- **Devices** -- the physical hardware on your network (sensors, switches, dimmers, thermostats). Discovered automatically from your integrations.
- **Equipments** -- the functional units you actually interact with ("Living Room Spots", "Bedroom Shutters"). Each equipment binds to one or more devices.
- **Zones** -- the spatial structure of your home (Home > Floor > Room). Zones automatically aggregate data from their equipments.

This separation means you think about _rooms and functions_, not about Zigbee addresses and MQTT topics.

## What can Sowel do?

| Feature               | Description                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Auto-discovery**    | Devices appear automatically from configured integrations (Zigbee2MQTT, Panasonic CC, MCZ Maestro, Netatmo, and more) |
| **Zone aggregation**  | Real-time room status: temperature, motion, lights count, shutter positions -- all computed automatically             |
| **Dashboard**         | Customizable widget-based dashboard for daily use                                                                     |
| **Recipes**           | Pre-built automation templates -- pick a zone, pick a light, set a timeout, done                                      |
| **Modes**             | Named operating profiles (Comfort, Away, Night) with per-zone impacts and calendar scheduling                         |
| **Energy monitoring** | Track consumption with HP/HC tariff breakdown and autoconsumption                                                     |
| **Remote access**     | Secure access from anywhere via Cloudflare Tunnel                                                                     |

## Guide sections

<div class="grid cards" markdown>

- **[Getting Started](getting-started.md)**

  Installation, first login, and initial configuration.

- **[Equipments](equipments.md)**

  Creating and managing equipments, binding to devices, equipment types.

- **[Dashboard](dashboard.md)**

  Widgets, customization, edit mode.

- **[Zones](zones.md)**

  Creating zones, assigning equipments, automatic aggregation.

- **[Modes](modes.md)**

  Operating profiles, impacts, calendar scheduling.

- **[Energy Monitoring](energy.md)**

  Consumption tracking, HP/HC tariffs, autoconsumption.

- **[Remote Access](remote-access.md)**

  Secure access from outside your home network.

</div>
