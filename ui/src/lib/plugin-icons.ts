import {
  AirVent,
  BatteryCharging,
  Bell,
  CalendarClock,
  Camera,
  Car,
  CloudSun,
  Cpu,
  Droplets,
  Eye,
  Fan,
  Flame,
  Heater,
  House,
  Lightbulb,
  Monitor,
  Moon,
  PlugZap,
  Power,
  Radio,
  ShieldAlert,
  Smartphone,
  Snowflake,
  Sun,
  SunDim,
  Thermometer,
  ToggleRight,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The icon a plugin shows on the Plugins and Integrations pages: the Lucide
 * name its manifest declares (`manifest.icon`, `IntegrationInfo.icon`). A
 * closed set, the icons the official registry uses (integrations and recipes),
 * so these pages no longer pull every Lucide icon into the bundle through a
 * namespace import (#1187). A name outside it, or none, falls back to `Cpu`.
 * `plugin-icons.test.ts` fails when a registry entry names an icon missing here.
 */
export const PLUGIN_ICONS: Record<string, LucideIcon> = {
  AirVent,
  BatteryCharging,
  Bell,
  CalendarClock,
  Camera,
  Car,
  CloudSun,
  Cpu,
  Droplets,
  Eye,
  Fan,
  Flame,
  Heater,
  House,
  Lightbulb,
  Monitor,
  Moon,
  PlugZap,
  Power,
  Radio,
  ShieldAlert,
  Smartphone,
  Snowflake,
  Sun,
  SunDim,
  Thermometer,
  ToggleRight,
  Waves,
  Zap,
};

export function pluginIcon(name: string | undefined): LucideIcon {
  return (name && Object.hasOwn(PLUGIN_ICONS, name) && PLUGIN_ICONS[name]) || Cpu;
}
