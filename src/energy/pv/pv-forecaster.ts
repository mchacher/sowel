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
import {
  ALERT_DAYS,
  NORMAL_DAYS,
  assess,
  dailyRatio,
  detectionSpeed,
  type DayRatio,
  type HealthHour,
} from "./pv-health.js";
import {
  pairHistory,
  profilePeakWc,
  resolveWindow,
  type BackfillWindow,
  type HistoryHour,
} from "./pv-backfill.js";

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

/**
 * The past irradiance the weather plugin publishes for spec 161.
 *
 * A second series rather than a longer first one: the forward series is
 * republished on every poll, and carrying 45 days of history in it would put
 * ~130 KB on the wire twice an hour, with its `previous` value alongside.
 */
export const IRRADIANCE_HISTORY_DATA_POINT = "irradiance_history";

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

/** What a backfill did, or why it did nothing (spec 161, FR5). */
export interface BackfillReport {
  ok: boolean;
  hoursPaired?: number;
  windowFrom?: string;
  windowTo?: string;
  boundedBy?: BackfillWindow["boundedBy"];
  model?: PvModel | null;
  /** Set when nothing could be fitted, or nothing could be done at all. */
  reason?:
    | "no-profile"
    | "no-history"
    | "no-coordinates"
    | "influx-unavailable"
    | "not-enough-history";
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
  /** Equipments currently alerting, so an alarm is raised once and not nightly. */
  private readonly healthAlerting = new Set<string>();

  private readonly pending = new Map<
    string,
    { hourMs: number; watts: number[]; poa: number; tempC: number; directFraction: number | null }
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
    // Do not lose the hour in progress on a clean stop. Each is closed on its
    // own: an equipment deleted mid-hour leaves a bucket whose insert violates
    // the foreign key, and an unguarded loop would abort there and drop every
    // other equipment's hour with it.
    for (const [equipmentId, bucket] of this.pending) {
      try {
        this.closeHour(equipmentId, bucket);
      } catch (err) {
        this.logger.warn({ err, equipmentId }, "Could not persist the PV sample in progress");
      }
    }
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

    // Nothing is published while the curve is the provisional clear-sky
    // estimate. `persist()` already refuses to write that curve to Influx for
    // this exact reason — it is nameplate output with no shading, soiling or
    // ageing in it — and these aliases are read by machines, which have no
    // "provisional" label to go on. A recipe binding to `pv_forecast_now_w`
    // would act on near-nameplate numbers for the whole learning period.
    //
    // The panel is unaffected: it draws the curve from its own endpoint and says
    // in words that it is provisional.
    if (!this.getModel(equipmentId)) return [];

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
      // The curve itself is deliberately not published here. Computed data is
      // serialised into every `GET /api/v1/equipments`, and the curve is ~7 kB
      // per production meter that no client reads: the panel takes it from
      // `/energy/pv-forecast/:id`, and a recipe wants the scalars above, not a
      // 144-point array. The three figures cost a few bytes and are the surface
      // an automation would bind to.
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

