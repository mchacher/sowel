import type { Device, EquipmentWithDetails } from "../../types";
import { findDataByCategory, findOrderByCategory } from "./bindingUtils";
import { currentLocale, formatTemperature } from "../../lib/format";
import { thermostatPowerStateBinding } from "../../lib/thermostat-state";

/**
 * Spec 196, slice 8a — one reading of an equipment's setpoint, shared by every
 * surface that shows or steps it (detail card, Maison row, dashboard tile and
 * sheet, mobile card).
 */

export const SETPOINT_STEP = 0.5;

export interface ResolvedSetpoint {
  /** The device's setpoint, null when unbound or not reported yet. */
  value: number | null;
  /** The order alias to send, null when the setpoint cannot be changed. */
  order: string | null;
  min: number;
  max: number;
  step: number;
}

type SetpointEquipment = Pick<EquipmentWithDetails, "type" | "dataBindings" | "orderBindings">;

/**
 * A thermostat's setpoint is its core `setpoint` alias (spec 177: the core is
 * alias-based, and a vendor extra may carry a `setpoint` category of its own).
 * A pool heat pump is read category first, `pool_temperature_setpoint` before
 * the generic one, then the conventional alias (spec 110). Bounds come from the
 * order, else 16–30 °C (10–30 °C for the pool).
 */
export function resolveSetpoint(equipment: SetpointEquipment): ResolvedSetpoint {
  const isPool = equipment.type === "pool_heat_pump";
  const data = isPool
    ? findDataByCategory(
        equipment.dataBindings,
        ["pool_temperature_setpoint", "setpoint"],
        ["setpoint"],
      )
    : equipment.dataBindings.find((b) => b.alias === "setpoint");
  const order = isPool
    ? findOrderByCategory(
        equipment.orderBindings,
        ["set_pool_temperature_setpoint", "set_setpoint"],
        ["setpoint"],
      )
    : equipment.orderBindings.find((o) => o.alias === "setpoint");
  return {
    value: typeof data?.value === "number" ? data.value : null,
    order: order?.alias ?? null,
    min: order?.min ?? (isPool ? 10 : 16),
    max: order?.max ?? 30,
    step: SETPOINT_STEP,
  };
}

/**
 * How full a thermometer is drawn for this setpoint, 0 at the minimum and 1 at
 * the maximum; nothing to draw without a value or with bounds that make no range
 * (an order declaring min = max would divide by zero).
 */
export function setpointLevel(value: number | null, min: number, max: number): number | undefined {
  if (value === null || !(max > min)) return undefined;
  return (value - min) / (max - min);
}

/**
 * The mobile card's state line: « 21,0° → 20,0° » (temperature, then the
 * setpoint), « 21,0° · arrêt » when the thermostat is off, the temperature
 * alone when there is no setpoint, « — → 20,0° » when the setpoint is known and
 * the temperature not (yet).
 */
export function setpointStateLine(
  temperature: number | null,
  setpoint: number | null,
  off: boolean,
  offLabel: string,
): string {
  const temp =
    temperature === null ? "\u2014" : formatTemperature(temperature, { style: "compact" });
  if (off) return `${temp} · ${offLabel.toLocaleLowerCase(currentLocale())}`;
  if (setpoint === null) return temp;
  return `${temp} → ${formatTemperature(setpoint, { style: "compact" })}`;
}

/**
 * True only when the equipment SAYS it is off: a thermostat's run state reads
 * false, a pool heat pump's mode reads OFF. One with no run state at all is
 * not taken for off.
 */
export function setpointOwnerIsOff(
  equipment: Pick<EquipmentWithDetails, "type" | "dataBindings">,
): boolean {
  if (equipment.type === "pool_heat_pump") {
    const mode = equipment.dataBindings.find((b) => b.alias === "mode")?.value;
    return typeof mode === "string" && mode.toUpperCase() === "OFF";
  }
  return thermostatPowerStateBinding(equipment.dataBindings)?.value === false;
}

/**
 * Bounds of a zone's "all thermostats" setpoint: the lowest minimum and the
 * highest maximum of the thermostats it drives.
 */
export function zoneSetpointBounds(equipments: readonly SetpointEquipment[]): {
  min: number;
  max: number;
} {
  const resolved = equipments.map(resolveSetpoint).filter((s) => s.order !== null);
  if (resolved.length === 0) return { min: 16, max: 30 };
  return {
    min: Math.min(...resolved.map((s) => s.min)),
    max: Math.max(...resolved.map((s) => s.max)),
  };
}

// ============================================================
// Commit delay (decision pr8-envoi, amended by the maintainer)
// ============================================================

/** A cloud API takes one value per poll and counts every request. */
export const CLOUD_COMMIT_DELAY_MS = 600;
/** A device on the local network answers at once: wait only for a burst of taps. */
export const LOCAL_COMMIT_DELAY_MS = 150;

/**
 * Integrations that reach their devices through the vendor's cloud. Sowel has
 * no cloud/local flag in its plugin metadata: the only related notion is the
 * integration's `polling` info, which is admin-only and does not mean cloud
 * (the Modbus pool heat pump and NUT poll on the local network). So the list
 * is explicit, by integration id, and a plugin missing from it is local.
 */
export const CLOUD_INTEGRATIONS: ReadonlySet<string> = new Set([
  "panasonic_cc",
  "mcz_maestro",
  "legrand_control",
  "legrand_energy",
  "netatmo_weather",
  "netatmo_camera",
  "smartthings",
  "renault",
  "weather-forecast",
]);

type DeviceIndex = Readonly<Record<string, Pick<Device, "integrationId">>>;

/**
 * How long a stepper waits after the last tap before it sends the one order.
 * Cloud when any device behind the equipment's orders is cloud-bound, or when a
 * device is not known yet (the safe side for a rate-limited API); local
 * otherwise. Accepts several equipments for a zone command.
 */
type OrderSource = Pick<EquipmentWithDetails, "orderBindings">;

export function setpointCommitDelay(
  equipment: OrderSource | readonly OrderSource[],
  devices: DeviceIndex,
): number {
  const list: readonly OrderSource[] = "orderBindings" in equipment ? [equipment] : equipment;
  const deviceIds = new Set(list.flatMap((eq) => eq.orderBindings.map((o) => o.deviceId)));
  if (deviceIds.size === 0) return CLOUD_COMMIT_DELAY_MS;
  for (const id of deviceIds) {
    const integrationId = devices[id]?.integrationId;
    if (integrationId === undefined || CLOUD_INTEGRATIONS.has(integrationId)) {
      return CLOUD_COMMIT_DELAY_MS;
    }
  }
  return LOCAL_COMMIT_DELAY_MS;
}
