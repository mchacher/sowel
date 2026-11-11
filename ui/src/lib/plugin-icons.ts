import {
  AirVent,
  Camera,
  Car,
  CloudSun,
  Cpu,
  House,
  Package,
  Plug,
  PlugZap,
  Power,
  Puzzle,
  Radio,
  Smartphone,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { RECIPE_ICONS } from "./recipe-icons";

/**
 * The icon a plugin shows on the Plugins and Integrations pages: the Lucide
 * name its manifest declares (`manifest.icon`, `IntegrationInfo.icon`). A
 * closed set, so these pages no longer pull every Lucide icon into the bundle
 * through a namespace import (#1187): the recipe icons (one list, so a recipe
 * shows the same icon here and on the zone page), the icons official
 * integrations use, and the three the backend names itself (`Package` for a
 * personal source, `Puzzle` for an unreadable manifest, `Plug` for an
 * integration without an icon). A name outside it, or none, falls back to `Cpu`.
 * `plugin-icons.test.ts` fails when a registry entry names an icon missing here.
 */
export const PLUGIN_ICONS: Record<string, LucideIcon> = {
  ...RECIPE_ICONS,
  AirVent,
  Camera,
  Car,
  CloudSun,
  Cpu,
  House,
  Package,
  Plug,
  PlugZap,
  Power,
  Puzzle,
  Radio,
  Smartphone,
  Zap,
};

export function pluginIcon(name: string | undefined): LucideIcon {
  return (name && Object.hasOwn(PLUGIN_ICONS, name) && PLUGIN_ICONS[name]) || Cpu;
}
