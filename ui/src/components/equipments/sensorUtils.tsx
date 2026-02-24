import type { TFunction } from "i18next";
import {
  Thermometer,
  Droplets,
  Gauge,
  Sun,
  DoorOpen,
  DoorClosed,
  Wind,
  Cloud,
  CloudRain,
  Volume2,
  Droplet,
  Flame,
  PersonStanding,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  CircleDot,
} from "lucide-react";
import type { DataBindingWithValue, DataCategory } from "../../types";

/** Sensor data categories (excludes power, energy, etc.) */
export const SENSOR_DATA_CATEGORIES: DataCategory[] = [
  "temperature",
  "humidity",
  "pressure",
  "luminosity",
  "motion",
  "contact_door",
  "contact_window",
  "co2",
  "voc",
  "wind",
  "rain",
  "noise",
  "water_leak",
  "smoke",
  "action",
  "battery",
];

/** Priority order for choosing the "primary" sensor icon. */
const CATEGORY_PRIORITY: DataCategory[] = [
  "motion",
  "contact_door",
  "contact_window",
  "action",
  "temperature",
  "humidity",
  "luminosity",
  "pressure",
  "wind",
  "rain",
  "noise",
  "co2",
  "voc",
  "water_leak",
  "smoke",
];

const CATEGORY_KEYS: Partial<Record<DataCategory, string>> = {
  motion: "category.motion",
  temperature: "category.temperature",
  humidity: "category.humidity",
  pressure: "category.pressure",
  luminosity: "category.luminosity",
  contact_door: "category.contact_door",
  contact_window: "category.contact_window",
  co2: "category.co2",
  voc: "category.voc",
  water_leak: "category.water_leak",
  smoke: "category.smoke",
  wind: "category.wind",
  rain: "category.rain",
  noise: "category.noise",
  action: "category.action",
  battery: "category.battery",
};

const ICON_SIZE = 18;
const ICON_STROKE = 1.5;

function iconForCategory(category: DataCategory, value?: unknown): React.ReactNode {
  switch (category) {
    case "temperature":
      return <Thermometer size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "humidity":
      return <Droplets size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "pressure":
      return <Gauge size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "luminosity":
      return <Sun size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "motion":
      return <PersonStanding size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "contact_door":
    case "contact_window":
      return value === true || value === "ON"
        ? <DoorOpen size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        : <DoorClosed size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "co2":
    case "voc":
      return <Cloud size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "wind":
      return <Wind size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "rain":
      return <CloudRain size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "noise":
      return <Volume2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "water_leak":
      return <Droplet size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "smoke":
      return <Flame size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "action":
      return <CircleDot size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "battery":
      return getBatteryIcon(typeof value === "number" ? value : null, ICON_SIZE, ICON_STROKE);
    default:
      return <Gauge size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
  }
}

/** Find the primary data category from bindings, by priority. */
export function getPrimarySensorCategory(
  bindings: DataBindingWithValue[],
): DataCategory | null {
  for (const cat of CATEGORY_PRIORITY) {
    if (bindings.some((b) => b.category === cat)) return cat;
  }
  return bindings.length > 0 ? bindings[0].category : null;
}

/** Get the dynamic icon for a sensor equipment based on its data bindings. */
export function getSensorIcon(bindings: DataBindingWithValue[]): React.ReactNode {
  const primaryCat = getPrimarySensorCategory(bindings);
  if (!primaryCat) return <Gauge size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
  const primaryBinding = bindings.find((b) => b.category === primaryCat);
  return iconForCategory(primaryCat, primaryBinding?.value);
}

/** Get icon for a specific category and value. */
export function getSensorCategoryIcon(category: DataCategory, value?: unknown): React.ReactNode {
  return iconForCategory(category, value);
}

/** Get translated label for a data category. */
export function getSensorCategoryLabel(category: DataCategory, t?: TFunction): string {
  if (t) {
    const key = CATEGORY_KEYS[category];
    return key ? t(key) : category;
  }
  return CATEGORY_KEYS[category] ?? category;
}

/** Check if a boolean sensor value is in the "active" state (e.g. motion detected, contact open). */
export function isBooleanActive(category: string, value: unknown): boolean {
  if (category === "contact_door" || category === "contact_window") {
    return value === false || value === "OFF"; // contact=false means open
  }
  return value === true || value === "ON";
}

