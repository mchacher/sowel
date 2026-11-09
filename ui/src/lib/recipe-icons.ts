import {
  BatteryCharging,
  Bell,
  CalendarClock,
  ChefHat,
  Droplets,
  Eye,
  Fan,
  Flame,
  Heater,
  Lightbulb,
  Monitor,
  Moon,
  ShieldAlert,
  Snowflake,
  Sun,
  SunDim,
  Thermometer,
  ToggleRight,
  Waves,
  type LucideIcon,
} from "lucide-react";

/**
 * The icon a recipe row shows (spec 198): the Lucide name its package manifest
 * declares (`RecipeInfo.icon`). A closed set, the icons the official registry
 * uses, so the zone page does not pull every Lucide icon into the bundle
 * (#1187). A name outside it, or none, falls back to the chef hat.
 */
export const RECIPE_ICONS: Record<string, LucideIcon> = {
  BatteryCharging,
  Bell,
  CalendarClock,
  ChefHat,
  Droplets,
  Eye,
  Fan,
  Flame,
  Heater,
  Lightbulb,
  Monitor,
  Moon,
  ShieldAlert,
  Snowflake,
  Sun,
  SunDim,
  Thermometer,
  ToggleRight,
  Waves,
};

export function recipeIcon(name: string | undefined): LucideIcon {
  return (name && Object.hasOwn(RECIPE_ICONS, name) && RECIPE_ICONS[name]) || ChefHat;
}
