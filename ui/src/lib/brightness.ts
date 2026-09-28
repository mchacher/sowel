/**
 * Brightness scale of a dimmer, from its declared order (issue #933).
 *
 * `DeviceOrder` carries `min` / `max` precisely so a scale is a property of
 * the device, not of the protocol that happened to come first. Zigbee's
 * 0–254 is only the fallback for an order that declares nothing (Legrand,
 * for one, declares 0–100).
 */
export interface BrightnessScale {
  min: number;
  max: number;
}

export const ZIGBEE_BRIGHTNESS_SCALE: BrightnessScale = { min: 0, max: 254 };

export function brightnessScale(order?: { min?: number; max?: number } | null): BrightnessScale {
  const min = Number.isFinite(order?.min) ? (order!.min as number) : ZIGBEE_BRIGHTNESS_SCALE.min;
  const max = Number.isFinite(order?.max) ? (order!.max as number) : ZIGBEE_BRIGHTNESS_SCALE.max;
  // A degenerate declaration would divide by zero: fall back to the default.
  return max > min ? { min, max } : ZIGBEE_BRIGHTNESS_SCALE;
}

/** 0–100, clamped, for a raw value on the given scale. */
export function brightnessPercent(value: number, scale: BrightnessScale): number {
  const pct = ((value - scale.min) / (scale.max - scale.min)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}