/** Check if a category represents a boolean sensor (motion, contact, water_leak, smoke). */
export function isBooleanSensorCategory(category: DataCategory): boolean {
  return ["motion", "contact_door", "contact_window", "water_leak", "smoke"].includes(category);
}

/** Check if motion is currently detected. */
export function isMotionDetected(bindings: DataBindingWithValue[]): boolean {
  return bindings.some(
    (b) => b.category === "motion" && (b.value === true || b.value === "ON"),
  );
}

/** Check if a contact is open. */
export function isContactOpen(bindings: DataBindingWithValue[]): boolean {
  return bindings.some(
    (b) =>
      (b.category === "contact_door" || b.category === "contact_window") &&
      (b.value === false || b.value === "OFF"),
  );
}

/** Determine the icon background/text color class for a sensor. */
export function getSensorIconColor(bindings: DataBindingWithValue[]): string {
  const primaryCat = getPrimarySensorCategory(bindings);
  if (primaryCat === "motion" && isMotionDetected(bindings)) {
    return "bg-amber-400/15 text-amber-500";
  }
  if (primaryCat === "action") {
    return "bg-primary/10 text-primary";
  }
  if (
    (primaryCat === "contact_door" || primaryCat === "contact_window") &&
    isContactOpen(bindings)
  ) {
    return "bg-amber-400/15 text-amber-500";
  }
  return "bg-border-light text-text-tertiary";
}

/** Format a sensor value for compact display. */
export function formatSensorValue(value: unknown, unit?: string, t?: TFunction): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "boolean") return t ? (value ? t("common.yes") : t("common.no")) : (value ? "Oui" : "Non");
  if (typeof value === "number") {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return unit ? `${formatted}${unit}` : formatted;
  }
  return String(value);
}

/** Format a boolean sensor value as a translated label. */
export function formatBooleanSensor(category: DataCategory, value: unknown, t?: TFunction): string {
  const isActive = value === true || value === "ON";
  if (t) {
    switch (category) {
      case "motion":
        return isActive ? t("category.value.motion.detected") : t("category.value.motion.clear");
      case "contact_door":
      case "contact_window":
        return value === false || value === "OFF" ? t("controls.opened") : t("controls.closed");
      case "water_leak":
        return isActive ? t("category.value.water_leak.active") : t("category.value.water_leak.ok");
      case "smoke":
        return isActive ? t("category.value.smoke.active") : t("category.value.smoke.ok");
      default:
        return isActive ? t("common.yes") : t("common.no");
    }
  }
  // Fallback without t
  switch (category) {
    case "motion":
      return isActive ? "Detected" : "Clear";
    case "contact_door":
    case "contact_window":
      return value === false || value === "OFF" ? "Open" : "Closed";
    case "water_leak":
      return isActive ? "Leak!" : "OK";
    case "smoke":
      return isActive ? "Alert!" : "OK";
    default:
      return isActive ? "Yes" : "No";
  }
}

/** Filter bindings to only sensor-relevant categories (excluding battery). */
export function getSensorBindings(bindings: DataBindingWithValue[]): DataBindingWithValue[] {
  return bindings.filter((b) => SENSOR_DATA_CATEGORIES.includes(b.category) && b.category !== "battery");
}

/** Get the first battery binding from an equipment's data bindings. */
export function getBatteryBinding(bindings: DataBindingWithValue[]): DataBindingWithValue | null {
  return bindings.find((b) => b.category === "battery") ?? null;
}

/** Get all battery bindings (one per physical module). */
export function getAllBatteryBindings(bindings: DataBindingWithValue[]): DataBindingWithValue[] {
  return bindings.filter((b) => b.category === "battery");
}

/** Get the appropriate battery icon based on level. */
export function getBatteryIcon(level: number | null, size = 14, strokeWidth = 1.5): React.ReactNode {
  if (level === null) return <BatteryMedium size={size} strokeWidth={strokeWidth} />;
  if (level <= 20) return <BatteryLow size={size} strokeWidth={strokeWidth} />;
  if (level <= 60) return <BatteryMedium size={size} strokeWidth={strokeWidth} />;
  return <BatteryFull size={size} strokeWidth={strokeWidth} />;
}

/** Get the color class for a battery level. */
export function getBatteryColor(level: number | null): string {
  if (level === null) return "text-text-tertiary";
  if (level <= 20) return "text-error";
  if (level <= 40) return "text-warning";
  return "text-text-tertiary";
}
