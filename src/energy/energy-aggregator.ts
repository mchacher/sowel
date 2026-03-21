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
import type { ComputedDataEntry } from "../shared/types.js";

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

    // Subscribe to equipment data changes — used as trigger only
    this.eventBus.on((event) => {
      if (event.type !== "equipment.data.changed") return;
      if (event.alias !== "energy") return;

      if (!this.energyEquipmentIds.has(event.equipmentId)) {
        this.energyEquipmentIds.add(event.equipmentId);
      }

      this.scheduleRefresh(event.equipmentId);
    });

    this.logger.info({ equipmentCount: this.energyEquipmentIds.size }, "Energy aggregator started");
  }

  /** Scan all equipments for energy data bindings. */
  private discoverEnergyEquipments(): void {
    const allEquipments = this.equipmentManager.getAllWithDetails();
    for (const eq of allEquipments) {
      for (const binding of eq.dataBindings) {
        if (binding.alias === "energy" && binding.category === "energy") {
          this.energyEquipmentIds.add(eq.id);
          break;
        }
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

    // Hour cumul: sum raw points in current hour
    let energyHourWh = 0;
    const hourFlux = `from(bucket: "${rawBucket}")
  |> range(start: ${currentHourStart.toISOString()}, stop: ${tomorrowMidnight.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sum()`;

    for await (const { values, tableMeta } of queryApi.iterateRows(hourFlux)) {
      const row = tableMeta.toObject(values) as { _value: number };
      if (row._value > 0) energyHourWh = row._value;
    }

    // Day cumul: sum hourly points today + raw points in current hour (hourly task may not have run yet)
    let energyDayWh = 0;
    const dayFlux = `from(bucket: "${hourlyBucket}")
  |> range(start: ${todayMidnight.toISOString()}, stop: ${tomorrowMidnight.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sum()`;

    for await (const { values, tableMeta } of queryApi.iterateRows(dayFlux)) {
      const row = tableMeta.toObject(values) as { _value: number };
      if (row._value > 0) energyDayWh = row._value;
    }

    // Month cumul: daily points this month (excluding today) + today's day total
    const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
    let monthPrevDays = 0;
    const monthFlux = `from(bucket: "${dailyBucket}")
  |> range(start: ${monthFirst.toISOString()}, stop: ${todayMidnight.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sum()`;

    for await (const { values, tableMeta } of queryApi.iterateRows(monthFlux)) {
      const row = tableMeta.toObject(values) as { _value: number };
      if (row._value > 0) monthPrevDays = row._value;
    }

    // Year cumul: daily points this year (excluding today) + today's day total
    const jan1 = new Date(now.getFullYear(), 0, 1);
    let yearPrevDays = 0;
    const yearFlux = `from(bucket: "${dailyBucket}")
  |> range(start: ${jan1.toISOString()}, stop: ${todayMidnight.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sum()`;

    for await (const { values, tableMeta } of queryApi.iterateRows(yearFlux)) {
      const row = tableMeta.toObject(values) as { _value: number };
      if (row._value > 0) yearPrevDays = row._value;
    }

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
