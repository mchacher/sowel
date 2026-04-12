/**
 * WeatherAggregator — Computes rain cumuls at equipment level.
 *
 * Listens to equipment.data.changed events for rain bindings as a trigger.
 * On trigger, queries InfluxDB (single source of truth) to compute:
 *   - rain_1h: sum of rain over the last 1 hour (mm)
 *   - rain_24h: sum of rain over the last 24 hours (mm)
 *
 * Follows the same pattern as EnergyAggregator.
 * Generic: works for any integration that writes rain data (Netatmo, z2m, etc.)
 */

import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { ComputedDataEntry } from "../shared/types.js";

/** Minimum interval between two InfluxDB refreshes per equipment (ms). */
const DEBOUNCE_MS = 5_000;

/** Periodic refresh interval to keep the sliding window up to date (ms). */
const PERIODIC_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

interface RainCumuls {
  rain1h: number | null;
  rain24h: number | null;
  lastUpdated: string;
}

export class WeatherAggregator {
  private logger: Logger;
  private eventBus: EventBus;
  private equipmentManager: EquipmentManager;
  private influxClient: InfluxClient;

  /** Cached cumuls per equipment. */
  private cumuls = new Map<string, RainCumuls>();
  /** Equipment IDs with historized rain bindings (type: weather only). */
  private rainEquipmentIds = new Set<string>();
  /** Debounce timers per equipment. */
  private pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();
  /** Periodic refresh interval handle. */
  private periodicInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    equipmentManager: EquipmentManager,
    influxClient: InfluxClient,
    eventBus: EventBus,
    logger: Logger,
  ) {
    this.equipmentManager = equipmentManager;
    this.influxClient = influxClient;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "weather-aggregator" });
  }

  async start(): Promise<void> {
    this.discoverRainEquipments();

    this.equipmentManager.registerComputedDataProvider((eqId) =>
      this.getComputedDataForEquipment(eqId),
    );

    // Initial load from InfluxDB
    for (const equipmentId of this.rainEquipmentIds) {
      await this.refreshFromInfluxDB(equipmentId);
    }

    // Subscribe to equipment data changes — rain alias as trigger
    this.eventBus.on((event) => {
      if (event.type !== "equipment.data.changed") return;

      // Check if this equipment is a weather equipment with rain binding
      if (!this.rainEquipmentIds.has(event.equipmentId)) {
        // Dynamic discovery: maybe a new equipment was created after startup
        const eq = this.equipmentManager.getById(event.equipmentId);
        if (!eq || eq.type !== "weather") return;
        const bindings = this.equipmentManager.getDataBindingsWithValues(event.equipmentId);
        const hasRain = bindings.some((b) => b.category === "rain");
        if (!hasRain) return;
        this.rainEquipmentIds.add(event.equipmentId);
      }

      // Only trigger on rain-related alias changes
      if (event.alias !== "rain") return;

      this.scheduleRefresh(event.equipmentId);
    });

    // Periodic refresh to keep the sliding 1h/24h windows current
    this.periodicInterval = setInterval(() => {
      for (const equipmentId of this.rainEquipmentIds) {
        this.scheduleRefresh(equipmentId);
      }
    }, PERIODIC_REFRESH_MS);

    this.logger.info({ equipmentCount: this.rainEquipmentIds.size }, "Weather aggregator started");
  }

  stop(): void {
    if (this.periodicInterval) {
      clearInterval(this.periodicInterval);
      this.periodicInterval = null;
    }
    for (const timer of this.pendingRefresh.values()) {
      clearTimeout(timer);
    }
    this.pendingRefresh.clear();
  }

  /** Scan all weather equipments for historized rain bindings. */
  private discoverRainEquipments(): void {
    const allEquipments = this.equipmentManager.getAllWithDetails();
    for (const eq of allEquipments) {
      if (eq.type !== "weather") continue;
      for (const binding of eq.dataBindings) {
        if (binding.category === "rain") {
          this.rainEquipmentIds.add(eq.id);
          break;
        }
      }
    }
  }

  /** Schedule a debounced InfluxDB refresh for an equipment. */
  private scheduleRefresh(equipmentId: string): void {
    const existing = this.pendingRefresh.get(equipmentId);
    if (existing) return;

    const timer = setTimeout(() => {
      this.pendingRefresh.delete(equipmentId);
      this.refreshFromInfluxDB(equipmentId).catch((err) =>
        this.logger.warn({ err, equipmentId }, "Failed to refresh rain cumuls from InfluxDB"),
      );
    }, DEBOUNCE_MS);

    this.pendingRefresh.set(equipmentId, timer);
  }

  /** Query InfluxDB to compute rain_1h and rain_24h for an equipment. */
  private async refreshFromInfluxDB(equipmentId: string): Promise<void> {
    const client = this.influxClient.getClient();
    const config = this.influxClient.getConfig();
    if (!client || !config) return;

    const queryApi = client.getQueryApi(config.org);
    const bucket = config.bucket;

    // rain_1h: sum of rain values over last 1 hour
    let rain1h: number | null = null;
    const flux1h = `from(bucket: "${bucket}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.category == "rain")
  |> filter(fn: (r) => r._field == "value_number")
  |> sum()`;

    try {
      for await (const { values, tableMeta } of queryApi.iterateRows(flux1h)) {
        const row = tableMeta.toObject(values) as { _value: number };
        rain1h = row._value;
      }
    } catch (err) {
      this.logger.warn({ err, equipmentId }, "Failed to query rain_1h");
    }

    // rain_24h: sum of rain values over last 24 hours
    let rain24h: number | null = null;
    const flux24h = `from(bucket: "${bucket}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.category == "rain")
  |> filter(fn: (r) => r._field == "value_number")
  |> sum()`;

    try {
      for await (const { values, tableMeta } of queryApi.iterateRows(flux24h)) {
        const row = tableMeta.toObject(values) as { _value: number };
        rain24h = row._value;
      }
    } catch (err) {
      this.logger.warn({ err, equipmentId }, "Failed to query rain_24h");
    }

    // Round to 1 decimal
    const cumul: RainCumuls = {
      rain1h: rain1h !== null ? Math.round(rain1h * 10) / 10 : null,
      rain24h: rain24h !== null ? Math.round(rain24h * 10) / 10 : null,
      lastUpdated: new Date().toISOString(),
    };

    this.cumuls.set(equipmentId, cumul);

    this.logger.debug({ equipmentId, ...cumul }, "Rain cumuls refreshed from InfluxDB");
  }

  /** Return computed data entries for a given equipment. */
  getComputedDataForEquipment(equipmentId: string): ComputedDataEntry[] {
    const cumul = this.cumuls.get(equipmentId);
    if (!cumul) return [];

    return [
      {
        alias: "rain_1h",
        value: cumul.rain1h,
        unit: "mm",
        category: "rain",
        lastUpdated: cumul.lastUpdated,
      },
      {
        alias: "rain_24h",
        value: cumul.rain24h,
        unit: "mm",
        category: "rain",
        lastUpdated: cumul.lastUpdated,
      },
    ];
  }
}
