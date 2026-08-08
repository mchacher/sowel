import type { OrderWireValue } from "./types";

/**
 * Wire-value resolution for boolean orders (issue #360).
 *
 * Integrations may declare `valueOn` / `valueOff` on a device order — the
 * wire representations the device actually accepts (e.g. Zigbee2MQTT binary
 * exposes expect "ON"/"OFF", some locks expect "LOCK"/"UNLOCK"). When both
 * are declared, the dispatcher maps boolean-ish order values onto them so
 * callers can send the boolean the order type advertises. Orders without
 * declared wire values are dispatched untouched.
 */
export function resolveWireValue(
  value: unknown,
  valueOn: OrderWireValue | undefined,
  valueOff: OrderWireValue | undefined,
): unknown {
  if (valueOn === undefined || valueOff === undefined) return value;
  const on = coerceOnOff(value, valueOn, valueOff);
  if (on === undefined) return value;
  return on ? valueOn : valueOff;
}

function coerceOnOff(
  value: unknown,
  valueOn: OrderWireValue,
  valueOff: OrderWireValue,
): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === valueOn) return true;
  if (value === valueOff) return false;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (typeof valueOn === "string" && s === valueOn.toLowerCase()) return true;
    if (typeof valueOff === "string" && s === valueOff.toLowerCase()) return false;
    if (s === "on" || s === "true" || s === "1") return true;
    if (s === "off" || s === "false" || s === "0") return false;
    return undefined;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  return undefined;
}

/** Parse a JSON-encoded wire value column (value_on / value_off). */
export function parseWireValue(raw: string | null | undefined): OrderWireValue | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
      return parsed;
    }
    return undefined;
  } catch {
    // Legacy/unencoded values are treated as plain strings.
    return raw;
  }
}
