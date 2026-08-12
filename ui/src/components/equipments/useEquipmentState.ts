import type { EquipmentWithDetails } from "../../types";
import { TYPE_ICONS } from "./EquipmentCard";
import { ShutterIcon } from "../icons/ShutterIcons";
import { AwningIcon } from "../icons/AwningIcon";
import {
  getSensorIcon,
  getSensorIconColor,
  getSensorBindings,
  getAllBatteryBindings,
} from "./sensorUtils";
import { findDataByCategory, findOrderByCategory } from "./bindingUtils";
import { useWebSocket } from "../../store/useWebSocket";

export function useEquipmentState(equipment: EquipmentWithDetails) {
  // Classification
  const isLight =
    equipment.type === "light_onoff" ||
    equipment.type === "light_dimmable" ||
    equipment.type === "light_color";
  const isShutter = equipment.type === "shutter";
  const isAwning = equipment.type === "awning";
  // Shutter-family equipments share the same control surface (position +
  // open/stop/close). The vocabulary differs (extend/retract), but the wiring
  // is identical, so most existing logic gates on `isShutter || isAwning`.
  const isShutterFamily = isShutter || isAwning;
  const isWeatherForecast = equipment.type === "weather_forecast";
  const isSensor = equipment.type === "sensor" || equipment.type === "button" || equipment.type === "weather";
  const isEnergyMeter = equipment.type === "energy_meter" || equipment.type === "main_energy_meter" || equipment.type === "energy_production_meter";
  const isThermostat = equipment.type === "thermostat";
  const isHeater = equipment.type === "heater";
  const isGate = equipment.type === "gate";
  const isMediaPlayer = equipment.type === "media_player";
  const isAppliance = equipment.type === "appliance";
  const isWaterValve = equipment.type === "water_valve";
  const isPoolPump = equipment.type === "pool_pump";
  const isPoolCover = equipment.type === "pool_cover";
  const isPoolHeatPump = equipment.type === "pool_heat_pump";
  // A switch (smart plug) is an ON/OFF relay: same control surface as a light
  // (toggle + light_state indicator), but kept as its own flag so it isn't
  // styled with the light "glow" tint.
  const isSwitch = equipment.type === "switch";
  // Spec 135 — water heater: an on/off relay, driven exactly like a switch
  // (light_state indicator + boolean/enum toggle), plus an optional water
  // temperature. Kept as its own flag for icon/label/temperature handling.
  const isWaterHeater = equipment.type === "water_heater";

  // State binding — `light_state` is the canonical ON/OFF data category
  // used by lights, heaters, switches, valves and pool pumps (plugins emit
  // it for any "relay-style" data). Gate and cover have their own dedicated
  // lookups below because their value space is "open"/"closed" rather than
  // ON/OFF. Spec 110.
  const stateBinding = findDataByCategory(
    equipment.dataBindings,
    ["light_state"],
    ["state"],
  );
  const powerBinding = isThermostat
    ? equipment.dataBindings.find((db) => db.alias === "power")
    : null;
  const modeBinding = isPoolHeatPump
    ? equipment.dataBindings.find((db) => db.alias === "mode")
    : null;
  const isOn = isThermostat
    ? powerBinding?.value === true
    : isPoolHeatPump
      ? typeof modeBinding?.value === "string" && modeBinding.value.toUpperCase() !== "OFF"
      : stateBinding
        ? stateBinding.value === true || stateBinding.value === "ON"
        : false;

  // Shutter family (shutter + awning)
  const shutterPositionBinding = isShutterFamily
    ? equipment.dataBindings.find((db) => db.category === "shutter_position")
    : null;
  const shutterPosition =
    shutterPositionBinding && typeof shutterPositionBinding.value === "number"
      ? shutterPositionBinding.value
      : null;
  // Category-first so manually-rebound shutters (alias = device key) keep
  // their controls visible across compact zone view, equipment card and
  // detail page (spec 110).
  const hasShutterState =
    isShutterFamily &&
    !!findOrderByCategory(
      equipment.orderBindings,
      ["shutter_move", "pool_cover_move"],
      ["state"],
      [/^shutter\d*_state$/],
    );
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

  // Spec 143 — an active low-battery alert on any device this equipment binds.
  // Matching on the device, not on a battery binding: an equipment bound only to
  // its sensor's temperature still has to warn about that sensor's cell.
  const batteryAlerts = useWebSocket((s) => s.batteryAlerts);
  const batteryAlert =
    batteryAlerts.find((a) => equipment.dataBindings.some((b) => b.deviceId === a.deviceId)) ??
    null;
  const actionBinding =
    equipment.type === "button"
      ? equipment.dataBindings.find((b) => b.category === "action")
      : null;

  // Icon — shutters and awnings render their own state-aware illustration
  // (slats lowered for shutters, canopy deployed/retracted for awnings).
  const iconElement: React.ReactNode = isSensor
    ? getSensorIcon(equipment.dataBindings)
    : isShutter
      ? ShutterIcon({ size: 18, strokeWidth: 1.5, position: shutterPosition })
      : isAwning
        ? AwningIcon({ size: 22, state: shutterIsOpen ? "open" : "closed" })
        : TYPE_ICONS[equipment.type];

  // Gate state for icon color
  const gateStateBinding = isGate
    ? equipment.dataBindings.find((db) => db.alias === "state" && db.category === "gate_state")
    : null;
  const gateIsOpen = gateStateBinding?.value === "open";

  const iconColor = isMediaPlayer
    ? isOn
      ? "bg-primary/10 text-primary"
      : "bg-border-light text-text-tertiary"
    : isAppliance
    ? isOn
      ? "bg-accent/10 text-accent"
      : "bg-border-light text-text-tertiary"
    : isEnergyMeter
    ? "bg-accent/10 text-accent"
    : isSensor
    ? getSensorIconColor(equipment.dataBindings)
    : isThermostat || isPoolHeatPump
      ? isOn
        ? "bg-error/10 text-error"
        : "bg-border-light text-text-tertiary"
      : isHeater
        ? !isOn // fil pilote: relay OFF = comfort (warm)
          ? "bg-error/10 text-error"
          : "bg-border-light text-text-tertiary"
      : isShutterFamily
        ? shutterIsOpen
          ? "bg-primary/10 text-primary"
          : "bg-border-light text-text-tertiary"
        : isGate
          ? gateIsOpen
            ? "bg-primary/10 text-primary"
            : "bg-border-light text-text-tertiary"
          : isLight && isOn
            ? "bg-active/15 text-active-text"
            : isOn
              ? "bg-primary/10 text-primary"
              : "bg-border-light text-text-tertiary";

  return {
    isLight,
    isShutter,
    isAwning,
    isShutterFamily,
    isSensor,
    isWeatherForecast,
    isEnergyMeter,
    isThermostat,
    isHeater,
    isGate,
    isMediaPlayer,
    isAppliance,
    isWaterValve,
    isPoolPump,
    isPoolCover,
    isPoolHeatPump,
    isSwitch,
    isWaterHeater,
    stateBinding,
    isOn,
    shutterPosition,
    hasShutterState,
    shutterIsOpen,
    sensorBindings,
    batteryBindings,
    batteryBinding,
    batteryLevel,
    batteryAlert,
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

/** Format elapsed seconds as compact string (45s, 2m30s, 1h05, 3j). */
export function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600)
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h${String(m).padStart(2, "0")}`;
  }
  return `${Math.floor(s / 86400)}j`;
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
