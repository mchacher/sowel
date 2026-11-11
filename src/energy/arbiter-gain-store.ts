import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";

// Spec 200 — persistence for the arbiter gain meter. Same never-throw contract
// as ArbiterMetricsStore (spec 158): a DB failure is logged and the caller
// carries on. Nothing here is on the arbitration path.
//
// Spec 202 — the gain is booked in Wh, peak and off-peak, and priced at read
// time with the tariff version of the row's day. `avoidedEur` holds what was
// booked in euros before migration 044 and is no longer added to.

/** One load's gain over one local day. */
export interface ArbiterGainRow {
  day: string; // local YYYY-MM-DD
  equipmentId: string;
  /** All the solar energy used, Wh. */
  solarWh: number;
  /** Its part booked since spec 202, split by tariff period, Wh. */
  solarHpWh: number;
  solarHcWh: number;
  /** € booked before spec 202. */
  avoidedEur: number;
}

interface GainRow {
  day: string;
  equipment_id: string;
  solar_wh: number;
  solar_hp_wh: number;
  solar_hc_wh: number;
  avoided_eur: number;
}

export class ArbiterGainStore {
  private logger: Logger;
  private readStmt: Database.Statement;
  private writeRows: (rows: ArbiterGainRow[]) => void;

  constructor(db: Database.Database, logger: Logger) {
    this.logger = logger.child({ module: "arbiter-gain-store" });
    const addStmt = db.prepare(
      `INSERT INTO arbiter_daily_gain
         (day, equipment_id, solar_wh, solar_hp_wh, solar_hc_wh, avoided_eur)
       VALUES (@day, @equipmentId, @solarWh, @solarHpWh, @solarHcWh, @avoidedEur)
       ON CONFLICT(day, equipment_id) DO UPDATE SET
         solar_wh = solar_wh + excluded.solar_wh,
         solar_hp_wh = solar_hp_wh + excluded.solar_hp_wh,
         solar_hc_wh = solar_hc_wh + excluded.solar_hc_wh,
         avoided_eur = avoided_eur + excluded.avoided_eur`,
    );
    this.readStmt = db.prepare(
      "SELECT day, equipment_id, solar_wh, solar_hp_wh, solar_hc_wh, avoided_eur" +
        " FROM arbiter_daily_gain" +
        " WHERE day >= ? AND day <= ? ORDER BY day ASC, equipment_id ASC",
    );
    // One transaction per flush: one commit, one fsync every 15 minutes.
    this.writeRows = db.transaction((rows: ArbiterGainRow[]) => {
      for (const row of rows) addStmt.run(row);
    });
  }

  /** Add the rows to what each (day, load) already holds. NEVER throws. */
  add(rows: ArbiterGainRow[]): boolean {
    if (rows.length === 0) return true;
    try {
      this.writeRows(rows);
      return true;
    } catch (err) {
      this.logger.error({ err, rows: rows.length }, "Failed to persist arbiter gain");
      return false;
    }
  }

  /** Rows in [from, to] (inclusive, YYYY-MM-DD). NEVER throws. */
  range(from: string, to: string): ArbiterGainRow[] {
    try {
      const rows = this.readStmt.all(from, to) as GainRow[];
      return rows.map((r) => ({
        day: r.day,
        equipmentId: r.equipment_id,
        solarWh: r.solar_wh,
        solarHpWh: r.solar_hp_wh,
        solarHcWh: r.solar_hc_wh,
        avoidedEur: r.avoided_eur,
      }));
    } catch (err) {
      this.logger.error({ err, from, to }, "Failed to read arbiter gain");
      return [];
    }
  }
}
