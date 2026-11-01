/**
 * Spec 191 FR5 — how much battery a vehicle uses per km.
 *
 * Pure. A leg runs from one mileage reading to the next. Its km and the battery
 * points lost over them measure the consumption, unless the car charged on the
 * way (battery rose, or it said it was charging): that leg is left out, so
 * energy charged elsewhere never distorts the home cost per 100 km (P11).
 *
 * A reading with no km driven starts a new leg: a car parked and charged
 * between two readings must not spoil the next drive.
 */

import { BATTERY_RISE_POINTS } from "./attribution.js";

export interface LegState {
  mileageKm: number;
  /** Battery level at the leg start. */
  battery: number | null;
  /** Lowest level seen since the leg start. */
  minBattery: number | null;
  charged: boolean;
  atMs: number;
}

export interface Leg {
  kmTotal: number;
  kmMeasured: number;
  batteryDrop: number;
}

function startLeg(mileageKm: number, battery: number | null, atMs: number): LegState {
  return { mileageKm, battery, minBattery: battery, charged: false, atMs };
}

/** A battery reading during the leg. */
export function onBattery(state: LegState, battery: number): LegState {
  if (!Number.isFinite(battery)) return state;
  const min = state.minBattery === null ? battery : Math.min(state.minBattery, battery);
  const rose = state.minBattery !== null && battery >= state.minBattery + BATTERY_RISE_POINTS;
  return { ...state, minBattery: min, charged: state.charged || rose };
}

/** The car said it was charging. */
export function onCharging(state: LegState): LegState {
  return state.charged ? state : { ...state, charged: true };
}

/** A mileage reading: closes the leg in progress and starts the next one. */
export function onMileage(
  state: LegState | null,
  mileageKm: number,
  battery: number | null,
  atMs: number,
): { next: LegState; leg: Leg | null } {
  const next = startLeg(mileageKm, battery, atMs);
  if (state === null) return { next, leg: null };
  const km = mileageKm - state.mileageKm;
  if (!(km > 0)) return { next, leg: null };

  const measurable =
    !state.charged &&
    state.battery !== null &&
    battery !== null &&
    battery <= state.battery &&
    (state.minBattery === null || battery < state.minBattery + BATTERY_RISE_POINTS);
  return {
    next,
    leg: {
      kmTotal: km,
      kmMeasured: measurable ? km : 0,
      batteryDrop: measurable ? state.battery! - battery! : 0,
    },
  };
}
