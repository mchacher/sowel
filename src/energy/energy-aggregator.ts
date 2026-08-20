/**
 * EnergyAggregator — Computes energy cumuls at equipment level.
 *
 * Listens to equipment.data.changed events for alias "energy" as a trigger.
 * On trigger, queries InfluxDB (single source of truth) to compute cumuls:
 *   - hour: sum of raw points in current hour
 *   - day: sum of hourly points today
 *   - month: sum of daily points this month + today's hourly
 *   - year: sum of daily points this year + today's hourly
 * Emits equipment.data.changed events for cumul values → WebSocket → UI.
 *
 * Generic: works for any integration that writes energy data (Legrand, Shelly, etc.)
 */

import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import { isSubmeterEquipment, NON_SUBMETER_TYPES } from "../equipments/metering.js";
import type { ComputedDataEntry } from "../shared/types.js";

/** One row as the InfluxDB client hands it over. */
interface QueryRow {
  values: string[];
  tableMeta: { toObject(values: string[]): unknown };
}

/** Minimum interval between two InfluxDB refreshes per equipment (ms). */
const DEBOUNCE_MS = 5_000;

interface EnergyCumuls {
  energyHourWh: number;
  energyDayWh: number;
  energyMonthWh: number;
  energyYearWh: number;
}

export class EnergyAggregator {
  private logger: Logger;
  private eventBus: EventBus;
  private equipmentManager: EquipmentManager;
  private influxClient: InfluxClient;

  /** Cached cumuls per equipment. */
  private cumuls = new Map<string, EnergyCumuls>();
  /** Set of equipment IDs that have energy data — discovered dynamically. */
  private energyEquipmentIds = new Set<string>();
  /** Debounce timers per equipment. */
  private pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();
  /** Hour-aligned timer that recomputes every enrolled equipment (#618). */
  private rolloverTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by stop() so a refresh in flight cannot re-arm the rollover timer. */
  private stopped = false;

