import { createElement, type ComponentType, type ReactElement } from "react";
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
  BatteryCharging,
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
  Monitor,
  type LucideIcon,
} from "lucide-react";
import type { EquipmentType, WidgetFamily } from "../../types";
import {
  LightBulbIcon,
  ShutterWidgetIcon,
  AwningWidgetIcon,
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
  WaterHeaterIcon,
  SlidingGateIcon,
  GarageDoorIcon,
  PlugWidgetIcon,
  MotionSensorIcon,
  ContactSensorIcon,
  PoolPumpIcon,
  PoolCoverIcon,
  WaterValveWidgetIcon,
  AirCompressorIcon,
  Printer3DIcon,
} from "./WidgetIcons";

// ============================================================
// Utility — shutter level bucket (moved from WidgetIcons.tsx to avoid react-refresh lint)
// ============================================================

/** Returns a shutter level bucket: 0, 25, 50, 75, or 100 */
export function shutterLevel(position: number): number {
  if (position <= 12) return 0;
  if (position <= 37) return 25;
  if (position <= 62) return 50;
  if (position <= 87) return 75;
  return 100;
}

// ============================================================
// Custom SVG icon registry — rich icons with state
// ============================================================

/**
 * The props a drawing is rendered from: whatever state the equipment's own
 * icon is given (`{ on }`, `{ open }`, `{ position }`…). Deliberately open:
 * each equipment type owns its vocabulary, the registry only adapts it.
 */
export type IconStateProps = Record<string, unknown>;

