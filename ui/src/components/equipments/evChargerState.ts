/**
 * Spec 182 — one reader of an EV charger's state for every surface (zone
 * card, widgets, detail control). Points are found by CATEGORY first, then by
 * contract alias, so a charger bound before or outside the contract still
 * reads; anything absent is null and its surface element is simply not drawn.
 *
 * Kept apart from the components (react-refresh, and so it is unit-tested:
 * the project does not test React components).
 */

import {
  EV_CHARGER_ALIASES,
  EV_CHARGE_CURRENT_CATEGORY,
  EV_CHARGE_CURRENT_FALLBACK,
  EV_SESSION_ENERGY_CATEGORY,
  EV_VEHICLE_STATE_CATEGORY,
  SET_EV_CHARGE_CURRENT_CATEGORY,
  isEvVehicleState,
  type EvVehicleState,
} from "../../lib/ev-charger-contract";
import { resolvePowerReading, type PowerReading } from "../../lib/power-reading";
import type {
  DataBindingWithValue,
  EquipmentWithDetails,
  OrderBindingWithDetails,
} from "../../types";

export interface EvChargeCurrentOrder {
  alias: string;
  min: number;
  max: number;
}

export interface EvChargerState {
  /** Charging enabled (the `state` reading); null when unbound or unreadable. */
  on: boolean | null;
  /** The start/stop order is bound. */
  canToggle: boolean;
  vehicle: EvVehicleState | null;
  /** Live power, judged for freshness (a silent charger does not read as 0 W). */
  power: PowerReading;
  sessionEnergyKwh: number | null;
  /** The current the charger is set to deliver (A). */
  chargeCurrentA: number | null;
  /** The order that sets it, with its bounds (fallback 6–32 A). */
  chargeCurrentOrder: EvChargeCurrentOrder | null;
  measuredCurrentA: number | null;
  voltageV: number | null;
}

function findData(
  bindings: readonly DataBindingWithValue[],
  categories: readonly string[],
  alias: string,
): DataBindingWithValue | undefined {
  return (
    bindings.find((b) => b.category !== undefined && categories.includes(b.category)) ??
    bindings.find((b) => b.alias === alias)
  );
}

function findOrder(
  bindings: readonly OrderBindingWithDetails[],
  categories: readonly string[],
  alias: string,
): OrderBindingWithDetails | undefined {
  return (
    bindings.find((b) => b.category !== undefined && categories.includes(b.category)) ??
    bindings.find((b) => b.alias === alias)
  );
}

function numberOf(binding: DataBindingWithValue | undefined): number | null {
  const v = binding?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function onOf(binding: DataBindingWithValue | undefined): boolean | null {
  const v = binding?.value;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^on$/i.test(v)) return true;
    if (/^off$/i.test(v)) return false;
  }
  return null;
}

export function evChargerStateOf(equipment: EquipmentWithDetails): EvChargerState {
  const data = equipment.dataBindings;
  const orders = equipment.orderBindings;

  const stateData = findData(data, ["appliance_state", "light_state"], EV_CHARGER_ALIASES.state);
  const toggle = findOrder(orders, ["toggle_power", "light_toggle"], EV_CHARGER_ALIASES.state);
  const vehicleRaw = findData(data, [EV_VEHICLE_STATE_CATEGORY], EV_CHARGER_ALIASES.vehicle)?.value;
  const powerBinding = findData(data, ["power"], EV_CHARGER_ALIASES.power);

  const currentOrder = findOrder(
    orders,
    [SET_EV_CHARGE_CURRENT_CATEGORY],
    EV_CHARGER_ALIASES.chargeCurrent,
  );
  const chargeCurrentOrder: EvChargeCurrentOrder | null =
    currentOrder && currentOrder.type === "number"
      ? {
          alias: currentOrder.alias,
          min: currentOrder.min ?? EV_CHARGE_CURRENT_FALLBACK.min,
          max: currentOrder.max ?? EV_CHARGE_CURRENT_FALLBACK.max,
        }
      : null;

  return {
    on: onOf(stateData),
    canToggle: !!toggle,
    vehicle: isEvVehicleState(vehicleRaw) ? vehicleRaw : null,
    power: resolvePowerReading(equipment, powerBinding),
    sessionEnergyKwh: numberOf(
      findData(data, [EV_SESSION_ENERGY_CATEGORY], EV_CHARGER_ALIASES.sessionEnergy),
    ),
    chargeCurrentA: numberOf(
      findData(data, [EV_CHARGE_CURRENT_CATEGORY], EV_CHARGER_ALIASES.chargeCurrent),
    ),
    chargeCurrentOrder,
    measuredCurrentA: numberOf(findData(data, ["current"], EV_CHARGER_ALIASES.current)),
    voltageV: numberOf(findData(data, ["voltage"], EV_CHARGER_ALIASES.voltage)),
  };
}

/** i18n key of a vehicle state. */
export function evVehicleKey(vehicle: EvVehicleState): string {
  return `equipments.evCharger.vehicle.${vehicle}`;
}

/** Pill tone per vehicle state: energy flowing, plugged in, nothing there. */
export function evVehiclePillClass(vehicle: EvVehicleState): string {
  return vehicle === "charging"
    ? "bg-accent/15 text-accent-hover"
    : vehicle === "connected"
      ? "bg-primary/10 text-primary"
      : "bg-border-light text-text-tertiary";
}

/** Clamp and round a requested current into the order's range. */
export function clampChargeCurrent(value: number, order: EvChargeCurrentOrder): number {
  return Math.min(order.max, Math.max(order.min, Math.round(value)));
}
