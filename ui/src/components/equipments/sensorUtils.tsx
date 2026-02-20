import {
  Thermometer,
  Droplets,
  Gauge,
  Sun,
  DoorOpen,
  DoorClosed,
  Wind,
  Droplet,
  Flame,
  PersonStanding,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
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
  "water_leak",
  "smoke",
  "battery",
];

/** Priority order for choosing the "primary" sensor icon. */
const CATEGORY_PRIORITY: DataCategory[] = [
  "motion",
  "contact_door",
  "contact_window",
  "temperature",
  "humidity",
  "luminosity",
  "pressure",
  "co2",
  "voc",
  "water_leak",
  "smoke",
];

const CATEGORY_LABELS: Partial<Record<DataCategory, string>> = {
  motion: "Mouvement",
  temperature: "Température",
  humidity: "Humidité",
  pressure: "Pression",
  luminosity: "Luminosité",
  contact_door: "Contact porte",
  contact_window: "Contact fenêtre",
  co2: "CO₂",
  voc: "COV",
  water_leak: "Fuite d'eau",
  smoke: "Fumée",
  battery: "Batterie",
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
      return <Wind size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "water_leak":
      return <Droplet size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case "smoke":
      return <Flame size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
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

/** Get French label for a data category. */
export function getSensorCategoryLabel(category: DataCategory): string {
  return CATEGORY_LABELS[category] ?? category;
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
  if (
    (primaryCat === "contact_door" || primaryCat === "contact_window") &&
    isContactOpen(bindings)
  ) {
    return "bg-amber-400/15 text-amber-500";
  }
  return "bg-border-light text-text-tertiary";
}

/** Format a sensor value for compact display. */
export function formatSensorValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return unit ? `${formatted}${unit}` : formatted;
  }
  return String(value);
}

/** Format a boolean sensor value as a French label. */
export function formatBooleanSensor(category: DataCategory, value: unknown): string {
  const isActive = value === true || value === "ON";
  switch (category) {
    case "motion":
      return isActive ? "Détecté" : "RAS";
    case "contact_door":
    case "contact_window":
      // contact=true means closed in zigbee2mqtt
      return value === false || value === "OFF" ? "Ouvert" : "Fermé";
    case "water_leak":
      return isActive ? "Fuite !" : "OK";
    case "smoke":
      return isActive ? "Alerte !" : "OK";
    default:
      return isActive ? "Oui" : "Non";
  }
}

/** Filter bindings to only sensor-relevant categories (excluding battery). */
export function getSensorBindings(bindings: DataBindingWithValue[]): DataBindingWithValue[] {
  return bindings.filter((b) => SENSOR_DATA_CATEGORIES.includes(b.category) && b.category !== "battery");
}

/** Get the battery binding from an equipment's data bindings. */
export function getBatteryBinding(bindings: DataBindingWithValue[]): DataBindingWithValue | null {
  return bindings.find((b) => b.category === "battery") ?? null;
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
