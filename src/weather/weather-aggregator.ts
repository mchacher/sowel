/**
 * WeatherAggregator — Computes rain cumuls at equipment level.
 *
 * Listens to equipment.data.changed events for rain bindings as a trigger.
 * On trigger, computes:
 *   - rain_1h: rain total over the last 1 hour (mm)
 *   - rain_24h: rain total over the last 24 hours (mm)
 *
 * Prefers the station's NATIVE rolling cumulatives (Netatmo `sum_rain_1` /
 * `sum_rain_24`) read from the live binding — those already ARE the 1h / 24h
 * totals. Summing their historized samples would multiply them by the poll
 * count (sum-of-cumuls; see the `sum_rain_*` note in history-writer). Only a
 * station without a native cumulative falls back to summing the incremental
 * `rain` series from InfluxDB.
 *
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

/** Rain aliases whose change should trigger a cumul refresh. */
const RAIN_TRIGGER_ALIASES: ReadonlySet<string> = new Set(["rain", "sum_rain_1", "sum_rain_24"]);

interface RainBinding {
  alias: string;
  value: unknown;
}

function roundTenth(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}

/**
 * Compute rain_1h / rain_24h for a weather equipment.
 *
 * Prefers the native rolling cumulatives (`sum_rain_1` / `sum_rain_24`): when a
 * binding is present its live value IS the total, so it is used as-is (never
 * summed). Only when a native cumulative is absent does it fall back to
 * `sumIncrementalRain`, which sums the incremental `rain` series over the window.
 */
export async function computeRainCumuls(
  bindings: RainBinding[],
  sumIncrementalRain: (window: "-1h" | "-24h") => Promise<number | null>,
): Promise<{ rain1h: number | null; rain24h: number | null }> {
  // undefined → binding absent (fall back); null → present but no numeric value.
  const nativeValue = (alias: string): number | null | undefined => {
    const b = bindings.find((x) => x.alias === alias);
    if (!b) return undefined;
    if (b.value === null || b.value === undefined || b.value === "") return null;
    const n = typeof b.value === "number" ? b.value : Number(b.value);
    return Number.isFinite(n) ? n : null;
  };

  const native1h = nativeValue("sum_rain_1");
  const native24h = nativeValue("sum_rain_24");

  const rain1h = native1h !== undefined ? native1h : await sumIncrementalRain("-1h");
  const rain24h = native24h !== undefined ? native24h : await sumIncrementalRain("-24h");

  return { rain1h: roundTenth(rain1h), rain24h: roundTenth(rain24h) };
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
      await this.refreshCumuls(equipmentId);
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

      // Only trigger on rain-related alias changes (incremental or rolling cumulative)
      if (!RAIN_TRIGGER_ALIASES.has(event.alias)) return;

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
      this.refreshCumuls(equipmentId).catch((err) =>
        this.logger.warn({ err, equipmentId }, "Failed to refresh rain cumuls from InfluxDB"),
      );
    }, DEBOUNCE_MS);

    this.pendingRefresh.set(equipmentId, timer);
  }

  /** Compute rain_1h and rain_24h for an equipment and cache them. */
  private async refreshCumuls(equipmentId: string): Promise<void> {
    const bindings = this.equipmentManager.getDataBindingsWithValues(equipmentId);
    const { rain1h, rain24h } = await computeRainCumuls(bindings, (window) =>
      this.sumIncrementalRain(equipmentId, window),
    );

    const cumul: RainCumuls = {
      rain1h,
      rain24h,
      lastUpdated: new Date().toISOString(),
    };
    this.cumuls.set(equipmentId, cumul);
    this.logger.debug({ equipmentId, ...cumul }, "Rain cumuls refreshed");
  }

  /**
   * Fallback for stations without a native rolling cumulative: sum the
   * incremental `rain` alias over the window. Alias-scoped, so it never sums a
   * cumulative series (`sum_rain_*`).
   */
  private async sumIncrementalRain(
    equipmentId: string,
    window: "-1h" | "-24h",
  ): Promise<number | null> {
    const client = this.influxClient.getClient();
    const config = this.influxClient.getConfig();
    if (!client || !config) return null;

    const queryApi = client.getQueryApi(config.org);
    const flux = `from(bucket: "${config.bucket}")
  |> range(start: ${window})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "rain")
  |> filter(fn: (r) => r._field == "value_number")
  |> sum()`;

    let total: number | null = null;
    try {
      for await (const { values, tableMeta } of queryApi.iterateRows(flux)) {
        total = (tableMeta.toObject(values) as { _value: number })._value;
      }
    } catch (err) {
      this.logger.warn({ err, equipmentId, window }, "Failed to sum incremental rain");
    }
    return total;
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
