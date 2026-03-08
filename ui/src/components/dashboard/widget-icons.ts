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
