# Spec 077 — Order Categories

**Depends on**: spec 067 (apiVersion 2 deployed)

## Summary

Add a `category` field to device orders, mirroring the existing `category` on device data. Plugins declare the semantic role of each order during discovery. Zone orders use this category to find the right order binding on each equipment, eliminating alias guessing.

## Problem

Today, device orders have no semantic metadata. The zone order "allLightsOn" must guess which order binding to use (alias "state"? "on"? try all?). This is fragile and breaks across integrations.

Device DATA already has `category` (e.g., `light_state`, `shutter_position`). Device ORDERS should have a similar concept, but with distinct names: data describes **what it is** (state), orders describe **what to do** (action).

## Design

### Plugin discovery

Orders gain an optional `category` field:

```typescript
orders: [
  { key: "state", type: "enum", category: "light_toggle", enumValues: ["ON", "OFF"] },
  { key: "brightness", type: "number", category: "set_brightness", min: 0, max: 254 },
];
```

### Database

Add `category` column to `device_orders` table (nullable, for backward compat).

### Zone orders

Zone order finds the ORDER binding by category:

```typescript
const orderBinding = details.orderBindings.find((ob) => ob.category === mapping.orderCategory);
```

No more alias guessing, enum scanning, or brute-force trying.

### Automatic flow

```
Plugin discovery → device order with category
  → device_orders table (category stored)
  → equipment order binding (category inherited)
  → zone order finds by category
```

No user intervention — fully automatic.

---

## Data Categories (exhaustive — état, lecture)

Describe what the data IS.

| Category              | Description                                  | Unit    | Used by                                  |
| --------------------- | -------------------------------------------- | ------- | ---------------------------------------- |
| `motion`              | Mouvement détecté                            | —       | sensor                                   |
| `temperature`         | Température intérieure                       | °C      | sensor, thermostat                       |
| `temperature_outdoor` | Température extérieure                       | °C      | weather, weather_forecast                |
| `humidity`            | Humidité intérieure                          | %       | sensor                                   |
| `humidity_outdoor`    | Humidité extérieure                          | %       | weather                                  |
| `pressure`            | Pression atmosphérique                       | mbar    | weather                                  |
| `luminosity`          | Luminosité                                   | lx      | sensor                                   |
| `contact_door`        | Contact porte (ouvert/fermé)                 | —       | sensor                                   |
| `contact_window`      | Contact fenêtre (ouvert/fermé)               | —       | sensor                                   |
| `light_state`         | État lumière (on/off)                        | —       | light_onoff, light_dimmable, light_color |
| `light_brightness`    | Niveau luminosité                            | 0-254   | light_dimmable, light_color              |
| `light_color_temp`    | Température couleur                          | mireds  | light_color                              |
| `light_color`         | Couleur (xy/hs)                              | —       | light_color                              |
| `shutter_position`    | Position volet                               | %       | shutter                                  |
| `lock_state`          | État serrure                                 | —       | lock                                     |
| `battery`             | Niveau batterie                              | %       | sensor, weather                          |
| `power`               | État marche/arrêt                            | —       | thermostat, media_player, appliance      |
| `energy`              | Consommation énergie                         | Wh/kWh  | energy_meter, appliance                  |
| `voltage`             | Tension                                      | V       | energy_meter                             |
| `current`             | Intensité                                    | A       | energy_meter                             |
| `water_leak`          | Fuite d'eau                                  | —       | sensor                                   |
| `smoke`               | Détection fumée                              | —       | sensor                                   |
| `co2`                 | Taux CO2                                     | ppm     | sensor, weather                          |
| `voc`                 | Composés organiques volatils                 | ppb     | sensor                                   |
| `noise`               | Niveau sonore                                | dB      | sensor, weather                          |
| `rain`                | Précipitations                               | mm      | weather                                  |
| `wind`                | Vent (vitesse/direction)                     | km/h, ° | weather                                  |
| `action`              | Action bouton (single, double, hold)         | —       | button                                   |
| `gate_state`          | État portail/garage (ouvert/fermé/mouvement) | —       | gate                                     |
| `weather_condition`   | Condition météo (sunny, rainy...)            | —       | weather_forecast                         |
| `uv`                  | Index UV                                     | —       | weather                                  |
| `solar_radiation`     | Radiation solaire                            | W/m²    | weather                                  |
| `setpoint`            | Consigne température                         | °C      | thermostat                               |
| `media_volume`        | Volume audio                                 | 0-100   | media_player                             |
| `media_mute`          | Sourdine                                     | —       | media_player                             |
| `media_input`         | Source d'entrée                              | —       | media_player                             |
| `appliance_state`     | État appareil (running/stopped...)           | —       | appliance                                |
| `generic`             | Donnée sans catégorie standardisée           | —       | tout                                     |

