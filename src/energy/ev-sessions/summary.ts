/**
 * Spec 191 — what a session and a month show, derived from stored sums.
 *
 * Pure. A session stores the charger's meter (`energy_wh`, the truth) and the
 * 5-minute window estimates (`est_*`). The estimates give the shares; they are
 * scaled to the meter here, in one place, so the API and the summaries agree.
 */

import type {
  EvChargeSession,
  EvPer100kmUnavailable,
  EvVehicleMonthSummary,
} from "../../shared/types.js";

export interface SessionSums {
  energyWh: number;
  estCarWh: number;
  estGridHpWh: number;
  estGridHcWh: number;
  estCostHpEur: number | null;
  estCostHcEur: number | null;
}

export interface DerivedEnergy {
  energyWh: number;
  gridHpWh: number;
  gridHcWh: number;
  solarWh: number;
  costHpEur: number | null;
  costHcEur: number | null;
  costEur: number | null;
}

/** Scale the window estimates to the meter. */
export function deriveEnergy(s: SessionSums): DerivedEnergy {
  const energy = s.energyWh > 0 ? s.energyWh : s.estCarWh;
  if (s.estCarWh <= 0) {
    // Energy without any estimate: never invent solar.
    return {
      energyWh: energy,
      gridHpWh: energy,
      gridHcWh: 0,
      solarWh: 0,
      costHpEur: null,
      costHcEur: null,
      costEur: null,
    };
  }
  const k = energy / s.estCarWh;
  const gridHpWh = s.estGridHpWh * k;
  const gridHcWh = s.estGridHcWh * k;
  const costHpEur = s.estCostHpEur === null ? null : s.estCostHpEur * k;
  const costHcEur = s.estCostHcEur === null ? null : s.estCostHcEur * k;
  const costEur =
    costHpEur === null && costHcEur === null ? null : (costHpEur ?? 0) + (costHcEur ?? 0);
  return {
    energyWh: energy,
    gridHpWh,
    gridHcWh,
    solarWh: Math.max(0, energy - gridHpWh - gridHcWh),
    costHpEur,
    costHcEur,
    costEur,
  };
}

/** A home session must raise the battery by this much to teach the energy per point. */
export const LEARN_MIN_RISE_POINTS = 10;
export const LEARN_SESSIONS = 10;
export const MIN_MEASURED_KM = 50;

/**
 * Wall energy per battery point, from the most recent sessions first. Charging
 * losses are included, as they are in the cost.
 */
export function whPerBatteryPoint(
  sessions: Pick<EvChargeSession, "energyWh" | "batteryStart" | "batteryEnd">[],
): number | null {
  let energy = 0;
  let points = 0;
  let used = 0;
  for (const s of sessions) {
    if (used >= LEARN_SESSIONS) break;
    if (s.batteryStart === null || s.batteryEnd === null) continue;
    const rise = s.batteryEnd - s.batteryStart;
    if (rise < LEARN_MIN_RISE_POINTS || s.energyWh <= 0) continue;
    energy += s.energyWh;
    points += rise;
    used++;
  }
  return points > 0 ? energy / points : null;
}

/** The month of one vehicle (FR5). `sessions` are that vehicle's, in that month. */
export function monthSummary(input: {
  vehicleId: string;
  month: string;
  sessions: EvChargeSession[];
  plugInHybrid: boolean;
  whPerPoint: number | null;
  driving: { kmMeasured: number; batteryDrop: number };
}): EvVehicleMonthSummary {
  const sum = (pick: (s: EvChargeSession) => number) =>
    input.sessions.reduce((acc, s) => acc + pick(s), 0);
  const sumNullable = (pick: (s: EvChargeSession) => number | null) => {
    const values = input.sessions.map(pick).filter((v): v is number => v !== null);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };

  const energyWh = sum((s) => s.energyWh);
  const costHpEur = sumNullable((s) => s.costHpEur);
  const costHcEur = sumNullable((s) => s.costHcEur);
  const costEur =
    costHpEur === null && costHcEur === null ? null : (costHpEur ?? 0) + (costHcEur ?? 0);
  const homePrice = costEur !== null && energyWh > 0 ? costEur / (energyWh / 1000) : null;

  let unavailable: EvPer100kmUnavailable | null = null;
  let kWhPer100km: number | null = null;
  if (input.plugInHybrid) unavailable = "plug-in-hybrid";
  else if (input.sessions.length === 0 || homePrice === null) unavailable = "no-home-session";
  else if (input.whPerPoint === null) unavailable = "not-learned";
  else if (input.driving.kmMeasured < MIN_MEASURED_KM || input.driving.batteryDrop <= 0)
    unavailable = "too-few-km";
  else {
    kWhPer100km = (input.whPerPoint * input.driving.batteryDrop) / input.driving.kmMeasured / 10;
  }

  return {
    vehicleId: input.vehicleId,
    month: input.month,
    sessions: input.sessions.length,
    energyWh,
    gridHpWh: sum((s) => s.gridHpWh),
    gridHcWh: sum((s) => s.gridHcWh),
    solarWh: sum((s) => s.solarWh),
    costHpEur,
    costHcEur,
    costEur,
    homePriceEurPerKwh: homePrice,
    kWhPer100km,
    eurPer100km: kWhPer100km !== null && homePrice !== null ? kWhPer100km * homePrice : null,
    eurPer100kmUnavailable: unavailable,
  };
}
