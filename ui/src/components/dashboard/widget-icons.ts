import { createElement, type ComponentType } from "react";
import {
  Lightbulb,
  LampDesk,
  LampFloor,
  Lamp,
  Sun,
  Sparkles,
  SunDim,
  DoorOpen,
  DoorClosed,
  ArrowUpDown,
  Lock,
  Unlock,
  Thermometer,
  Flame,
  Snowflake,
  Fan,
  Wind,
  Droplets,
  CloudRain,
  Shield,
  ShieldCheck,
  Camera,
  Bell,
  Eye,
  AlertTriangle,
  Gauge,
  Activity,
  Zap,
  Power,
  Battery,
  Signal,
  Wifi,
  Home,
  Sofa,
  Bed,
  CookingPot,
  Bath,
  Car,
  Trees,
  Flower2,
  Star,
  Heart,
  CircleDot,
  ToggleLeft,
  Settings,
  Radio,
  type LucideIcon,
} from "lucide-react";
import type { EquipmentType, WidgetFamily } from "../../types";
import {
  LightBulbIcon,
  ShutterWidgetIcon,
  ThermometerIcon,
  MultiSensorIcon,
  HumiditySensorIcon,
  LuminositySensorIcon,
  WaterLeakSensorIcon,
  SmokeSensorIcon,
  Co2SensorIcon,
  PressureSensorIcon,
  GateWidgetIcon,
  HeaterWidgetIcon,
  SlidingGateIcon,
  GarageDoorIcon,
  PlugWidgetIcon,
  MotionSensorIcon,
  ContactSensorIcon,
} from "./WidgetIcons";

// ============================================================
// Custom SVG icon registry — rich icons with state
// ============================================================

export interface CustomIconEntry {
  label: string;
  component: ComponentType<Record<string, unknown>>;
  /** Default props for preview (static state) */
  previewProps: Record<string, unknown>;
  /** Categories this icon applies to (for filtering in picker) */
  types: string[];
}

export const CUSTOM_ICON_REGISTRY: Record<string, CustomIconEntry> = {
  light_bulb: {
    label: "Ampoule",
    component: LightBulbIcon as ComponentType<Record<string, unknown>>,
    previewProps: { on: true },
    types: ["light_onoff", "light_dimmable", "light_color", "lights"],
  },
  shutter: {
    label: "Volet",
    component: ShutterWidgetIcon as ComponentType<Record<string, unknown>>,
    previewProps: { level: 2 },
    types: ["shutter", "shutters"],
  },
  thermometer: {
    label: "Thermomètre",
    component: ThermometerIcon as ComponentType<Record<string, unknown>>,
    previewProps: { warm: true, level: 0.5 },
    types: ["thermostat", "heating"],
  },
  multi_sensor: {
    label: "Capteur multi",
    component: MultiSensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: {},
    types: ["sensor", "sensors"],
  },
  humidity_sensor: {
    label: "Humidité",
    component: HumiditySensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: {},
    types: ["sensor", "sensors"],
  },
  luminosity_sensor: {
    label: "Luminosité",
    component: LuminositySensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: {},
    types: ["sensor", "sensors"],
  },
  water_leak_sensor: {
    label: "Fuite d'eau",
    component: WaterLeakSensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: {},
    types: ["sensor", "sensors"],
  },
  smoke_sensor: {
    label: "Fumée",
    component: SmokeSensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: {},
    types: ["sensor", "sensors"],
  },
  co2_sensor: {
    label: "CO₂",
    component: Co2SensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: {},
    types: ["sensor", "sensors"],
  },
  pressure_sensor: {
    label: "Baromètre",
    component: PressureSensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: {},
    types: ["sensor", "sensors"],
  },
  gate: {
    label: "Portail battant",
    component: GateWidgetIcon as ComponentType<Record<string, unknown>>,
    previewProps: { open: false },
    types: ["gate"],
  },
  sliding_gate: {
    label: "Portail coulissant",
    component: SlidingGateIcon as ComponentType<Record<string, unknown>>,
    previewProps: { open: false },
    types: ["gate"],
  },
  garage_door: {
    label: "Porte de garage",
    component: GarageDoorIcon as ComponentType<Record<string, unknown>>,
    previewProps: { open: false },
    types: ["gate"],
  },
  heater: {
    label: "Radiateur",
    component: HeaterWidgetIcon as ComponentType<Record<string, unknown>>,
    previewProps: { comfort: true },
    types: ["heater", "heating"],
  },
  plug: {
    label: "Prise",
    component: PlugWidgetIcon as ComponentType<Record<string, unknown>>,
    previewProps: { on: true },
    types: ["switch"],
  },
  motion_sensor: {
    label: "Mouvement",
    component: MotionSensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: { active: true },
    types: ["sensor", "sensors"],
  },
  contact_sensor: {
    label: "Ouverture",
    component: ContactSensorIcon as ComponentType<Record<string, unknown>>,
    previewProps: { open: false },
    types: ["sensor", "sensors"],
  },
};

