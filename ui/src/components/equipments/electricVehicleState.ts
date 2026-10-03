/**
 * Spec 183 — one reader of an electric vehicle's state for every surface
 * (zone card, widgets, detail control). Category first, then contract alias;
 * anything absent is null and its element is not drawn.
 *
 * Kept apart from the components (react-refresh, and unit-tested: the project
 * does not test React components).
 */

import {
  ELECTRIC_VEHICLE_ALIASES as A,
  EV_AT_HOME_CATEGORY,
  EV_BATTERY_LEVEL_CATEGORY,
  EV_CHARGE_LIMIT_CATEGORY,
  EV_CHARGE_LIMIT_FALLBACK,
  EV_CHARGE_START_CATEGORY,
  EV_CHARGING_STATE_CATEGORY,
  EV_MILEAGE_CATEGORY,
  EV_PLUGGED_CATEGORY,
  EV_RANGE_CATEGORY,
  EV_REFRESH_CATEGORY,
  EV_REPORTED_AT_CATEGORY,
  EV_REPORT_STALE_MS,
  EV_WAKE_CATEGORY,
  SET_EV_CHARGE_LIMIT_CATEGORY,
  isEvChargingState,
  type EvChargingState,
} from "../../lib/electric-vehicle-contract";
import type {
  DataBindingWithValue,
  EquipmentWithDetails,
  OrderBindingWithDetails,
} from "../../types";

export interface EvChargeLimitOrder {
  alias: string;
  min: number;
  max: number;
}

export interface ElectricVehicleState {
  batteryLevel: number | null;
  rangeKm: number | null;
  plugged: boolean | null;
  chargingState: EvChargingState | null;
  atHome: boolean | null;
  mileageKm: number | null;
  chargeLimit: number | null;
  /** When the car itself last reported (ISO), else the binding's own update time. */
  reportedAt: string | null;
  /** The report is older than EV_REPORT_STALE_MS: surfaces show its age. */
  reportStale: boolean;
  wakeAlias: string | null;
  chargeStartAlias: string | null;
  /** Spec 184 — read the car's latest report now. */
  refreshAlias: string | null;
  chargeLimitOrder: EvChargeLimitOrder | null;
}

function findData(
  bindings: readonly DataBindingWithValue[],
  category: string,
  alias: string,
): DataBindingWithValue | undefined {
  return bindings.find((b) => b.category === category) ?? bindings.find((b) => b.alias === alias);
}

function findOrder(
  bindings: readonly OrderBindingWithDetails[],
  category: string,
  alias: string,
): OrderBindingWithDetails | undefined {
  return bindings.find((b) => b.category === category) ?? bindings.find((b) => b.alias === alias);
}

function num(b: DataBindingWithValue | undefined): number | null {
  const v = b?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(b: DataBindingWithValue | undefined): boolean | null {
  const v = b?.value;
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "true" || v === "ON") return true;
  if (v === 0 || v === "false" || v === "OFF") return false;
  return null;
}

function isoTime(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
}

export function electricVehicleStateOf(
  equipment: EquipmentWithDetails,
  now: number = Date.now(),
): ElectricVehicleState {
  const data = equipment.dataBindings;
  const orders = equipment.orderBindings;

  const battery = findData(data, EV_BATTERY_LEVEL_CATEGORY, A.batteryLevel);
  const stateRaw = findData(data, EV_CHARGING_STATE_CATEGORY, A.chargingState)?.value;
  const reportedAt =
    isoTime(findData(data, EV_REPORTED_AT_CATEGORY, A.reportedAt)?.value) ??
    isoTime(battery?.lastUpdated);

  const limitOrder = findOrder(orders, SET_EV_CHARGE_LIMIT_CATEGORY, A.chargeLimit);

  return {
    batteryLevel: num(battery),
    rangeKm: num(findData(data, EV_RANGE_CATEGORY, A.range)),
    plugged: bool(findData(data, EV_PLUGGED_CATEGORY, A.plugged)),
    chargingState: isEvChargingState(stateRaw) ? stateRaw : null,
    atHome: bool(findData(data, EV_AT_HOME_CATEGORY, A.atHome)),
    mileageKm: num(findData(data, EV_MILEAGE_CATEGORY, A.mileage)),
    chargeLimit: num(findData(data, EV_CHARGE_LIMIT_CATEGORY, A.chargeLimit)),
    reportedAt,
    reportStale: reportedAt !== null && now - Date.parse(reportedAt) > EV_REPORT_STALE_MS,
    wakeAlias: findOrder(orders, EV_WAKE_CATEGORY, A.wake)?.alias ?? null,
    chargeStartAlias: findOrder(orders, EV_CHARGE_START_CATEGORY, A.chargeStart)?.alias ?? null,
    refreshAlias: findOrder(orders, EV_REFRESH_CATEGORY, A.refresh)?.alias ?? null,
    chargeLimitOrder:
      limitOrder && limitOrder.type === "number"
        ? {
            alias: limitOrder.alias,
            min: limitOrder.min ?? EV_CHARGE_LIMIT_FALLBACK.min,
            max: limitOrder.max ?? EV_CHARGE_LIMIT_FALLBACK.max,
          }
        : null,
  };
}

/** i18n key of a charging state. */
export function evChargingStateKey(state: EvChargingState): string {
  return `equipments.electricVehicle.state.${state}`;
}

/** Battery bar colour: low, medium, comfortable. */
export function evBatteryTone(level: number): string {
  return level < 20 ? "bg-error" : level < 50 ? "bg-accent" : "bg-success";
}