---

## Order Categories (exhaustive — action, écriture)

Describe what the order DOES. Distinct names from data categories.

| Category               | Description                 | Value type      | Used by                                  |
| ---------------------- | --------------------------- | --------------- | ---------------------------------------- |
| `light_toggle`         | Allumer/éteindre            | ON/OFF          | light_onoff, light_dimmable, light_color |
| `set_brightness`       | Régler luminosité           | 0-254           | light_dimmable, light_color              |
| `set_color_temp`       | Régler température couleur  | mireds          | light_color                              |
| `set_color`            | Régler couleur              | xy/hs           | light_color                              |
| `shutter_move`         | Ouvrir/fermer/stop volet    | OPEN/CLOSE/STOP | shutter                                  |
| `set_shutter_position` | Régler position volet       | 0-100           | shutter                                  |
| `toggle_power`         | Allumer/éteindre appareil   | true/false      | thermostat, media_player                 |
| `set_setpoint`         | Régler consigne température | °C              | thermostat                               |
| `gate_trigger`         | Actionner portail/garage    | latch           | gate                                     |
| `valve_toggle`         | Ouvrir/fermer vanne         | ON/OFF          | water_valve                              |
| `toggle_mute`          | Activer/désactiver sourdine | true/false      | media_player                             |
| `set_input`            | Changer source d'entrée     | string          | media_player                             |

---

## Zone Orders mapping

| Zone order               | Equipment types             | Order category                      |
| ------------------------ | --------------------------- | ----------------------------------- |
| `allLightsOn`            | light\_\*                   | `light_toggle` (value: ON)          |
| `allLightsOff`           | light\_\*                   | `light_toggle` (value: OFF)         |
| `allLightsBrightness`    | light_dimmable, light_color | `set_brightness` (value: FROM_BODY) |
| `allShuttersOpen`        | shutter                     | `shutter_move` (value: OPEN)        |
| `allShuttersClose`       | shutter                     | `shutter_move` (value: CLOSE)       |
| `allShuttersStop`        | shutter                     | `shutter_move` (value: STOP)        |
| `allThermostatsPowerOn`  | thermostat                  | `toggle_power` (value: true)        |
| `allThermostatsPowerOff` | thermostat                  | `toggle_power` (value: false)       |
| `allThermostatsSetpoint` | thermostat                  | `set_setpoint` (value: FROM_BODY)   |

---

## Acceptance Criteria

- [ ] `category` field added to `DiscoveredDevice.orders`
- [ ] `category` column added to `device_orders` table (migration)
- [ ] `OrderBindingWithDetails` includes `category`
- [ ] Zone orders resolve by order category
- [ ] All plugins updated to declare order categories
- [ ] Zone orders work for lights, shutters, thermostats across all integrations
- [ ] Existing tests pass + new tests for category-based zone order dispatch

## Plugins to update

- zigbee2mqtt
- lora2mqtt
- legrand-control
- panasonic-cc
- mcz-maestro
- smartthings

## Out of scope

- Removal of dispatch_config (spec 074, separate)
- UI changes (order categories are backend only)