  /**
   * Whether any plugin is currently publishing the irradiance series.
   *
   * Without it a declared array produces no curve at all, which is
   * indistinguishable on the panel from an array still gathering its first
   * fortnight of samples. The two need different words: one is waiting for
   * time to pass, the other for a plugin to be installed or updated, and only
   * the second is something the household can act on.
   */
  hasIrradianceSeries(): boolean {
    return this.readIrradiance() !== null;
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

    // Drop what belongs to equipments that no longer declare an array. Without
    // this the last curve stays in memory for good, and the computed aliases
    // keep publishing a forecast for a meter whose declaration was withdrawn.
    const active = new Set(this.solarEquipments().map((e) => e.id));
    for (const id of this.curves.keys()) {
      if (active.has(id)) continue;
      this.curves.delete(id);
      this.issuedAt.delete(id);
      this.pending.delete(id);
    }

    for (const equipment of this.solarEquipments()) {
      try {
        this.collectSample(equipment, series, totalPeakWc(equipment.solarProfile?.planes ?? []));
        const curve = this.computeCurve(equipment, series);
        if (curve.length === 0) continue;
        this.curves.set(equipment.id, curve);
        this.issuedAt.set(equipment.id, series.issuedAt ?? new Date().toISOString());
        // Only a model-backed curve is worth keeping for FR6. The provisional
        // clear-sky estimate is nameplate output with no shading, soiling or
        // ageing in it, and its own docstring says it reads high; persisted
        // untagged it would sit in the two-year bucket and be scored as if it
        // were a forecast, reporting the site as far worse than the model is.
        // The panel still draws it from memory, labelled provisional.
        if (this.getModel(equipment.id)) this.persist(equipment.id, curve, series.issuedAt);
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
        if (!value || !Array.isArray(value.hours) || value.hours.length === 0) continue;
        // A model configured without the radiation variables answers with the
        // right number of hours and nothing in them. That passes every length
        // check on both sides and then yields an empty curve, which the panel
        // reads as "still learning" — a fully populated, fully null series is
        // otherwise indistinguishable from a working one.
        if (!value.hours.some((h) => h.direct !== null && h.diffuse !== null)) continue;
        return value;
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
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      // Silent until now: the curve came back empty and the panel said the
      // array was still being learned, which no amount of waiting would fix.
      this.logger.warn(
        { equipmentId: equipment.id },
        "Home coordinates are not set, no PV forecast can be computed",
      );
      return [];
    }

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

  // ============================================================
  // Health (spec 162)
  // ============================================================

  /**
   * Compare what the panels produced with what they should have, once a day.
   *
   * Runs after the nightly refit, on the samples that refit just used. The
   * modelled side is the plane-of-array irradiance, never the fitted model, so
   * the refit cannot move the ratio it is about to be judged by.
   */
  runHealthCheck(): void {
    for (const equipment of this.solarEquipments()) {
      try {
        // No model, no health. The provisional clear-sky curve reads high by
        // construction and judging an array against it would report every new
        // installation as failing.
        if (!this.getModel(equipment.id)) continue;
        this.assessEquipmentHealth(equipment);
      } catch (err) {
        this.logger.error({ err, equipmentId: equipment.id }, "PV health check failed");
      }
    }
  }

  private assessEquipmentHealth(equipment: Equipment): void {
    const rows = this.db
      .prepare(
        `SELECT at, hour_local, poa, watts, direct_fraction
           FROM pv_forecast_sample WHERE equipment_id = ? ORDER BY at`,
      )
      .all(equipment.id) as Array<{
      at: string;
      hour_local: number;
      poa: number;
      watts: number;
      direct_fraction: number | null;
    }>;

    // Grouped by local date, because the midday band is a local notion.
    const byDay = new Map<string, HealthHour[]>();
    for (const r of rows) {
      const ms = Date.parse(r.at);
      if (!Number.isFinite(ms)) continue;
      const local = new Date(ms);
      const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
      const list = byDay.get(day) ?? [];
      list.push({
        hourLocal: r.hour_local,
        poa: r.poa,
        watts: r.watts,
        directFraction: r.direct_fraction,
      });
      byDay.set(day, list);
    }

    const days: DayRatio[] = [];
    for (const [day, hours] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const ratio = dailyRatio(day, hours);
      if (ratio) days.push(ratio);
    }

    const upsert = this.db.prepare(
      `INSERT INTO pv_health_day (equipment_id, day, ratio, hours, measured_wh, modelled_wh)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(equipment_id, day) DO UPDATE SET
         ratio = excluded.ratio, hours = excluded.hours,
         measured_wh = excluded.measured_wh, modelled_wh = excluded.modelled_wh`,
    );
    this.db.transaction(() => {
      for (const d of days) {
        upsert.run(equipment.id, d.day, d.ratio, d.hours, d.measuredWh, d.modelledWh);
      }
    })();

    const verdict = assess(days);
    const alarmId = `pv-health:${equipment.id}`;
    const wasAlerting = this.healthAlerting.has(equipment.id);

    if (verdict.alerting && !wasAlerting) {
      this.healthAlerting.add(equipment.id);
      const pct = Math.round((verdict.deficit ?? 0) * 100);
      this.logger.warn(
        { equipmentId: equipment.id, deficit: verdict.deficit, since: verdict.since },
        "PV production has been below its normal for several clear days",
      );
      this.eventBus.emit({
        type: "system.alarm.raised",
        alarmId,
        level: "warning",
        source: "pv-health",
        message: `${equipment.name}: production ${pct} % below its usual level on the last ${ALERT_DAYS} clear days`,
        zoneId: equipment.zoneId ?? null,
      });
    } else if (!verdict.alerting && wasAlerting) {
      this.healthAlerting.delete(equipment.id);
      this.logger.info({ equipmentId: equipment.id }, "PV production is back to its normal");
      this.eventBus.emit({
        type: "system.alarm.resolved",
        alarmId,
        source: "pv-health",
        message: `${equipment.name}: production is back to its usual level`,
        zoneId: equipment.zoneId ?? null,
      });
    }
  }

  /**
   * Everything the health card needs, including what the detector cannot do.
   *
   * The detection speed is computed from the qualifying days actually seen over
   * the recent window, not from a summer figure: in a fortnight of overcast the
   * honest answer is that a fault would take a long time to show.
   */
  getHealth(equipment: Equipment): {
    days: DayRatio[];
    normal: number | null;
    latest: DayRatio | null;
    alert: { since: string; deficit: number } | null;
    detection: ReturnType<typeof detectionSpeed>;
  } {
    const rows = this.db
      .prepare(
        `SELECT day, ratio, hours, measured_wh, modelled_wh FROM pv_health_day
          WHERE equipment_id = ? ORDER BY day`,
      )
      .all(equipment.id) as Array<{
      day: string;
      ratio: number;
      hours: number;
      measured_wh: number;
      modelled_wh: number;
    }>;

    const days: DayRatio[] = rows.map((r) => ({
      day: r.day,
      ratio: r.ratio,
      hours: r.hours,
      measuredWh: r.measured_wh,
      modelledWh: r.modelled_wh,
    }));

    const verdict = assess(days);
    const panels = Math.max(1, Math.round(totalPeakWc(equipment.solarProfile?.planes ?? []) / 500));

    // Over the same window the samples cover, so "days seen" and "days that
    // qualified" are measured against the same stretch of calendar.
    const windowDays = Math.min(NORMAL_DAYS + ALERT_DAYS, WINDOW_DAYS);
    const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
    const recent = days.filter((d) => d.day >= cutoff).length;

    return {
      days,
      normal: verdict.normal,
      latest: verdict.latest,
      alert:
        verdict.alerting && verdict.since !== null
          ? { since: verdict.since, deficit: verdict.deficit ?? 0 }
          : null,
      detection: detectionSpeed(recent, windowDays, panels),
    };
  }

  // ============================================================
  // Backfill from existing history (spec 161)
  // ============================================================

  /**
   * Fit the model now, from production the installation has already recorded.
   *
   * Without this a household waits about twelve days after declaring its array
   * before the panel says anything but "provisional". The history is already
   * there: hourly production in Influx, and the irradiance of those same hours
   * published by the weather plugin.
   *
   * Explicit, never automatic. A model appearing on its own would be
   * indistinguishable from a learned one, and it would run before the owner had
   * a chance to say when the array last changed — which is the one thing that
   * decides whether the result is worth having.
   */
  async backfill(equipmentId: string): Promise<BackfillReport> {
    const equipment = this.equipments.getAll().find((e) => e.id === equipmentId);
    if (!equipment || !isActiveSolarProfile(equipment.solarProfile)) {
      return { ok: false, reason: "no-profile" };
    }

    const history = this.readIrradianceHistory();
    if (!history) return { ok: false, reason: "no-history" };

    const lat = parseFloat(this.settings.get("home.latitude") ?? "");
    const lon = parseFloat(this.settings.get("home.longitude") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, reason: "no-coordinates" };
    }

    const window = resolveWindow(equipment.solarProfile?.since, WINDOW_DAYS, Date.now());
    const production = await this.readProductionHistory(equipment, window);
    if (production === null) return { ok: false, reason: "influx-unavailable" };

    const peakWc = profilePeakWc(equipment.solarProfile);
    const samples = pairHistory({
      production,
      hours: history,
      planes: equipment.solarProfile?.planes ?? [],
      latitude: lat,
      longitude: lon,
      window,
      peakWc,
    });

    // Upserted on the same key the live path uses, so a backfill run twice
    // rewrites its own rows instead of doubling them, and never fights a live
    // sample for the hour in progress.
    const insert = this.db.prepare(
      `INSERT INTO pv_forecast_sample
         (equipment_id, at, hour_local, poa, temp_c, watts, direct_fraction)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(equipment_id, at) DO UPDATE SET
         poa = excluded.poa, temp_c = excluded.temp_c, watts = excluded.watts,
         direct_fraction = excluded.direct_fraction`,
    );
    this.db.transaction(() => {
      for (const s of samples) {
        insert.run(equipmentId, s.at, s.hourLocal, s.poa, s.tempC, s.watts, s.directFraction);
      }
    })();

    const report: BackfillReport = {
      ok: true,
      hoursPaired: samples.length,
      windowFrom: new Date(window.fromMs).toISOString(),
      windowTo: new Date(window.toMs).toISOString(),
      boundedBy: window.boundedBy,
      model: null,
    };

    // Fit over everything stored *inside the window*, not only what this run
    // added — a second backfill after a live fortnight should use both — and not
    // over everything stored either. Bounding what is added but not what is
    // fitted is why a declared run after an unbounded one changed nothing at
    // all: the earlier run's rows were still in the fit.
    const windowFrom = new Date(window.fromMs).toISOString();
    const inWindow = this.readSamplesSince(equipment, windowFrom);
    const model = fitModel(inWindow, peakWc);
    if (!model) {
      this.logger.info(
        { equipmentId, hoursPaired: samples.length, inWindow: inWindow.length },
        "Backfill stored samples but there is still not enough history to fit",
      );
      // Nothing is deleted on this path, deliberately. A mistyped date — one day
      // instead of one year — would otherwise cost a household every sample it
      // had accumulated, in exchange for a model it did not get.
      report.reason = "not-enough-history";
      return report;
    }

    // Only now that the window alone has proved sufficient are the older rows
    // dropped. A declared change date says the array was different before it, so
    // those hours describe hardware that is gone and the nightly refit would
    // otherwise keep fitting on them for another 45 days.
    const pruned = this.db
      .prepare("DELETE FROM pv_forecast_sample WHERE equipment_id = ? AND at < ?")
      .run(equipmentId, windowFrom).changes;
    if (pruned > 0) {
      this.logger.info(
        { equipmentId, pruned, from: windowFrom },
        "Dropped PV samples recorded before the declared array configuration",
      );
    }

    // The fit describes the declared capacity by construction: the window either
    // starts at the declared change or reaches back only as far as the rolling
    // window, so there is no pending change left to keep the trigger armed for.
    this.store(equipmentId, model, peakWc, false);
    this.db
      .prepare("UPDATE pv_forecast_model SET gain_reset_at = NULL WHERE equipment_id = ?")
      .run(equipmentId);
    report.model = model;

    this.logger.info(
      {
        equipmentId,
        hoursPaired: samples.length,
        gain: model.gain,
        samples: model.samples,
        boundedBy: window.boundedBy,
      },
      "PV model fitted from existing history",
    );

    // The curve is stale the moment the model changes.
    this.recomputeSoon();
    return report;
  }

  /** The published past series, or null when no plugin provides one. */
  private readIrradianceHistory(): HistoryHour[] | null {
    for (const device of this.devices.getAllWithData()) {
      for (const data of device.data) {
        if (data.key !== IRRADIANCE_HISTORY_DATA_POINT || data.type !== "json") continue;
        const value = data.value as { hours?: HistoryHour[] } | null;
        if (!value || !Array.isArray(value.hours) || value.hours.length === 0) continue;
        if (!value.hours.some((h) => h.direct !== null && h.diffuse !== null)) continue;
        return value.hours;
      }
    }
    return null;
  }

  /**
   * Hourly production over the window, from the downsampled bucket.
   *
   * `-hourly`, not the raw bucket: raw retention is seven days and the window is
   * forty-five. The same asymmetry cost spec 160 its accuracy comparison.
   *
   * Read with no time shift, deliberately. `-hourly` labels an hour by its END,
   * and so does Open-Meteo's irradiance (its radiation variables are documented
   * as preceding-hour means), so the two already agree. See the note in
   * `pv-accuracy.ts`; shifting one side collapsed the fitted gain from 3.8 to
   * 45.8 when it was tried.
   *
   * Returns null when Influx cannot answer, which the caller reports rather than
   * treating as "no production" — an empty history and an unreachable database
   * are very different answers to give a household.
   */
  private async readProductionHistory(
    equipment: Equipment,
    window: BackfillWindow,
  ): Promise<Map<number, number> | null> {
    const config = this.influx.getConfig();
    const client = this.influx.getClient();
    if (!config || !client) return null;

    const alias = this.getProductionAlias(equipment.id);
    if (!alias) return new Map();

    const days = Math.ceil((Date.now() - window.fromMs) / 86_400_000) + 1;
    const flux = `from(bucket: "${config.bucket}-hourly")
  |> range(start: -${days}d, stop: now())
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipment.id}")
  |> filter(fn: (r) => r.alias == "${alias}")
  |> filter(fn: (r) => r._field == "mean")
  |> sort(columns: ["_time"])`;

    const out = new Map<number, number>();
    try {
      for await (const { values, tableMeta } of client.getQueryApi(config.org).iterateRows(flux)) {
        const row = tableMeta.toObject(values);
        const ms = Date.parse(String(row._time));
        const v = row._value as number | undefined;
        if (Number.isFinite(ms) && typeof v === "number") out.set(ms, v);
      }
    } catch (err) {
      this.logger.warn({ err, equipmentId: equipment.id }, "PV backfill production query failed");
      return null;
    }
    return out;
  }

  /**
   * Full nightly refit, gain and shape, on the rolling window.
   *
   * Public so the trigger logic can be exercised directly: it has broken twice,
   * both times by advancing `fitted_peak_wc` past a change nobody had measured.
   */
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
          .prepare(
            "SELECT gain_reset_at, fitted_peak_wc FROM pv_forecast_model WHERE equipment_id = ?",
          )
          .get(equipment.id) as
          | { gain_reset_at: string | null; fitted_peak_wc: number }
          | undefined;
        const existingPeakWc = pending?.fitted_peak_wc;
        const fresh = pending?.gain_reset_at
          ? this.readSamplesSince(equipment, pending.gain_reset_at).length
          : 0;

        // A change is pending and this window has not seen enough of the new
        // array yet: keep the old capacity on the row so the trigger stays
        // armed. Stamping the declared one here is what disarmed it before —
        // the nightly refit would quietly close a change it had not measured.
        const measured = !pending?.gain_reset_at || fresh >= MIN_SAMPLES;
        const stampedPeakWc = measured ? peakWc : (existingPeakWc ?? peakWc);

        // The same reasoning has to cover the gain, not just the stamp. While a
        // declared capacity change is pending, the stored gain is the one the
        // trigger re-estimated on post-change production, and this window is
        // still dominated by the array as it was before. Writing the window's
        // gain here undoes that re-estimation every night at 02:15, leaving the
        // forecast wrong by the size of the change until the window drifts.
        //
        // The shape is refreshed either way: it was measured identical across a
        // real +1 kW addition, which is the whole reason gain and shape are
        // fitted separately.
        const stored = this.getModel(equipment.id);
        const toStore = measured || !stored ? model : { ...model, gain: stored.gain };
        this.store(equipment.id, toStore, stampedPeakWc, false);

        if (measured) {
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
  private store(
    equipmentId: string,
    model: PvModel,
    /** The capacity this fit actually describes, not necessarily the declared one. */
    fittedPeakWc: number,
    gainReset: boolean,
  ): void {
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
        fittedPeakWc,
        gainReset ? new Date().toISOString() : null,
      );
  }

  /**
   * The recorded samples inside the window.
   *
   * Measured production paired with the irradiance forecast for that hour.
   *
   * The watts are always measured, never predicted, which is what keeps a bad
   * model from training the next one on its own output. The irradiance is the
   * forecast series — there is no pyranometer on the roof — so a systematically
   * wrong irradiance forecast does bias the gain. That bias is the same one the
   * forecast will carry at prediction time, and fitting through it is what makes
   * the model correct for it rather than against it.
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

    // Spec 162 — the beam share decides whether this hour can judge the array's
    // health later. Computed here, where both components are in hand.
    const total = hour.direct + hour.diffuse;
    const directFraction = total > 0 ? hour.direct / total : null;

    const bucket = this.pending.get(equipment.id) ?? {
      hourMs,
      watts: [],
      poa,
      tempC: hour.temp ?? 25,
      directFraction,
    };
    bucket.watts.push(watts);
    bucket.poa = poa;
    bucket.tempC = hour.temp ?? 25;
    bucket.directFraction = directFraction;
    this.pending.set(equipment.id, bucket);
  }

  private closeHour(
    equipmentId: string,
    bucket: {
      hourMs: number;
      watts: number[];
      poa: number;
      tempC: number;
      directFraction: number | null;
    },
  ): void {
    if (bucket.watts.length === 0 || bucket.poa <= 0) return;
    const mean = bucket.watts.reduce((a, b) => a + b, 0) / bucket.watts.length;
    this.db
      .prepare(
        `INSERT INTO pv_forecast_sample
           (equipment_id, at, hour_local, poa, temp_c, watts, direct_fraction)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(equipment_id, at) DO UPDATE SET
           poa = excluded.poa, temp_c = excluded.temp_c, watts = excluded.watts,
           direct_fraction = excluded.direct_fraction`,
      )
      .run(
        equipmentId,
        new Date(bucket.hourMs).toISOString(),
        new Date(bucket.hourMs).getHours(),
        bucket.poa,
        bucket.tempC,
        mean,
        bucket.directFraction,
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
      // Spec 162, after the refit and in its own try: a health check that threw
      // must not cost the schedule, and a failed refit must not skip the check —
      // the health ratio does not depend on the model anyway.
      try {
        this.runHealthCheck();
      } catch (err) {
        this.logger.error({ err }, "Nightly PV health check failed");
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
