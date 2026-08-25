/**
 * PV production forecaster (spec 160).
 *
 * The stateful half: reads the irradiance series a weather plugin publishes,
 * turns it into an expected-production curve through the pure modules next to
 * this file, exposes it as computed data and keeps it so forecast can later be
 * compared with what actually happened.
 *
 * Every arithmetic decision lives in `solar-geometry.ts` and `pv-model.ts`,
 * which are tested. What is here is timers, storage and wiring.
 */

import type Database from "better-sqlite3";
import { Point } from "@influxdata/influxdb-client";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { InfluxClient } from "../../core/influx-client.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { ComputedDataEntry, Equipment } from "../../shared/types.js";
import { planeOfArray, solarPosition, toDni, totalPeakWc } from "./solar-geometry.js";
import {
  MIN_SAMPLES,
  clearSkyEstimate,
  fitModel,
  predict,
  refitGainOnly,
  type PvModel,
  type PvSample,
} from "./pv-model.js";
import { isActiveSolarProfile } from "./solar-profile.js";

/** Days of production history the fit runs on. Measured: 45 beats all-history. */
export const WINDOW_DAYS = 45;

/**
 * Daylight hours needed after a declared capacity change before the gain is
 * re-estimated on the new array.
 *
 * Measured on a real +1 kW addition: two days of production took the hourly
 * error from 523 W to 264 W, three days to 253 W. Roughly two days of daylight.
 */
export const MIN_FRESH_SAMPLES = 24;

/**
 * Name of the device data point the weather plugin publishes the series under.
 *
 * Matched on the key rather than on a category: `solar_radiation` declares a
 * numeric contract in the core, so a json series filed under it would log a
 * contract warning at every discovery and be offered as a binding candidate.
 */
export const IRRADIANCE_DATA_POINT = "irradiance_120h";

interface IrradianceHour {
  t: string;
  direct: number | null;
  diffuse: number | null;
  temp: number | null;
}

interface IrradianceSeries {
  issuedAt?: string;
  hours: IrradianceHour[];
}

export interface ForecastPoint {
  /** UTC instant the hour starts. */
  at: string;
  watts: number;
}

interface ModelRow {
  equipment_id: string;
  gain: number;
  shape: string;
  fitted_at: string;
  samples: number;
  fitted_peak_wc: number;
  gain_reset_at: string | null;
}

export interface PvForecasterDeps {
  db: Database.Database;
  logger: Logger;
  eventBus: EventBus;
  influxClient: InfluxClient;
  deviceManager: DeviceManager;
  equipmentManager: EquipmentManager;
  settingsManager: SettingsManager;
}

export class PvForecaster {
  private readonly db: Database.Database;
  private readonly logger: Logger;
  private readonly eventBus: EventBus;
  private readonly influx: InfluxClient;
  private readonly devices: DeviceManager;
  private readonly equipments: EquipmentManager;
  private readonly settings: SettingsManager;

  /** equipmentId -> latest curve, kept in memory for the computed data. */
  private readonly curves = new Map<string, ForecastPoint[]>();
  /** equipmentId -> when the series behind that curve was issued (FR5). */
  private readonly issuedAt = new Map<string, string>();
  private unsubscribe: (() => void) | null = null;
  private refitTimer: ReturnType<typeof setTimeout> | null = null;
  private recomputeTimer: ReturnType<typeof setTimeout> | null = null;
  /** equipmentId -> readings accumulated for the hour currently open. */
  private readonly pending = new Map<
    string,
    { hourMs: number; watts: number[]; poa: number; tempC: number }
  >();

  constructor(deps: PvForecasterDeps) {
    this.db = deps.db;
    this.logger = deps.logger.child({ module: "pv-forecaster" });
    this.eventBus = deps.eventBus;
    this.influx = deps.influxClient;
    this.devices = deps.deviceManager;
    this.equipments = deps.equipmentManager;
    this.settings = deps.settingsManager;
  }

