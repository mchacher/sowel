/**
 * Spec 191 — persistence of charge sessions and driving legs (SQLite).
 *
 * The tracker owns the live state and saves a whole record at every change
 * (open, window closed, close, attribution). Reads derive the shown values in
 * `summary.ts`, so the API and the monthly summaries agree.
 */

import type Database from "better-sqlite3";
import type {
  EvChargeSession,
  EvSessionAttribution,
  EvSessionAttributionReason,
  TariffPrices,
} from "../../shared/types.js";
import { type VehicleEvidence, startBattery } from "./attribution.js";
import type { Leg, LegState } from "./driving.js";
import { deriveEnergy } from "./summary.js";

/** A session as stored: the meter, the window sums and the evidence. */
export interface SessionRecord {
  id: string;
  chargerId: string;
  chargerName: string;
  startedAt: string;
  endedAt: string | null;
  graceUntil: string | null;
  energyWh: number;
  estCarWh: number;
  estGridHpWh: number;
  estGridHcWh: number;
  estCostHpEur: number | null;
  estCostHcEur: number | null;
  vehicleId: string | null;
  vehicleName: string | null;
  vehicleDeleted: boolean;
  attribution: EvSessionAttribution;
  attributionSource: "auto" | "manual" | null;
  attributionReason: EvSessionAttributionReason | null;
  batteryStart: number | null;
  batteryEnd: number | null;
  evidence: VehicleEvidence[];
  updatedAt: string;
}

interface SessionRow {
  id: string;
  charger_id: string;
  charger_name: string;
  started_at: string;
  ended_at: string | null;
  grace_until: string | null;
  energy_wh: number;
  est_car_wh: number;
  est_grid_hp_wh: number;
  est_grid_hc_wh: number;
  est_cost_hp_eur: number | null;
  est_cost_hc_eur: number | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
  vehicle_deleted: number;
  attribution: EvSessionAttribution;
  attribution_source: "auto" | "manual" | null;
  attribution_reason: EvSessionAttributionReason | null;
  battery_start: number | null;
  battery_end: number | null;
  evidence: string | null;
  updated_at: string;
}

interface LegRow {
  vehicle_id: string;
  mileage_km: number;
  battery: number | null;
  min_battery: number | null;
  charged: number;
  at: string;
}

function parseEvidence(raw: string | null): VehicleEvidence[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VehicleEvidence[]) : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    chargerId: row.charger_id,
    chargerName: row.charger_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    graceUntil: row.grace_until,
    energyWh: row.energy_wh,
    estCarWh: row.est_car_wh,
    estGridHpWh: row.est_grid_hp_wh,
    estGridHcWh: row.est_grid_hc_wh,
    estCostHpEur: row.est_cost_hp_eur,
    estCostHcEur: row.est_cost_hc_eur,
    vehicleId: row.vehicle_id,
    vehicleName: row.vehicle_name,
    vehicleDeleted: row.vehicle_deleted === 1,
    attribution: row.attribution,
    attributionSource: row.attribution_source,
    attributionReason: row.attribution_reason,
    batteryStart: row.battery_start,
    batteryEnd: row.battery_end,
    evidence: parseEvidence(row.evidence),
    updatedAt: row.updated_at,
  };
}

/**
 * What the API and the UI see. `prices` are those in force when the session
 * started, null without a tariff (spec 202: the cost is a read-time value).
 */
export function toSession(r: SessionRecord, prices: TariffPrices | null): EvChargeSession {
  const d = deriveEnergy(r, prices);
  return {
    id: r.id,
    chargerId: r.chargerId,
    chargerName: r.chargerName,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    graceUntil: r.graceUntil,
    energyWh: d.energyWh,
    gridHpWh: d.gridHpWh,
    gridHcWh: d.gridHcWh,
    solarWh: d.solarWh,
    costHpEur: d.costHpEur,
    costHcEur: d.costHcEur,
    costEur: d.costEur,
    vehicleId: r.vehicleId,
    vehicleName: r.vehicleName,
    vehicleDeleted: r.vehicleDeleted,
    attribution: r.attribution,
    attributionSource: r.attributionSource,
    attributionReason: r.attributionReason,
    batteryStart: r.batteryStart,
    batteryEnd: r.batteryEnd,
    candidates: r.evidence.map((e) => ({
      vehicleId: e.vehicleId,
      chargingSeen: e.chargingSeen,
      batteryFrom: startBattery(e),
      batteryTo: e.maxBattery,
    })),
    updatedAt: r.updatedAt,
  };
}

