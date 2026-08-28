import {
  BatteryCharging,
  Camera,
  CircleDot,
  CloudSun,
  DoorOpen,
  Droplets,
  Fan,
  Gauge,
  Heater,
  Lightbulb,
  Monitor,
  Palette,
  SunDim,
  Thermometer,
  ToggleLeft,
  Tv,
  WashingMachine,
  Waves,
  Zap,
} from "lucide-react";
import { AwningIcon } from "../icons/AwningIcon";
import { ShutterClosedIcon } from "../icons/ShutterIcons";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { WaterValveIcon } from "../icons/WaterValveIcon";
import type { DataCategory, EquipmentType } from "../../types";

// Per-equipment-type metadata, in its own module rather than next to the
// components that read it.
//
// react-refresh/only-export-components exists to keep fast refresh working: a
// module that exports both a component and something else loses it, so an edit
// there reloads the page instead of preserving component state. Version 0.4 let
// these three through under allowConstantExport; 0.5 does not, and rewriting
// them as inline `export const` does not satisfy it either (measured). Moving
// them is what the rule was asking for all along.

export const EQUIPMENT_TYPE_CATEGORIES: Partial<Record<EquipmentType, DataCategory[]>> = {
  light_onoff: ["light_state"],
  light_dimmable: ["light_state", "light_brightness"],
  light_color: ["light_state", "light_brightness", "light_color"],
  shutter: ["shutter_position"],
  switch: ["light_state"],
  // Spec 135 — water heater: an on/off relay (light_state) is the
  // discriminator; the water temperature is an optional extra binding.
  water_heater: ["light_state"],
  sensor: [
    "temperature",
    "humidity",
    "pressure",
    "luminosity",
    "co2",
    "voc",
    "noise",
    "motion",
    "contact_door",
    "contact_window",
    "water_leak",
    "smoke",
  ],
  button: ["action"],
  weather: [
    "temperature",
    "temperature_outdoor",
    "humidity",
    "humidity_outdoor",
    "pressure",
    "wind",
    "rain",
    "noise",
  ],
  // gate is candidate-based (spec 150) — no category entry here.
  heater: ["generic", "light_state"],
  energy_meter: ["energy", "power"],
  main_energy_meter: ["energy"],
  energy_production_meter: ["energy", "power"],
  // Solar panel devices expose per-channel DC power; that's the discriminator.
  solar_panel: ["power", "current"],
  // Polytropic PAC matches via pool_water_temperature; Sonoff filtration relay
  // matches via light_state (used as the optional `filtration_state` binding).
  pool_heat_pump: ["pool_water_temperature", "light_state"],
  // Spec 120 — Sowel-supervised displays (energy display, e-paper, ...).
  // Any device that exposes one of the canonical display fields is a
  // candidate. `firmware_version` / `uptime` would be too generic on
  // their own (a future Zigbee plugin might emit them too), so the
  // match keys on `display_brightness` / `language` first; if a vendor
  // ships a passive single-screen display reporting only uptime, the
  // user can still pick it via "Show all" toggle.
  display: ["display_brightness", "language", "rssi"],
  // Spec 133 — cameras. Any of the 5 categories signals a camera-capable
  // device; which ones a given device actually exposes is vendor-specific
  // (see spec 133 "Vendor neutrality").
  camera: [
    "camera_snapshot_url",
    "camera_stream_url",
    "camera_monitoring",
    "camera_light_mode",
    "camera_detection",
  ],
  // Spec 156 — UPS. Only the three UPS-specific categories discriminate:
  // `battery` and `voltage` would match every Zigbee sensor in the house.
  ups: ["ups_status", "battery_runtime", "ups_load"],
};

export const TYPE_ICONS: Record<EquipmentType, React.ReactNode> = {
  light_onoff: <Lightbulb size={18} strokeWidth={1.5} />,
  light_dimmable: <SunDim size={18} strokeWidth={1.5} />,
  light_color: <Palette size={18} strokeWidth={1.5} />,
  shutter: <ShutterClosedIcon size={18} strokeWidth={1.5} />,
  awning: <AwningIcon size={18} strokeWidth={1.5} />,
  switch: <ToggleLeft size={18} strokeWidth={1.5} />,
  sensor: <Gauge size={18} strokeWidth={1.5} />,
  button: <CircleDot size={18} strokeWidth={1.5} />,
  thermostat: <Thermometer size={18} strokeWidth={1.5} />,
  weather: <CloudSun size={18} strokeWidth={1.5} />,
  weather_forecast: <CloudSun size={18} strokeWidth={1.5} />,
  gate: <DoorOpen size={18} strokeWidth={1.5} />,
  heater: <Heater size={18} strokeWidth={1.5} />,
  water_heater: <Droplets size={18} strokeWidth={1.5} />,
  energy_meter: <Zap size={18} strokeWidth={1.5} />,
  main_energy_meter: <Zap size={18} strokeWidth={1.5} />,
  energy_production_meter: <Zap size={18} strokeWidth={1.5} />,
  solar_panel: <SolarPanelIcon size={18} strokeWidth={1.5} />,
  media_player: <Tv size={18} strokeWidth={1.5} />,
  appliance: <WashingMachine size={18} strokeWidth={1.5} />,
  water_valve: <WaterValveIcon size={18} strokeWidth={1.5} />,
  pool_pump: <Waves size={18} strokeWidth={1.5} />,
  pool_cover: <ShutterClosedIcon size={18} strokeWidth={1.5} />,
  pool_heat_pump: <Thermometer size={18} strokeWidth={1.5} />,
  display: <Monitor size={18} strokeWidth={1.5} />,
  camera: <Camera size={18} strokeWidth={1.5} />,
  vmc: <Fan size={18} strokeWidth={1.5} />,
  ups: <BatteryCharging size={18} strokeWidth={1.5} />,
};

export const TYPE_LABELS: Record<EquipmentType, string> = {
  light_onoff: "equipments.type.light_onoff",
  light_dimmable: "equipments.type.light_dimmable",
  light_color: "equipments.type.light_color",
  shutter: "equipments.type.shutter",
  awning: "equipments.type.awning",
  switch: "equipments.type.switch",
  sensor: "equipments.type.sensor",
  button: "equipments.type.button",
  thermostat: "equipments.type.thermostat",
  weather: "equipments.type.weather",
  weather_forecast: "equipments.type.weather_forecast",
  gate: "equipments.type.gate",
  heater: "equipments.type.heater",
  water_heater: "equipments.type.water_heater",
  energy_meter: "equipments.type.energy_meter",
  main_energy_meter: "equipments.type.main_energy_meter",
  energy_production_meter: "equipments.type.energy_production_meter",
  solar_panel: "equipments.type.solar_panel",
  media_player: "equipments.type.media_player",
  appliance: "equipments.type.appliance",
  water_valve: "equipments.type.water_valve",
  pool_pump: "equipments.type.pool_pump",
  pool_cover: "equipments.type.pool_cover",
  pool_heat_pump: "equipments.type.pool_heat_pump",
  display: "equipments.type.display",
  camera: "equipments.type.camera",
  vmc: "equipments.type.vmc",
  ups: "equipments.type.ups",
};