export interface CustomIconEntry {
  label: string;
  component: ComponentType<IconStateProps>;
  /**
   * Frozen props for the ICON PICKER's thumbnail, and nothing else. A live
   * tile renders the drawing from the equipment's real state — rendering
   * previewProps there is what made a hand-picked plug glow whatever the
   * relay was doing.
   */
  previewProps: IconStateProps;
  /**
   * Adapt the live state to this drawing's own vocabulary. Only needed when
   * the props are not the boolean ones filled in by `customIconProps` — the
   * 3D printer's four-valued `state` is the one case.
   */
  fromState?: (state: IconStateProps) => IconStateProps;
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
  awning: {
    label: "Store banne",
    component: AwningWidgetIcon as ComponentType<Record<string, unknown>>,
    previewProps: { deployed: true },
    types: ["awning", "awnings"],
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
  water_heater: {
    label: "Chauffe-eau",
    component: WaterHeaterIcon as ComponentType<Record<string, unknown>>,
    previewProps: { on: true },
    types: ["water_heater"],
  },
  plug: {
    label: "Prise",
    component: PlugWidgetIcon as ComponentType<Record<string, unknown>>,
    previewProps: { on: true },
    types: ["switch"],
  },
  air_compressor: {
    label: "Compresseur d'air",
    component: AirCompressorIcon as ComponentType<Record<string, unknown>>,
    previewProps: { on: false },
    types: ["switch"],
  },
  printer_3d: {
    label: "Imprimante 3D",
    component: Printer3DIcon as ComponentType<Record<string, unknown>>,
    previewProps: { state: "off" },
    // The one drawing whose prop is not a boolean. A plug only ever knows
    // whether the machine is powered: `printing` and `error` would need data
    // no relay exposes, so they stay out of reach from a dashboard tile.
    fromState: (state) => ({ state: state.on === true ? "on" : "off" }),
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
  water_valve: {
    label: "Vanne d'arrosage",
    component: WaterValveWidgetIcon as ComponentType<Record<string, unknown>>,
    previewProps: { open: false },
    types: ["water_valve", "water"],
  },
  pool_pump: {
    label: "Pompe piscine",
    component: PoolPumpIcon as ComponentType<Record<string, unknown>>,
    previewProps: { on: false },
    types: ["pool_pump", "pool"],
  },
  pool_cover: {
    label: "Volet piscine",
    component: PoolCoverIcon as ComponentType<Record<string, unknown>>,
    previewProps: { position: 50 },
    types: ["pool_cover", "pool"],
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
  BatteryCharging,
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
  Monitor,
};

export const ICON_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: "Lighting",
    icons: ["Lightbulb", "LampDesk", "LampFloor", "Lamp", "Sun", "Sparkles", "SunDim"],
  },
  { label: "Shutters / Doors", icons: ["DoorOpen", "DoorClosed", "ArrowUpDown", "Lock", "Unlock"] },
  {
    label: "Climate",
    icons: ["Thermometer", "Flame", "Snowflake", "Fan", "Wind", "Droplets", "CloudRain"],
  },
  { label: "Security", icons: ["Shield", "ShieldCheck", "Camera", "Bell", "Eye", "AlertTriangle"] },
  {
    label: "Sensors",
    icons: ["Gauge", "Activity", "Zap", "Power", "Battery", "BatteryCharging", "Signal", "Wifi"],
  },
  {
    label: "Rooms",
    icons: ["Home", "Sofa", "Bed", "CookingPot", "Bath", "Car", "Trees", "Flower2"],
  },
  {
    label: "General",
    icons: ["Star", "Heart", "CircleDot", "ToggleLeft", "Settings", "Radio", "Monitor"],
  },
];

const EQUIPMENT_DEFAULT_ICONS: Partial<Record<EquipmentType, string>> = {
  light_onoff: "Lightbulb",
  light_dimmable: "Lightbulb",
  light_color: "Lightbulb",
  shutter: "ArrowUpDown",
  awning: "ArrowUpDown",
  sensor: "Thermometer",
  solar_panel: "Sun",
  thermostat: "Thermometer",
  heater: "Flame",
  water_heater: "Droplets",
  gate: "DoorOpen",
  switch: "ToggleLeft",
  button: "CircleDot",
  water_valve: "Droplets",
  pool_pump: "Droplets",
  pool_cover: "ArrowUpDown",
  pool_heat_pump: "Thermometer",
  display: "Monitor",
  vmc: "Fan",
  ups: "BatteryCharging",
};

const FAMILY_DEFAULT_ICONS: Record<WidgetFamily, string> = {
  lights: "Lightbulb",
  shutters: "ArrowUpDown",
  awnings: "ArrowUpDown",
  heating: "Flame",
  sensors: "Gauge",
  water: "Droplets",
  pool: "Droplets",
  displays: "Monitor",
  ventilation: "Fan",
  power: "BatteryCharging",
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

/**
 * Boolean props the drawings use for "this appliance is doing something".
 * A custom icon can be picked for any equipment (the picker offers every
 * drawing under "other"), so whichever one its type computed fills in the
 * ones this particular drawing reads. Numeric state (`level`, `position`)
 * is NOT cross-filled: those value spaces differ per family.
 */
const ACTIVITY_PROPS = ["on", "open", "active", "deployed", "warm", "comfort"] as const;

/** Props to render a custom drawing with, from the state its widget resolved. */
export function customIconProps(entry: CustomIconEntry, state: IconStateProps): IconStateProps {
  const filled: IconStateProps = { ...state };
  const source = ACTIVITY_PROPS.find((key) => state[key] !== undefined);
  if (source !== undefined) {
    const active = Boolean(state[source]);
    for (const key of ACTIVITY_PROPS) {
      if (filled[key] === undefined) filled[key] = active;
    }
  }
  return entry.fromState ? entry.fromState(filled) : filled;
}

/**
 * Render a dashboard widget's icon: the hand-picked drawing when the widget
 * has one (#318), else the type's own element unchanged. The custom drawing
 * inherits the very props the type icon was built with, so both follow the
 * equipment's state — there is no second rule to keep in sync.
 */
export function renderWidgetStateIcon(
  iconKey: string | undefined,
  typeIcon: ReactElement,
): ReactElement {
  const entry = iconKey ? CUSTOM_ICON_REGISTRY[iconKey] : undefined;
  if (!entry) return typeIcon;
  return createElement(entry.component, customIconProps(entry, typeIcon.props as IconStateProps));
}