export class EvSessionStore {
  private readonly stmts: ReturnType<EvSessionStore["prepare"]>;

  constructor(private readonly db: Database.Database) {
    this.stmts = this.prepare();
  }

  private prepare() {
    return {
      upsert: this.db.prepare(
        `INSERT INTO ev_charge_sessions
           (id, charger_id, charger_name, started_at, ended_at, grace_until, energy_wh,
            est_car_wh, est_grid_hp_wh, est_grid_hc_wh, est_cost_hp_eur, est_cost_hc_eur,
            vehicle_id, vehicle_name, vehicle_deleted, attribution, attribution_source,
            attribution_reason, battery_start, battery_end, evidence, updated_at)
         VALUES
           (@id, @chargerId, @chargerName, @startedAt, @endedAt, @graceUntil, @energyWh,
            @estCarWh, @estGridHpWh, @estGridHcWh, @estCostHpEur, @estCostHcEur,
            @vehicleId, @vehicleName, @vehicleDeleted, @attribution, @attributionSource,
            @attributionReason, @batteryStart, @batteryEnd, @evidence, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           charger_name = excluded.charger_name, ended_at = excluded.ended_at,
           grace_until = excluded.grace_until, energy_wh = excluded.energy_wh,
           est_car_wh = excluded.est_car_wh, est_grid_hp_wh = excluded.est_grid_hp_wh,
           est_grid_hc_wh = excluded.est_grid_hc_wh, est_cost_hp_eur = excluded.est_cost_hp_eur,
           est_cost_hc_eur = excluded.est_cost_hc_eur, vehicle_id = excluded.vehicle_id,
           vehicle_name = excluded.vehicle_name, vehicle_deleted = excluded.vehicle_deleted,
           attribution = excluded.attribution, attribution_source = excluded.attribution_source,
           attribution_reason = excluded.attribution_reason,
           battery_start = excluded.battery_start, battery_end = excluded.battery_end,
           evidence = excluded.evidence, updated_at = excluded.updated_at`,
      ),
      delete: this.db.prepare("DELETE FROM ev_charge_sessions WHERE id = ?"),
      byId: this.db.prepare("SELECT * FROM ev_charge_sessions WHERE id = ?"),
      open: this.db.prepare("SELECT * FROM ev_charge_sessions WHERE ended_at IS NULL"),
      pending: this.db.prepare(
        `SELECT * FROM ev_charge_sessions WHERE ended_at IS NOT NULL
          AND (attribution = 'pending' OR (attribution_source = 'manual' AND grace_until > ?))`,
      ),
      byCharger: this.db.prepare(
        `SELECT * FROM ev_charge_sessions
          WHERE charger_id = ? AND started_at >= ? AND started_at < ?
          ORDER BY started_at DESC`,
      ),
      byVehicle: this.db.prepare(
        `SELECT * FROM ev_charge_sessions
          WHERE vehicle_id = ? AND attribution = 'vehicle' AND vehicle_deleted = 0
            AND started_at >= ? AND started_at < ?
          ORDER BY started_at DESC`,
      ),
      meeting: this.db.prepare(
        `SELECT * FROM ev_charge_sessions
          WHERE id != ? AND started_at <= ? AND (ended_at IS NULL OR ended_at > ?)`,
      ),
      learning: this.db.prepare(
        `SELECT * FROM ev_charge_sessions
          WHERE vehicle_id = ? AND attribution = 'vehicle' AND ended_at IS NOT NULL
            AND battery_start IS NOT NULL AND battery_end IS NOT NULL
            AND (attribution_source = 'manual'
                 OR attribution_reason IN ('single-match', 'power-match', 'only-vehicle'))
          ORDER BY started_at DESC LIMIT 50`,
      ),
      markVehicleDeleted: this.db.prepare(
        "UPDATE ev_charge_sessions SET vehicle_deleted = 1, updated_at = ? WHERE vehicle_id = ?",
      ),
      legGet: this.db.prepare("SELECT * FROM ev_vehicle_leg_state WHERE vehicle_id = ?"),
      legSet: this.db.prepare(
        `INSERT INTO ev_vehicle_leg_state (vehicle_id, mileage_km, battery, min_battery, charged, at)
         VALUES (@vehicleId, @mileageKm, @battery, @minBattery, @charged, @at)
         ON CONFLICT(vehicle_id) DO UPDATE SET mileage_km = excluded.mileage_km,
           battery = excluded.battery, min_battery = excluded.min_battery,
           charged = excluded.charged, at = excluded.at`,
      ),
      legDelete: this.db.prepare("DELETE FROM ev_vehicle_leg_state WHERE vehicle_id = ?"),
      drivingAdd: this.db.prepare(
        `INSERT INTO ev_vehicle_daily_driving (vehicle_id, day, km_total, km_measured, battery_drop)
         VALUES (@vehicleId, @day, @kmTotal, @kmMeasured, @batteryDrop)
         ON CONFLICT(vehicle_id, day) DO UPDATE SET
           km_total = km_total + excluded.km_total,
           km_measured = km_measured + excluded.km_measured,
           battery_drop = battery_drop + excluded.battery_drop`,
      ),
      drivingSum: this.db.prepare(
        `SELECT COALESCE(SUM(km_total), 0) AS kmTotal, COALESCE(SUM(km_measured), 0) AS kmMeasured,
                COALESCE(SUM(battery_drop), 0) AS batteryDrop
           FROM ev_vehicle_daily_driving WHERE vehicle_id = ? AND day >= ? AND day < ?`,
      ),
    };
  }

