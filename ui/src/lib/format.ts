/**
 * Format a timestamp as hh:mm:ss (24h local time).
 */
export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  // SQLite timestamps lack timezone suffix — treat as UTC
  const normalized = iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`;
  const date = new Date(normalized);
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Format a timestamp as relative time ("2 min ago") or absolute ("Feb 16, 14:30").
 * Uses relative for timestamps less than 24h old, absolute otherwise.
 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";

  // SQLite timestamps lack timezone suffix — treat as UTC
  const normalized = iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`;
  const date = new Date(normalized);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return "just now";
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins} min ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000);
    const mins = Math.floor((diffMs % 3_600_000) / 60_000);
    return mins > 0 ? `${hours}h${mins.toString().padStart(2, "0")} ago` : `${hours}h ago`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Format a data value for display.
 * Returns "—" for null/undefined, formats numbers, booleans, etc.
 */
export function formatDataValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "number") {
    const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
    return unit ? `${formatted}${unit}` : formatted;
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Format just the numeric part (without unit) for large display.
 */
export function formatDataValueRaw(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(1);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Get display label for a DataCategory.
 */
export function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    motion: "Motion",
    temperature: "Temperature",
    humidity: "Humidity",
    pressure: "Pressure",
    luminosity: "Luminosity",
    contact_door: "Door",
    contact_window: "Window",
    light_state: "Light",
    light_brightness: "Brightness",
    light_color_temp: "Color Temp",
    light_color: "Color",
    shutter_position: "Shutter",
    lock_state: "Lock",
    battery: "Battery",
    power: "Power",
    energy: "Energy",
    voltage: "Voltage",
    current: "Current",
    water_leak: "Water Leak",
    smoke: "Smoke",
    co2: "CO₂",
    voc: "VOC",
    generic: "Generic",
  };
  return labels[category] ?? category;
}

/**
 * Get source badge text.
 */
export function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    zigbee2mqtt: "Z2M",
    tasmota: "Tasmota",
    esphome: "ESPHome",
    shelly: "Shelly",
    custom_mqtt: "MQTT",
    panasonic_cc: "Panasonic",
    mcz_maestro: "MCZ",
    netatmo_hc: "Legrand",
  };
  return labels[source] ?? source;
}