// ============================================================
// Lucide icon map (simple icons for fallback / general use)
// ============================================================

export const ICON_MAP: Record<string, LucideIcon> = {
  Lightbulb,
  LampDesk,
  LampFloor,
  Lamp,
  Sun,
  Sparkles,
  SunDim,
  DoorOpen,
  DoorClosed,
  ArrowUpDown,
  Lock,
  Unlock,
  Thermometer,
  Flame,
  Snowflake,
  Fan,
  Wind,
  Droplets,
  CloudRain,
  Shield,
  ShieldCheck,
  Camera,
  Bell,
  Eye,
  AlertTriangle,
  Gauge,
  Activity,
  Zap,
  Power,
  Battery,
  Signal,
  Wifi,
  Home,
  Sofa,
  Bed,
  CookingPot,
  Bath,
  Car,
  Trees,
  Flower2,
  Star,
  Heart,
  CircleDot,
  ToggleLeft,
  Settings,
  Radio,
};

export const ICON_CATEGORIES: { label: string; icons: string[] }[] = [
  { label: "Lighting", icons: ["Lightbulb", "LampDesk", "LampFloor", "Lamp", "Sun", "Sparkles", "SunDim"] },
  { label: "Shutters / Doors", icons: ["DoorOpen", "DoorClosed", "ArrowUpDown", "Lock", "Unlock"] },
  { label: "Climate", icons: ["Thermometer", "Flame", "Snowflake", "Fan", "Wind", "Droplets", "CloudRain"] },
  { label: "Security", icons: ["Shield", "ShieldCheck", "Camera", "Bell", "Eye", "AlertTriangle"] },
  { label: "Sensors", icons: ["Gauge", "Activity", "Zap", "Power", "Battery", "Signal", "Wifi"] },
  { label: "Rooms", icons: ["Home", "Sofa", "Bed", "CookingPot", "Bath", "Car", "Trees", "Flower2"] },
  { label: "General", icons: ["Star", "Heart", "CircleDot", "ToggleLeft", "Settings", "Radio"] },
];

const EQUIPMENT_DEFAULT_ICONS: Partial<Record<EquipmentType, string>> = {
  light_onoff: "Lightbulb",
  light_dimmable: "Lightbulb",
  light_color: "Lightbulb",
  shutter: "ArrowUpDown",
  sensor: "Thermometer",
  thermostat: "Thermometer",
  heater: "Flame",
  gate: "DoorOpen",
  switch: "ToggleLeft",
  button: "CircleDot",
};

const FAMILY_DEFAULT_ICONS: Record<WidgetFamily, string> = {
  lights: "Lightbulb",
  shutters: "ArrowUpDown",
  heating: "Flame",
  sensors: "Gauge",
};

export function getWidgetIcon(
  iconName: string | undefined,
  equipmentTypeOrFamily: EquipmentType | WidgetFamily,
): LucideIcon {
  if (iconName && ICON_MAP[iconName]) {
    return ICON_MAP[iconName];
  }
  // Try equipment type default
  const eqDefault = EQUIPMENT_DEFAULT_ICONS[equipmentTypeOrFamily as EquipmentType];
  if (eqDefault && ICON_MAP[eqDefault]) return ICON_MAP[eqDefault];
  // Try family default
  const famDefault = FAMILY_DEFAULT_ICONS[equipmentTypeOrFamily as WidgetFamily];
  if (famDefault && ICON_MAP[famDefault]) return ICON_MAP[famDefault];
  // Fallback
  return Home;
}

export function renderWidgetIcon(
  iconName: string | undefined,
  equipmentTypeOrFamily: EquipmentType | WidgetFamily,
  props: { size: number; strokeWidth: number },
) {
  const Icon = getWidgetIcon(iconName, equipmentTypeOrFamily);
  return createElement(Icon, props);
}