  save(r: SessionRecord): void {
    this.stmts.upsert.run({
      ...r,
      vehicleDeleted: r.vehicleDeleted ? 1 : 0,
      evidence: r.evidence.length > 0 ? JSON.stringify(r.evidence) : null,
    });
  }

  delete(id: string): void {
    this.stmts.delete.run(id);
  }

  get(id: string): SessionRecord | null {
    const row = this.stmts.byId.get(id) as SessionRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  listOpen(): SessionRecord[] {
    return (this.stmts.open.all() as SessionRow[]).map(rowToRecord);
  }

  /**
   * Closed sessions still in their grace period: waiting for their automatic
   * attribution, or attributed by hand and still following the final battery.
   */
  listPending(nowIso: string): SessionRecord[] {
    return (this.stmts.pending.all(nowIso) as SessionRow[]).map(rowToRecord);
  }

  listByCharger(chargerId: string, fromIso: string, toIso: string): SessionRecord[] {
    return (this.stmts.byCharger.all(chargerId, fromIso, toIso) as SessionRow[]).map(rowToRecord);
  }

  /** A vehicle's attributed sessions (deleted vehicles count nowhere). */
  listByVehicle(vehicleId: string, fromIso: string, toIso: string): SessionRecord[] {
    return (this.stmts.byVehicle.all(vehicleId, fromIso, toIso) as SessionRow[]).map(rowToRecord);
  }

  /**
   * Issue #1105 — every other session, on any charger, whose time range meets
   * [fromIso, toIso] (one that starts at `toIso` too: it was there first).
   */
  listMeeting(excludeId: string, fromIso: string, toIso: string): SessionRecord[] {
    return (this.stmts.meeting.all(excludeId, toIso, fromIso) as SessionRow[]).map(rowToRecord);
  }

  /** The vehicle's sessions that may teach the energy per battery point, newest first. */
  listForLearning(vehicleId: string): SessionRecord[] {
    return (this.stmts.learning.all(vehicleId) as SessionRow[]).map(rowToRecord);
  }

  markVehicleDeleted(vehicleId: string, atIso: string): void {
    this.stmts.markVehicleDeleted.run(atIso, vehicleId);
  }

  getLeg(vehicleId: string): LegState | null {
    const row = this.stmts.legGet.get(vehicleId) as LegRow | undefined;
    if (!row) return null;
    return {
      mileageKm: row.mileage_km,
      battery: row.battery,
      minBattery: row.min_battery,
      charged: row.charged === 1,
      atMs: Date.parse(row.at),
    };
  }

  setLeg(vehicleId: string, s: LegState): void {
    this.stmts.legSet.run({
      vehicleId,
      mileageKm: s.mileageKm,
      battery: s.battery,
      minBattery: s.minBattery,
      charged: s.charged ? 1 : 0,
      at: new Date(s.atMs).toISOString(),
    });
  }

  deleteLeg(vehicleId: string): void {
    this.stmts.legDelete.run(vehicleId);
  }

  addDriving(vehicleId: string, day: string, leg: Leg): void {
    this.stmts.drivingAdd.run({ vehicleId, day, ...leg });
  }

  /** Σ driving between two local days, `toDay` excluded. */
  sumDriving(
    vehicleId: string,
    fromDay: string,
    toDay: string,
  ): { kmTotal: number; kmMeasured: number; batteryDrop: number } {
    return this.stmts.drivingSum.get(vehicleId, fromDay, toDay) as {
      kmTotal: number;
      kmMeasured: number;
      batteryDrop: number;
    };
  }
}