  constructor(
    equipmentManager: EquipmentManager,
    influxClient: InfluxClient,
    eventBus: EventBus,
    logger: Logger,
  ) {
    this.equipmentManager = equipmentManager;
    this.influxClient = influxClient;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "energy-aggregator" });
  }

  /**
   * Start listening for energy data changes.
   * Must be called after integrations have started and equipment bindings are set up.
   */
  async start(): Promise<void> {
    this.stopped = false;
    // Discover which equipments have energy bindings
    this.discoverEnergyEquipments();

    // Register as computed data provider so REST API includes cumuls
    this.equipmentManager.registerComputedDataProvider((eqId) =>
      this.getComputedDataForEquipment(eqId),
    );

    // Initial load from InfluxDB
    for (const equipmentId of this.energyEquipmentIds) {
      await this.refreshFromInfluxDB(equipmentId);
    }

    // Subscribe to equipment data changes — used as trigger only. Also watch
    // create/update so a freshly created submeter (or one that just gained a
    // power binding) is enrolled and shows zeroed cumuls immediately (#527).
    this.eventBus.on((event) => {
      try {
        if (event.type === "equipment.data.changed") {
          if (event.alias !== "energy") return;
          this.enrol(event.equipmentId);
          this.scheduleRefresh(event.equipmentId);
          return;
        }
        if (event.type === "equipment.created" || event.type === "equipment.updated") {
          const { id, type } = event.equipment;
          if (this.energyEquipmentIds.has(id)) return;
          // Skip only the house total / production meters before touching the DB
          // for bindings (#523); isSubmeterEquipment then gates on a numeric channel.
          if (NON_SUBMETER_TYPES.has(type)) return;
          const bindings = this.equipmentManager.getDataBindingsWithValues(id);
          if (isSubmeterEquipment(type, bindings)) {
            this.enrol(id);
            this.scheduleRefresh(id);
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Error in energy aggregator event handler");
      }
    });

    // Recompute every enrolled equipment on each local hour boundary. Without
    // this, a submeter that goes idle (0 W) never emits another `energy` event,
    // so its cached cumuls freeze and keep serving the previous hour/day/month
    // total across the boundary — the "2.92 kWh shown all night" bug (#618).
    this.scheduleRollover();

    this.logger.info({ equipmentCount: this.energyEquipmentIds.size }, "Energy aggregator started");
  }

  /** Clear timers so the aggregator can be torn down without leaks. */
  stop(): void {
    this.stopped = true;
    if (this.rolloverTimer) {
      clearTimeout(this.rolloverTimer);
      this.rolloverTimer = null;
    }
    for (const timer of this.pendingRefresh.values()) {
      clearTimeout(timer);
    }
    this.pendingRefresh.clear();
  }

  /**
   * Arm a one-shot timer for the next local hour boundary. On fire it refreshes
   * all enrolled equipments (rolling the hour cumul, and — at the midnight tick —
   * the day/month/year cumuls) then re-arms itself for the following hour.
   */
  private scheduleRollover(): void {
    if (this.stopped) return;
    const now = new Date();
    const nextHour = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours() + 1,
      0,
      0,
      0,
    );
    const delay = Math.max(1, nextHour.getTime() - now.getTime());
    this.rolloverTimer = setTimeout(() => {
      this.refreshAll()
        .catch((err) => this.logger.warn({ err }, "Energy rollover refresh failed"))
        .finally(() => this.scheduleRollover());
    }, delay);
  }

  /** Recompute cumuls for every enrolled equipment from InfluxDB. */
  private async refreshAll(): Promise<void> {
    for (const equipmentId of this.energyEquipmentIds) {
      await this.refreshFromInfluxDB(equipmentId).catch((err) =>
        this.logger.warn({ err, equipmentId }, "Failed to refresh energy cumuls on rollover"),
      );
    }
  }

  /**
   * Enrol an equipment as an energy source. Seeds zeroed cumuls so a submeter's
   * meter UI renders from creation instead of only after its first consumption
   * (#527); a later InfluxDB refresh overwrites them with real values.
   */
  private enrol(equipmentId: string): void {
    this.energyEquipmentIds.add(equipmentId);
    if (!this.cumuls.has(equipmentId)) {
      this.cumuls.set(equipmentId, {
        energyHourWh: 0,
        energyDayWh: 0,
        energyMonthWh: 0,
        energyYearWh: 0,
      });
    }
  }

  /**
   * Scan all equipments for energy sources: an `energy` data binding, or being a
   * consumption submeter (metering water_heater/switch, energy_meter) whose Wh is
   * derived from power by the PowerSubmeterIntegrator (#527).
   */
  private discoverEnergyEquipments(): void {
    const allEquipments = this.equipmentManager.getAllWithDetails();
    for (const eq of allEquipments) {
      const hasEnergyBinding = eq.dataBindings.some(
        (b) => b.alias === "energy" && b.category === "energy",
      );
      if (hasEnergyBinding || isSubmeterEquipment(eq.type, eq.dataBindings)) {
        this.enrol(eq.id);
      }
    }
  }

  /** Schedule a debounced InfluxDB refresh for an equipment. */
  private scheduleRefresh(equipmentId: string): void {
    const existing = this.pendingRefresh.get(equipmentId);
    if (existing) return; // Already scheduled

    const timer = setTimeout(() => {
      this.pendingRefresh.delete(equipmentId);
      this.refreshFromInfluxDB(equipmentId).catch((err) =>
        this.logger.warn({ err, equipmentId }, "Failed to refresh energy cumuls from InfluxDB"),
      );
    }, DEBOUNCE_MS);

    this.pendingRefresh.set(equipmentId, timer);
  }

  /**
   * Sum the `energy` points of one equipment over `[start, stop)`.
   *
   * An empty or inverted range is answered with 0 without touching InfluxDB.
   * Flux rejects `range(start: t, stop: t)` with "cannot query an empty range",
   * and every caller has a legitimate moment where the two bounds coincide:
   *
   *  - between 00:00 and 00:59 local, no hour of today is completed yet, so
   *    `todayMidnight === currentHourStart`;
   *  - on the 1st of the month, no earlier day belongs to it, so
   *    `monthFirst === todayMidnight`;
   *  - on 1 January, the same holds for the year.
   *
   * Those are states, not failures — the sum of nothing is 0. Letting the query
   * run threw out of refreshFromInfluxDB, which dropped *every* cumul for that
   * equipment (hour and year included, not just the empty one) for the whole
   * window: an hour every night, a full day every 1st of the month.
   */
  private async sumEnergy(
    queryApi: { iterateRows(flux: string): AsyncIterable<QueryRow> },
    bucket: string,
    equipmentId: string,
    start: Date,
    stop: Date,
  ): Promise<number> {
    if (start.getTime() >= stop.getTime()) return 0;

    const flux = `from(bucket: "${bucket}")
  |> range(start: ${start.toISOString()}, stop: ${stop.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sum()`;

    let total = 0;
    for await (const { values, tableMeta } of queryApi.iterateRows(flux)) {
      const row = tableMeta.toObject(values) as { _value: number };
      if (row._value > 0) total = row._value;
    }
    return total;
  }

  /** Query InfluxDB to compute all cumuls for an equipment, then emit to UI. */
  private async refreshFromInfluxDB(equipmentId: string): Promise<void> {
    const client = this.influxClient.getClient();
    const config = this.influxClient.getConfig();
    if (!client || !config) return;

    const queryApi = client.getQueryApi(config.org);
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentHourStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
    );
    const tomorrowMidnight = new Date(todayMidnight);
    tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);

    const rawBucket = config.bucket;
    const hourlyBucket = `${config.bucket}-energy-hourly`;
    const dailyBucket = `${config.bucket}-energy-daily`;
    const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
    const jan1 = new Date(now.getFullYear(), 0, 1);

    // Hour cumul: raw points since the top of the current hour.
    const energyHourWh = await this.sumEnergy(
      queryApi,
      rawBucket,
      equipmentId,
      currentHourStart,
      tomorrowMidnight,
    );

    // Day cumul: the hours already completed today come from the hourly bucket
    // (downsampled at the end of each hour), the current hour is still in the
    // raw bucket. They don't overlap — the hourly task only writes closed hours.
    const energyDayPrevHoursWh = await this.sumEnergy(
      queryApi,
      hourlyBucket,
      equipmentId,
      todayMidnight,
      currentHourStart,
    );
    const energyDayWh = energyDayPrevHoursWh + energyHourWh;

    // Month and year: daily points before today, plus today's own total below.
    const monthPrevDays = await this.sumEnergy(
      queryApi,
      dailyBucket,
      equipmentId,
      monthFirst,
      todayMidnight,
    );
    const yearPrevDays = await this.sumEnergy(
      queryApi,
      dailyBucket,
      equipmentId,
      jan1,
      todayMidnight,
    );

    const cumul: EnergyCumuls = {
      energyHourWh,
      energyDayWh,
      energyMonthWh: monthPrevDays + energyDayWh,
      energyYearWh: yearPrevDays + energyDayWh,
    };

    this.cumuls.set(equipmentId, cumul);

    this.logger.debug({ equipmentId, ...cumul }, "Energy cumuls refreshed from InfluxDB");

    // Emit to UI via WebSocket
    this.emitCumuls(equipmentId, cumul);
  }

  /** Emit equipment.data.changed events for all cumul values. */
  private emitCumuls(equipmentId: string, cumul: EnergyCumuls): void {
    const entries: Array<{ alias: string; value: number }> = [
      { alias: "energy_hour", value: cumul.energyHourWh },
      { alias: "energy_day", value: cumul.energyDayWh },
      { alias: "energy_month", value: cumul.energyMonthWh },
      { alias: "energy_year", value: cumul.energyYearWh },
    ];

    for (const { alias, value } of entries) {
      this.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId,
        alias,
        value,
        previous: null,
      });
    }
  }

  /** Return computed data entries for a given equipment (used by EquipmentManager API). */
  getComputedDataForEquipment(equipmentId: string): ComputedDataEntry[] {
    const cumul = this.cumuls.get(equipmentId);
    if (!cumul) return [];

    const now = new Date().toISOString();
    return [
      {
        alias: "energy_hour",
        value: cumul.energyHourWh,
        unit: "Wh",
        category: "energy",
        lastUpdated: now,
      },
      {
        alias: "energy_day",
        value: cumul.energyDayWh,
        unit: "Wh",
        category: "energy",
        lastUpdated: now,
      },
      {
        alias: "energy_month",
        value: cumul.energyMonthWh,
        unit: "Wh",
        category: "energy",
        lastUpdated: now,
      },
      {
        alias: "energy_year",
        value: cumul.energyYearWh,
        unit: "Wh",
        category: "energy",
        lastUpdated: now,
      },
    ];
  }
}
