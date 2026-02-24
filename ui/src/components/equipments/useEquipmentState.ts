import type { EquipmentWithDetails } from "../../types";
import { TYPE_ICONS } from "./EquipmentCard";
import { ShutterIcon } from "../icons/ShutterIcons";
import {
  getSensorIcon,
  getSensorIconColor,
  getSensorBindings,
  getBatteryBinding,
  getAllBatteryBindings,
} from "./sensorUtils";

export function useEquipmentState(equipment: EquipmentWithDetails) {
  // Classification
  const isLight =
    equipment.type === "light_onoff" ||
    equipment.type === "light_dimmable" ||
    equipment.type === "light_color";
  const isShutter = equipment.type === "shutter";
  const isSensor = equipment.type === "sensor" || equipment.type === "button" || equipment.type === "weather";
  const isThermostat = equipment.type === "thermostat";

  // State binding
  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state",
  );
  const powerBinding = isThermostat
    ? equipment.dataBindings.find((db) => db.alias === "power")
    : null;
  const isOn = isThermostat
    ? powerBinding?.value === true
    : stateBinding
      ? stateBinding.value === true || stateBinding.value === "ON"
      : false;

  // Shutter
  const shutterPositionBinding = isShutter
    ? equipment.dataBindings.find((db) => db.category === "shutter_position")
    : null;
  const shutterPosition =
    shutterPositionBinding && typeof shutterPositionBinding.value === "number"
      ? shutterPositionBinding.value
      : null;
  const hasShutterState =
    isShutter && equipment.orderBindings.some((ob) => ob.alias === "state");
  const shutterIsOpen = shutterPosition !== null && shutterPosition > 0;

  // Sensor / Button
  const sensorBindings = isSensor
    ? getSensorBindings(equipment.dataBindings)
    : [];
  const batteryBindings = isSensor
    ? getAllBatteryBindings(equipment.dataBindings)
    : [];
  const batteryBinding = batteryBindings[0] ?? null;
  const batteryLevel =
    batteryBinding && typeof batteryBinding.value === "number"
      ? batteryBinding.value
      : null;
  const actionBinding =
    equipment.type === "button"
      ? equipment.dataBindings.find((b) => b.category === "action")
      : null;

  // Icon
  const iconElement: React.ReactNode = isSensor
    ? getSensorIcon(equipment.dataBindings)
    : isShutter
      ? ShutterIcon({ size: 18, strokeWidth: 1.5, position: shutterPosition })
      : TYPE_ICONS[equipment.type];

  const iconColor = isSensor
    ? getSensorIconColor(equipment.dataBindings)
    : isThermostat
      ? isOn
        ? "bg-blue-500/10 text-blue-500"
        : "bg-border-light text-text-tertiary"
      : isShutter
        ? shutterIsOpen
          ? "bg-primary/10 text-primary"
          : "bg-border-light text-text-tertiary"
        : isLight && isOn
          ? "bg-amber-400/15 text-amber-500"
          : isOn
            ? "bg-primary/10 text-primary"
            : "bg-border-light text-text-tertiary";

  return {
    isLight,
    isShutter,
    isSensor,
    isThermostat,
    stateBinding,
    isOn,
    shutterPosition,
    hasShutterState,
    shutterIsOpen,
    sensorBindings,
    batteryBindings,
    batteryBinding,
    batteryLevel,
    actionBinding,
    iconElement,
    iconColor,
  };
}

/** Compute elapsed seconds from an ISO timestamp. */
export function computeElapsed(iso: string | null): number {
  if (!iso) return 0;
  const ts = iso.endsWith("Z") ? iso : `${iso}Z`;
  return Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
}

/** Format elapsed seconds as compact string (45s, 2m30s, 1h05). */
export function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600)
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** Format a data value for inline display. */
export function formatValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "number") {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return unit ? `${formatted}${unit}` : formatted;
  }
  return String(value);
}