  start(): void {
    // The series arrives as ordinary device data, so a new poll is simply a
    // device.data.updated like any other.
    // Only the irradiance series matters here, and a plugin poll emits one
    // event per data key. Without the filter every Zigbee message in the house
    // would trigger a full recompute: 120 solar positions and 120 InfluxDB
    // writes, several times a second.
    this.unsubscribe = this.eventBus.onType("device.data.updated", (event) => {
      if (event.key !== IRRADIANCE_DATA_POINT) return;
      this.recomputeSoon();
    });
    this.scheduleRefit();
    this.recomputeAll();
    this.logger.info("PV forecaster started");
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.refitTimer) clearTimeout(this.refitTimer);
    this.refitTimer = null;
    if (this.recomputeTimer) clearTimeout(this.recomputeTimer);
    this.recomputeTimer = null;
    // Do not lose the hour in progress on a clean stop.
    for (const [equipmentId, bucket] of this.pending) this.closeHour(equipmentId, bucket);
    this.pending.clear();
  }

  /** Coalesce bursts: one recompute per settling window, never one per event. */
  private recomputeSoon(): void {
    if (this.recomputeTimer) clearTimeout(this.recomputeTimer);
    this.recomputeTimer = setTimeout(() => {
      this.recomputeTimer = null;
      try {
        this.recomputeAll();
      } catch (err) {
        this.logger.error({ err }, "Failed to recompute the PV forecast");
      }
    }, 2_000);
  }

  // ============================================================
  // Computed data
  // ============================================================

  getComputedDataForEquipment(equipmentId: string): ComputedDataEntry[] {
    const curve = this.curves.get(equipmentId);
    if (!curve || curve.length === 0) return [];

    const now = Date.now();
    const at = new Date().toISOString();
    const kwhBetween = (fromMs: number, toMs: number): number => {
      const wh = curve
        .filter((p) => {
          const ms = Date.parse(p.at);
          return ms >= fromMs && ms < toMs;
        })
        .reduce((sum, p) => sum + p.watts, 0);
      return Math.round(wh / 100) / 10;
    };

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    // setDate, not +86_400_000: on a DST changeover the local day is 23 or 25
    // hours, and a fixed millisecond day would push an hour into the wrong one
    // and disagree with the figure the panel prints from the same curve.
    const dayAfter = new Date(startOfDay);
    dayAfter.setDate(dayAfter.getDate() + 1);
    const twoDaysAfter = new Date(dayAfter);
    twoDaysAfter.setDate(twoDaysAfter.getDate() + 1);

    return [
      {
        alias: "pv_forecast_today_kwh",
        value: kwhBetween(startOfDay.getTime(), dayAfter.getTime()),
        unit: "kWh",
        category: "energy",
        lastUpdated: at,
      },
      {
        alias: "pv_forecast_tomorrow_kwh",
        value: kwhBetween(dayAfter.getTime(), twoDaysAfter.getTime()),
        unit: "kWh",
        category: "energy",
        lastUpdated: at,
      },
      {
        alias: "pv_forecast_now_w",
        value: Math.round(
          curve.find((p) => Date.parse(p.at) <= now && Date.parse(p.at) + 3_600_000 > now)?.watts ??
            0,
        ),
        unit: "W",
        category: "power",
        lastUpdated: at,
      },
      // The curve itself, for the panel. A json entry rather than 120 flat
      // aliases, for the same reason the plugin publishes one series.
      {
        alias: "pv_forecast_curve",
        value: curve,
        category: "generic",
        lastUpdated: at,
      },
    ];
  }

  /** The curve, for the API route. */
  getCurve(equipmentId: string): ForecastPoint[] {
    return this.curves.get(equipmentId) ?? [];
  }

  /**
   * When the series behind the current curve was issued.
   *
   * Surfaced rather than kept private: if the weather plugin stops polling, the
   * curve stays in memory and would otherwise be drawn exactly like a fresh one.
   * A three-day-old forecast presented as today's is worse than none.
   */
  getIssuedAt(equipmentId: string): string | null {
    return this.issuedAt.get(equipmentId) ?? null;
  }

  /** The production binding the accuracy comparison comes from. */
  getProductionAlias(equipmentId: string): string | null {
    const power = this.equipments
      .getDataBindingsWithValues(equipmentId)
      .find((b) => b.category === "power");
    return power?.alias ?? null;
  }

  getModel(equipmentId: string): PvModel | null {
    const row = this.db
      .prepare("SELECT * FROM pv_forecast_model WHERE equipment_id = ?")
      .get(equipmentId) as ModelRow | undefined;
    if (!row) return null;
    try {
      return {
        gain: row.gain,
        shape: JSON.parse(row.shape) as Record<number, number>,
        fittedAt: row.fitted_at,
        samples: row.samples,
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // Forecast
  // ============================================================

  private solarEquipments(): Equipment[] {
    return this.equipments.getAll().filter((e) => isActiveSolarProfile(e.solarProfile));
  }

  private recomputeAll(): void {
    const series = this.readIrradiance();
    if (!series) return;

    for (const equipment of this.solarEquipments()) {
      try {
        this.collectSample(equipment, series, totalPeakWc(equipment.solarProfile?.planes ?? []));
        const curve = this.computeCurve(equipment, series);
        if (curve.length === 0) continue;
        this.curves.set(equipment.id, curve);
        this.issuedAt.set(equipment.id, series.issuedAt ?? new Date().toISOString());
        this.persist(equipment.id, curve, series.issuedAt);
      } catch (err) {
        this.logger.error({ err, equipmentId: equipment.id }, "PV curve computation failed");
      }
    }
  }

  /**
   * Read the hourly series straight off the device data.
   *
   * No data binding and no equipment: this is a computation input, not something
   * a household reads off a card, and a binding would have to be created by hand
   * after every plugin update (issue #707). Matched on category and shape rather
   * than on a plugin id, so another weather plugin can serve it later.
   */
  private readIrradiance(): IrradianceSeries | null {
    for (const device of this.devices.getAllWithData()) {
      for (const data of device.data) {
        if (data.key !== IRRADIANCE_DATA_POINT || data.type !== "json") continue;
        const value = data.value as IrradianceSeries | null;
        if (value && Array.isArray(value.hours) && value.hours.length > 0) return value;
      }
    }
    return null;
  }

  private computeCurve(equipment: Equipment, series: IrradianceSeries): ForecastPoint[] {
    const planes = equipment.solarProfile?.planes ?? [];
    const peakWc = totalPeakWc(planes);
    if (peakWc <= 0) return [];
    // No model yet: a provisional clear-sky estimate rather than nothing. The
    // API reports `model: null` alongside, so the panel can label it as such —
    // eleven days of an empty card is indistinguishable from a broken feature.
    const model = this.modelFor(equipment, peakWc);

    const lat = parseFloat(this.settings.get("home.latitude") ?? "");
    const lon = parseFloat(this.settings.get("home.longitude") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

    const out: ForecastPoint[] = [];
    for (const hour of series.hours) {
      const startMs = Date.parse(hour.t);
      if (!Number.isFinite(startMs)) continue;
      if (hour.direct === null || hour.diffuse === null) continue;

      // Mid-hour, so the geometry represents the hour rather than its edge.
      const sun = solarPosition(new Date(startMs + 1_800_000), lat, lon);
      const poa = planeOfArray(planes, toDni(hour.direct, sun.elevationRad), hour.diffuse, sun);
      const local = new Date(startMs);
      const watts = model
        ? predict(model, { hourLocal: local.getHours(), poa, tempC: hour.temp ?? 25 }, peakWc)
        : clearSkyEstimate(poa, hour.temp ?? 25, peakWc);
      out.push({ at: new Date(startMs).toISOString(), watts: Math.round(watts) });
    }
    return out;
  }

  // ============================================================
  // Model lifecycle
  // ============================================================

  /**
   * The stored model, refitting the gain when the declared peak power has moved.
   *
   * That comparison is the whole capacity-change mechanism (FR7): saving a
   * profile with a different total is the signal, and the hourly shape survives
   * it because it was measured identical before and after a real addition.
   */
  private modelFor(equipment: Equipment, peakWc: number): PvModel | null {
    const row = this.db
      .prepare("SELECT * FROM pv_forecast_model WHERE equipment_id = ?")
      .get(equipment.id) as ModelRow | undefined;

    if (!row) return null;
    const model = this.getModel(equipment.id);
    if (!model) return null;

    if (Math.abs(row.fitted_peak_wc - peakWc) > 1) {
      // Only samples recorded *since* the change describe the new array. Before
      // that, re-estimating would reproduce the old gain from old data and, if
      // the trigger were stamped anyway, disarm itself forever — leaving the
      // forecast wrong by the size of the change until the 45-day window drifts.
      const since = row.gain_reset_at ?? new Date().toISOString();
      if (!row.gain_reset_at) this.markCapacityChange(equipment.id, since);

      const fresh = this.readSamplesSince(equipment, since);
      if (fresh.length >= MIN_FRESH_SAMPLES) {
        this.logger.info(
          {
            equipmentId: equipment.id,
            from: row.fitted_peak_wc,
            to: peakWc,
            samples: fresh.length,
          },
          "Declared peak power changed, gain re-estimated on post-change production",
        );
        const next = refitGainOnly(model, fresh, peakWc);
        this.store(equipment.id, next, peakWc, false);
        return next;
      }
      // Not enough yet. Keep the old gain, keep the trigger armed, and say so
      // once rather than on every recompute.
      return model;
    }
    return model;
  }

  /** Re-estimate the gain from the last few days. Used by FR7 and the API. */
  refitGain(equipment: Equipment, model: PvModel, peakWc: number, days = 3): PvModel | null {
    const samples = this.readSamples(equipment, days);
    if (samples.length === 0) return null;

    // Keep the full fit's sample count: the shape still comes from the 45-day
    // window, and reporting "fitted on 20 hours" would misdescribe it.
    const next = { ...refitGainOnly(model, samples, peakWc), samples: model.samples };

    // `refitGainOnly` returns the model untouched below its own floor. Saying
    // "recalibrated" when the gain did not move would be a lie the owner has no
    // way to check.
    if (next.gain === model.gain) return null;

    this.store(equipment.id, next, peakWc, true);
    return next;
  }

  /** Full nightly refit, gain and shape, on the rolling window. */
  refitAll(): void {
    this.pruneSamples();
    for (const equipment of this.solarEquipments()) {
      try {
        const peakWc = totalPeakWc(equipment.solarProfile?.planes ?? []);
        const samples = this.readSamples(equipment, WINDOW_DAYS);
        const model = fitModel(samples, peakWc);
        if (!model) {
          this.logger.info(
            { equipmentId: equipment.id, samples: samples.length },
            "Not enough production history yet to fit a PV model",
          );
          continue;
        }
        // Only clear the pending-change stamp when this fit actually saw the
        // new array. The window is 45 days; a change declared yesterday leaves
        // it dominated by the old one, and clearing the stamp here would disarm
        // the fast re-estimation at 02:15 every night before it could ever fire.
        const pending = this.db
          .prepare("SELECT gain_reset_at FROM pv_forecast_model WHERE equipment_id = ?")
          .get(equipment.id) as { gain_reset_at: string | null } | undefined;
        const fresh = pending?.gain_reset_at
          ? this.readSamplesSince(equipment, pending.gain_reset_at).length
          : 0;

        this.store(equipment.id, model, peakWc, false);

        if (!pending?.gain_reset_at || fresh >= MIN_SAMPLES) {
          this.db
            .prepare("UPDATE pv_forecast_model SET gain_reset_at = NULL WHERE equipment_id = ?")
            .run(equipment.id);
        }
        this.logger.info(
          { equipmentId: equipment.id, gain: model.gain, samples: model.samples },
          "PV model refit",
        );
      } catch (err) {
        this.logger.error({ err, equipmentId: equipment.id }, "PV model refit failed");
      }
    }
    this.recomputeAll();
  }

  /**
   * Persist the model.
   *
   * `fitted_peak_wc` is the capacity-change trigger, so it is only advanced
   * when the fit genuinely describes that capacity. Stamping it otherwise
   * disarms the trigger while the model still describes the old array — the
   * exact failure this table was added to catch.
   */
  private store(equipmentId: string, model: PvModel, peakWc: number, gainReset: boolean): void {
    this.db
      .prepare(
        `INSERT INTO pv_forecast_model
           (equipment_id, gain, shape, fitted_at, samples, fitted_peak_wc, gain_reset_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(equipment_id) DO UPDATE SET
           gain = excluded.gain, shape = excluded.shape, fitted_at = excluded.fitted_at,
           samples = excluded.samples, fitted_peak_wc = excluded.fitted_peak_wc,
           gain_reset_at = COALESCE(excluded.gain_reset_at, pv_forecast_model.gain_reset_at)`,
      )
      .run(
        equipmentId,
        model.gain,
        JSON.stringify(model.shape),
        model.fittedAt,
        model.samples,
        peakWc,
        gainReset ? new Date().toISOString() : null,
      );
  }

  /**
   * The recorded samples inside the window.
   *
   * Measured production paired with the irradiance that produced it, never the
   * forecast, so a bad model can never train the next one on its own output.
   */
  private readSamples(equipment: Equipment, days: number): PvSample[] {
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT hour_local, poa, temp_c, watts FROM pv_forecast_sample
         WHERE equipment_id = ? AND at >= ? ORDER BY at`,
      )
      .all(equipment.id, from) as {
      hour_local: number;
      poa: number;
      temp_c: number;
      watts: number;
    }[];

    return rows.map((r) => ({
      hourLocal: r.hour_local,
      poa: r.poa,
      tempC: r.temp_c,
      watts: r.watts,
    }));
  }

  /** Stamp the moment a declared change was noticed, so freshness is measurable. */
  private markCapacityChange(equipmentId: string, at: string): void {
    this.db
      .prepare("UPDATE pv_forecast_model SET gain_reset_at = ? WHERE equipment_id = ?")
      .run(at, equipmentId);
    this.logger.info(
      { equipmentId, at },
      "Declared peak power changed, waiting for production on the new array",
    );
  }

  /** Samples recorded since an instant. Used to judge a post-change gain. */
  private readSamplesSince(equipment: Equipment, since: string): PvSample[] {
    const rows = this.db
      .prepare(
        `SELECT hour_local, poa, temp_c, watts FROM pv_forecast_sample
         WHERE equipment_id = ? AND at >= ? ORDER BY at`,
      )
      .all(equipment.id, since) as {
      hour_local: number;
      poa: number;
      temp_c: number;
      watts: number;
    }[];
    return rows.map((r) => ({
      hourLocal: r.hour_local,
      poa: r.poa,
      tempC: r.temp_c,
      watts: r.watts,
    }));
  }

  /**
   * Accumulate the hour in progress, and close the previous one.
   *
   * Called on every poll. The meter reports instantaneous power, so the hour's
   * figure is the mean of the readings seen during it.
   *
   * That is **not** a true hourly mean: with a 30-minute plugin poll it averages
   * about two readings at near-fixed minute offsets, which biases it low on the
   * morning ramp and high on the evening one. It is computed here anyway so the
   * fit does not depend on InfluxDB being up, and the bias is systematic rather
   * than random, so the hourly shape absorbs most of it. A finer sampling
   * cadence would be the way to remove the rest.
   */
  private collectSample(equipment: Equipment, series: IrradianceSeries, peakWc: number): void {
    const watts = this.currentProduction(equipment);
    if (watts === null) return;

    const now = Date.now();
    const hourMs = now - (now % 3_600_000);
    const open = this.pending.get(equipment.id);

    if (open && open.hourMs !== hourMs) {
      this.closeHour(equipment.id, open);
      this.pending.delete(equipment.id);
    }

    const hour = series.hours.find((h) => {
      const ms = Date.parse(h.t);
      return Number.isFinite(ms) && ms - (ms % 3_600_000) === hourMs;
    });
    if (!hour || hour.direct === null || hour.diffuse === null) return;

    const lat = parseFloat(this.settings.get("home.latitude") ?? "");
    const lon = parseFloat(this.settings.get("home.longitude") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const sun = solarPosition(new Date(hourMs + 1_800_000), lat, lon);
    const poa = planeOfArray(
      equipment.solarProfile?.planes ?? [],
      toDni(hour.direct, sun.elevationRad),
      hour.diffuse,
      sun,
    );

    // A reading above the declared peak is impossible and must not train
    // anything: the reference installation's history carries 31 kW spikes on a
    // 4 kWc array. `fitModel` guards too; dropping it here keeps the store clean.
    if (peakWc > 0 && watts > peakWc * 1.3) {
      this.logger.warn(
        { equipmentId: equipment.id, watts, peakWc },
        "Production reading above the declared peak power, not recorded",
      );
      return;
    }

    const bucket = this.pending.get(equipment.id) ?? {
      hourMs,
      watts: [],
      poa,
      tempC: hour.temp ?? 25,
    };
    bucket.watts.push(watts);
    bucket.poa = poa;
    bucket.tempC = hour.temp ?? 25;
    this.pending.set(equipment.id, bucket);
  }

  private closeHour(
    equipmentId: string,
    bucket: { hourMs: number; watts: number[]; poa: number; tempC: number },
  ): void {
    if (bucket.watts.length === 0 || bucket.poa <= 0) return;
    const mean = bucket.watts.reduce((a, b) => a + b, 0) / bucket.watts.length;
    this.db
      .prepare(
        `INSERT INTO pv_forecast_sample (equipment_id, at, hour_local, poa, temp_c, watts)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(equipment_id, at) DO UPDATE SET
           poa = excluded.poa, temp_c = excluded.temp_c, watts = excluded.watts`,
      )
      .run(
        equipmentId,
        new Date(bucket.hourMs).toISOString(),
        new Date(bucket.hourMs).getHours(),
        bucket.poa,
        bucket.tempC,
        mean,
      );
  }

  /**
   * Instantaneous production, from whatever power binding the meter carries.
   *
   * A stale binding is refused. An inverter whose Wi-Fi drops at 14:00 keeps
   * reporting its last value; recording it against a declining plane-of-array
   * irradiance would inflate both the gain and the afternoon shape for the next
   * forty-five days, and nothing downstream could tell.
   */
  private currentProduction(equipment: Equipment): number | null {
    const bindings = this.equipments.getDataBindingsWithValues(equipment.id);
    const power = bindings.find((b) => b.category === "power" && typeof b.value === "number");
    if (!power) return null;
    if (power.stale) {
      this.logger.debug(
        { equipmentId: equipment.id, alias: power.alias },
        "Production binding is stale, not recording a training sample",
      );
      return null;
    }
    return power.value as number;
  }

  /** Drop samples that have fallen out of the window. */
  private pruneSamples(): void {
    const cutoff = new Date(Date.now() - (WINDOW_DAYS + 5) * 86_400_000).toISOString();
    this.db.prepare("DELETE FROM pv_forecast_sample WHERE at < ?").run(cutoff);
  }

  // ============================================================
  // Persistence of the curve
  // ============================================================

  private persist(equipmentId: string, curve: ForecastPoint[], issuedAt?: string): void {
    if (!this.influx.isConnected()) return;
    const issued = issuedAt ? Date.parse(issuedAt) : Date.now();

    for (const point of curve) {
      const targetMs = Date.parse(point.at);
      if (!Number.isFinite(targetMs) || targetMs < issued) continue;
      const leadHours = Math.round((targetMs - issued) / 3_600_000);

      // The 2-year bucket, not the raw one: a forecast exists to be compared
      // with reality weeks later, and the raw bucket keeps 7 days with no
      // downsampling task carrying this measurement across.
      this.influx.writeEnergyHourlyPoint(
        new Point("pv_forecast")
          .tag("equipmentId", equipmentId)
          // Bucketed rather than exact, so a curve refreshed every 30 minutes
          // does not create a new series per poll.
          .tag("leadBucket", leadBucket(leadHours))
          .floatField("watts", point.watts)
          .timestamp(new Date(targetMs)),
      );
    }
  }

  // ============================================================
  // Scheduling
  // ============================================================

  /** Refit shortly after midnight, when a full day has just closed. */
  private scheduleRefit(): void {
    if (this.refitTimer) clearTimeout(this.refitTimer);
    const next = new Date();
    next.setHours(2, 15, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);

    this.refitTimer = setTimeout(() => {
      try {
        this.refitAll();
      } catch (err) {
        this.logger.error({ err }, "Nightly PV refit failed");
      }
      this.scheduleRefit();
    }, next.getTime() - Date.now());
  }
}

/**
 * Lead time bucket, in hours.
 *
 * Accuracy is a function of how far ahead a figure was issued, so it has to be
 * kept with the point. Bucketing keeps the InfluxDB series count bounded while
 * still separating "said an hour ago" from "said four days ago".
 */
export function leadBucket(leadHours: number): string {
  if (leadHours <= 1) return "0-1h";
  if (leadHours <= 6) return "1-6h";
  if (leadHours <= 24) return "6-24h";
  if (leadHours <= 48) return "24-48h";
  return "48h+";
}
