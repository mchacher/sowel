import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { DataCategory } from "../shared/types.js";
import { TariffClassifier } from "../energy/tariff-classifier.js";
import type { InfluxClient } from "../core/influx-client.js";
import { Point } from "../core/influx-client.js";

// ============================================================
// History defaults — convention over configuration
// ============================================================

/** Categories historized ON by default. */
const CATEGORY_DEFAULTS_ON: ReadonlySet<string> = new Set([
  "temperature",
  "temperature_outdoor",
  "temperature_device",
  "humidity",
  "humidity_outdoor",
  "pressure",
  "luminosity",
  "power",
  "energy",
  "rain",
  "wind",
  "co2",
  "voc",
  "noise",
  "voltage",
  "current",
  "shutter_position",
  "battery",
]);

/** Aliases historized ON regardless of category (handles generic bindings). */
const ALIAS_DEFAULTS_ON: ReadonlySet<string> = new Set(["setpoint", "power"]);

/** Aliases forced OFF — live-only values, not useful as time series.
 * `energy_forward` / `energy_reverse` are the raw cumulative Shelly
 * counters: monotonically growing, several hundred kWh in absolute
 * terms. They are needed as latest values (Live page) but writing them
 * as time-series points would pollute every category=energy aggregation
 * with the cumul (sum-of-cumuls), since the EnergyAggregator and the
 * downsampling tasks group on category, not alias.
 *
 * `sum_rain_1` / `sum_rain_24` are the same class of bug for rain: Netatmo's
 * ROLLING 1h / 24h totals, re-reported at every poll. Historizing them makes
 * the rain chart plot a flat rolling total ("11.9 mm every hour") and makes
 * any `category == "rain"` |> sum() (WeatherAggregator) a sum-of-cumuls. The
 * incremental `rain` alias stays historized; the live rolling totals are read
 * from the equipment binding, not InfluxDB. */
const ALIAS_DEFAULTS_OFF: ReadonlySet<string> = new Set([
  "demand_30min",
  "energy_forward",
  "energy_reverse",
  "sum_rain_1",
  "sum_rain_24",
  "wind_angle",
  "gust_strength",
  "gust_angle",
]);

/** Deadband thresholds by category — skip writes if delta is below this. */
const DEADBAND: Record<string, number> = {
  temperature: 0.2,
  temperature_outdoor: 0.2,
  temperature_device: 0.2,
  humidity: 1.0,
  humidity_outdoor: 1.0,
  luminosity: 0.05, // 5% relative
  power: 5,
  energy: 0.01,
  shutter_position: 2,
  pressure: 0.5,
  voltage: 0.1,
  current: 0.05,
  battery: 1,
};

/** Minimum write interval in ms (default 30s). */
const DEFAULT_MIN_WRITE_INTERVAL = 30_000;

/** Maximum interval between writes in ms — forces a write even if value unchanged (default 5 min). */
const DEFAULT_MAX_WRITE_INTERVAL = 5 * 60_000;

/** How often stale energy minute buckets are swept out (ms). */
const ENERGY_FLUSH_INTERVAL_MS = 60_000;

/** Duration an energy bucket covers (s) — the window HP/HC is classified over. */
const ENERGY_BUCKET_WINDOW_S = 60;

interface LastWritten {
  value: unknown;
  timestamp: number;
}

/**
 * Open per-minute accumulator for one live energy-delta binding.
 * `minuteS` is the epoch-second of the minute start the deltas belong to.
 */
interface EnergyBucket {
  minuteS: number;
  wh: number;
  meta: BindingMeta;
}

// ============================================================
// HistoryWriter
// ============================================================

export class HistoryWriter {
  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private equipmentManager: EquipmentManager;
  private influxClient: InfluxClient;
  private tariffClassifier: TariffClassifier;
  private unsubscribe: (() => void) | null = null;

  /** Cache of historized binding IDs for fast lookup. */
  private historizedBindings: Set<string> = new Set();

  /** Binding metadata cache: bindingId → { alias, category, type, equipmentId, zoneId } */
  private bindingMeta: Map<string, BindingMeta> = new Map();

  /** Last written value per binding for deduplication. */
  private lastWritten: Map<string, LastWritten> = new Map();

  /** Open energy accumulators (one per live energy-delta binding). */
  private energyBuckets: Map<string, EnergyBucket> = new Map();

  /**
   * main_energy_meter ids whose `energy` / `energy_hp` / `energy_hc` series
   * are owned by the SelfConsumptionWriter. One authority per series: when an
   * energy_production_meter is configured, the SelfConsumptionWriter writes
   * the grid meter's household-semantic energy and this writer must not
   * touch those three aliases — two writers upserting the same points on
   * different flush triggers is a last-write-wins race. Refreshed with the
   * equipment cache, so adding/removing the production meter at runtime
   * hands ownership over without a restart.
   */
  private gridEnergyOwnedElsewhere: Set<string> = new Set();

  /** Sweeper for energy buckets whose minute has elapsed without new ticks. */
  private energyFlushTimer: ReturnType<typeof setInterval> | null = null;

  /** Resolved min write interval. */
  private minWriteInterval = DEFAULT_MIN_WRITE_INTERVAL;

  /** Resolved max write interval — forces periodic writes for stable values. */
  private maxWriteInterval = DEFAULT_MAX_WRITE_INTERVAL;

  constructor(
    _db: Database.Database,
    eventBus: EventBus,
    settingsManager: SettingsManager,
    equipmentManager: EquipmentManager,
    influxClient: InfluxClient,
    logger: Logger,
  ) {
    this.eventBus = eventBus;
    this.settingsManager = settingsManager;
    this.equipmentManager = equipmentManager;
    this.influxClient = influxClient;
    this.logger = logger.child({ module: "history-writer" });
    this.tariffClassifier = new TariffClassifier(settingsManager, logger);
  }

  /** Initialize: subscribe to events for writing history data. */
  init(): void {
    this.refreshCache();

    // Read configurable intervals
    const intervalSetting = this.settingsManager.get("history.minWriteInterval");
    if (intervalSetting) {
      const parsed = parseInt(intervalSetting, 10);
      if (!isNaN(parsed) && parsed > 0) this.minWriteInterval = parsed;
    }
    const maxSetting = this.settingsManager.get("history.maxWriteInterval");
    if (maxSetting) {
      const parsed = parseInt(maxSetting, 10);
      if (!isNaN(parsed) && parsed > 0) this.maxWriteInterval = parsed;
    }

    // Subscribe to events
    this.unsubscribe = this.eventBus.on((event) => {
      try {
        switch (event.type) {
          case "equipment.data.changed":
            this.handleEquipmentDataChanged(
              event.equipmentId,
              event.alias,
              event.value,
              event.previous,
              event.sourceTimestamp,
            );
            break;
          case "equipment.created":
          case "equipment.updated":
          case "equipment.removed":
            this.refreshCache();
            break;
        }
      } catch (err) {
        this.logger.error({ err }, "Error in history writer event handler");
      }
    });

    // Sweep energy buckets that stopped receiving ticks (device offline, or a
    // meter that only reports on change) so their minute still gets written.
    this.energyFlushTimer = setInterval(() => {
      try {
        this.flushEnergyBuckets();
      } catch (err) {
        this.logger.error({ err }, "Error flushing energy buckets");
      }
    }, ENERGY_FLUSH_INTERVAL_MS);
    this.energyFlushTimer.unref?.();

    this.logger.info(
      { historizedBindings: this.historizedBindings.size },
      "History writer initialized",
    );
  }

  /** Graceful shutdown — unsubscribes from events. InfluxDB lifecycle is managed externally. */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.energyFlushTimer) {
      clearInterval(this.energyFlushTimer);
      this.energyFlushTimer = null;
    }
    this.flushEnergyBuckets(true);
  }

  /** Get the count of effectively historized bindings. */
  getHistorizedCount(): number {
    return this.historizedBindings.size;
  }

  // ============================================================
  // Historize resolution
  // ============================================================

  /**
   * Resolve effective historize state for a binding.
   * Priority: explicit override → alias default → category default → OFF.
   */
  static resolveHistorize(
    historize: number | null | undefined,
    alias: string,
    category: DataCategory,
  ): boolean {
    // 1. Explicit override
    if (historize === 1) return true;
    if (historize === 0) return false;
    // 2. Alias exclusion (cumulative counters, forecast data — not useful as time series)
    if (ALIAS_DEFAULTS_OFF.has(alias)) return false;
    if (/^j\d+_/.test(alias)) return false; // forecast jX_* bindings — not historized
    // 3. Alias default
    if (ALIAS_DEFAULTS_ON.has(alias)) return true;
    // 4. Category default
    if (CATEGORY_DEFAULTS_ON.has(category)) return true;
    return false;
  }

  // ============================================================
  // Private: cache
  // ============================================================

  private refreshCache(): void {
    this.historizedBindings.clear();
    this.bindingMeta.clear();
    this.gridEnergyOwnedElsewhere.clear();

    const equipments = this.equipmentManager.getAll();

    const hasProductionMeter = equipments.some(
      (eq) => eq.type === "energy_production_meter" && eq.enabled,
    );
    if (hasProductionMeter) {
      for (const eq of equipments) {
        if (eq.type === "main_energy_meter" && eq.enabled) {
          this.gridEnergyOwnedElsewhere.add(eq.id);
        }
      }
    }

    for (const eq of equipments) {
      if (!eq.enabled) continue;
      const bindings = this.equipmentManager.getDataBindingsWithValues(eq.id);
      for (const b of bindings) {
        if (b.id.startsWith("virtual:")) continue; // Skip virtual bindings (gate state)
        const effectiveOn = HistoryWriter.resolveHistorize(
          b.historize ?? null,
          b.alias,
          b.category,
        );
        if (effectiveOn) {
          this.historizedBindings.add(b.id);
        }
        this.bindingMeta.set(b.id, {
          alias: b.alias,
          category: b.category,
          type: b.type,
          equipmentId: eq.id,
          zoneId: eq.zoneId,
        });
      }
    }

    this.logger.trace(
      { total: this.bindingMeta.size, historized: this.historizedBindings.size },
      "History cache refreshed",
    );
  }

  // ============================================================
  // Private: event handling
  // ============================================================

  private handleEquipmentDataChanged(
    equipmentId: string,
    alias: string,
    value: unknown,
    previous: unknown,
    sourceTimestamp?: number,
  ): void {
    if (!this.influxClient.isConnected()) return;
    if (value === null || value === undefined) return;

    // One authority per series: when a production meter is configured, the
    // SelfConsumptionWriter is the sole writer of the grid meter's `energy` /
    // `energy_hp` / `energy_hc` (household semantic) — for live deltas and
    // sourceTimestamp'd windows alike. Everything else (power, voltage,
    // energy_forward/reverse, sub-meters, the solar meter's own energy)
    // still flows through here.
    if (
      this.gridEnergyOwnedElsewhere.has(equipmentId) &&
      (alias === "energy" || alias === "energy_hp" || alias === "energy_hc")
    ) {
      return;
    }

    // Find binding by equipmentId + alias
    let bindingId: string | null = null;
    let meta: BindingMeta | null = null;
    for (const [id, m] of this.bindingMeta) {
      if (m.equipmentId === equipmentId && m.alias === alias) {
        bindingId = id;
        meta = m;
        break;
      }
    }

    if (!bindingId || !meta) return;
    if (!this.historizedBindings.has(bindingId)) return;

    // Live energy ticks are ADDITIVE deltas, not samples: each one carries the
    // Wh accumulated since the previous tick. Dropping one (deadband or
    // min-interval) silently loses that energy for good — and meters like the
    // Tuya PJ-1203A emit ~30 ticks a minute of which a single one carries the
    // 10 Wh counter jump, so the dedup was throwing away most of the energy.
    // Accumulate the whole minute and write one point aligned on the minute
    // start instead: nothing is lost and the point rate actually drops.
    if (
      sourceTimestamp === undefined &&
      meta.category === "energy" &&
      alias === "energy" &&
      typeof value === "number"
    ) {
      this.accumulateEnergyDelta(bindingId, meta, value);
      return;
    }

    // Skip deduplication for aligned historical writes (e.g. energy 30-min windows).
    // These are idempotent by design (same tags + timestamp = overwrite in InfluxDB).
    if (sourceTimestamp === undefined) {
      if (!this.shouldWrite(bindingId, meta, value, previous)) return;
    }

    // Build and write point
    const point = new Point("equipment_data")
      .tag("equipmentId", equipmentId)
      .tag("alias", alias)
      .tag("category", meta.category)
      .tag("zoneId", meta.zoneId)
      .tag("type", meta.type);

    if (meta.type === "number" && typeof value === "number") {
      point.floatField("value_number", value);
    } else if (meta.type === "boolean") {
      const boolVal = value === true || value === "ON" || value === "true";
      point.stringField("value_string", String(boolVal));
      point.floatField("value_number", boolVal ? 1 : 0);
    } else {
      point.stringField("value_string", String(value));
    }

    // Use aligned source timestamp when provided (e.g. energy 30-min windows)
    if (sourceTimestamp !== undefined) {
      point.timestamp(sourceTimestamp);
    }

    this.influxClient.writePoint(point);

    // Write HP/HC split for energy data points
    if (meta.category === "energy" && alias === "energy" && typeof value === "number") {
      this.writeEnergyHpHc(equipmentId, meta, value, sourceTimestamp);
    }

    // Update last written
    this.lastWritten.set(bindingId, { value, timestamp: Date.now() });
  }

  /** Get the TariffClassifier instance (for API routes). */
  getTariffClassifier(): TariffClassifier {
    return this.tariffClassifier;
  }

  // ============================================================
  // Private: live energy accumulation
  // ============================================================

  /** Fold one live energy delta into its minute bucket, flushing the previous one. */
  private accumulateEnergyDelta(bindingId: string, meta: BindingMeta, value: number): void {
    const minuteS = Math.floor(Date.now() / 60_000) * 60;
    const bucket = this.energyBuckets.get(bindingId);

    if (!bucket) {
      this.energyBuckets.set(bindingId, { minuteS, wh: value, meta });
      return;
    }
    // Same minute, or a straggler for a minute we already closed over: fold it
    // into the open bucket rather than losing it. Wh is Wh — a few seconds of
    // misattribution beats a hole in the series.
    if (minuteS <= bucket.minuteS) {
      bucket.wh += value;
      bucket.meta = meta;
      return;
    }

    this.flushEnergyBucket(bindingId, bucket);
    this.energyBuckets.set(bindingId, { minuteS, wh: value, meta });
  }

  /**
   * Write out energy buckets whose minute has elapsed.
   *
   * Also the shutdown / test hook: `force` flushes the still-open minute too,
   * so a stopping engine does not drop the Wh it has already accumulated.
   */
  flushEnergyBuckets(force = false): void {
    const currentMinuteS = Math.floor(Date.now() / 60_000) * 60;
    for (const [bindingId, bucket] of this.energyBuckets) {
      if (!force && bucket.minuteS >= currentMinuteS) continue;
      this.flushEnergyBucket(bindingId, bucket);
      this.energyBuckets.delete(bindingId);
    }
  }

  /** Write one accumulated minute (energy + HP/HC split) at the aligned timestamp. */
  private flushEnergyBucket(bindingId: string, bucket: EnergyBucket): void {
    if (!this.influxClient.isConnected()) return;
    // Ownership may have moved to the SelfConsumptionWriter while this
    // bucket was open (production meter added at runtime) — dropping the
    // partial minute beats racing its writes on the same series.
    if (this.gridEnergyOwnedElsewhere.has(bucket.meta.equipmentId)) return;

    const { meta, minuteS, wh } = bucket;
    const point = new Point("equipment_data")
      .tag("equipmentId", meta.equipmentId)
      .tag("alias", meta.alias)
      .tag("category", meta.category)
      .tag("zoneId", meta.zoneId)
      .tag("type", meta.type)
      .floatField("value_number", wh)
      .timestamp(minuteS);

    this.influxClient.writePoint(point);
    this.writeEnergyHpHc(meta.equipmentId, meta, wh, minuteS, ENERGY_BUCKET_WINDOW_S);

    this.lastWritten.set(bindingId, { value: wh, timestamp: Date.now() });
    this.logger.trace(
      { equipmentId: meta.equipmentId, wh, minuteS },
      "Energy minute accumulated and written",
    );
  }

  // ============================================================
  // Private: energy HP/HC classification
  // ============================================================

  /**
   * Write energy_hp and energy_hc points based on tariff classification.
   * Called after the main `energy` point is written.
   */
  private writeEnergyHpHc(
    equipmentId: string,
    meta: BindingMeta,
    totalWh: number,
    sourceTimestamp?: number,
    windowSeconds?: number,
  ): void {
    const windowEpoch = sourceTimestamp ?? Math.floor(Date.now() / 1000);
    const split = this.tariffClassifier.classify(totalWh, windowEpoch, windowSeconds);

    for (const [alias, value] of [
      ["energy_hp", split.hp],
      ["energy_hc", split.hc],
    ] as const) {
      const hpHcPoint = new Point("equipment_data")
        .tag("equipmentId", equipmentId)
        .tag("alias", alias)
        .tag("category", meta.category)
        .tag("zoneId", meta.zoneId)
        .tag("type", meta.type);

      hpHcPoint.floatField("value_number", value);

      if (sourceTimestamp !== undefined) {
        hpHcPoint.timestamp(sourceTimestamp);
      }

      this.influxClient.writePoint(hpHcPoint);
    }

    this.logger.trace(
      { equipmentId, totalWh, hp: split.hp, hc: split.hc },
      "Energy HP/HC points written",
    );
  }

  // ============================================================
  // Private: deduplication
  // ============================================================

  private shouldWrite(
    bindingId: string,
    meta: BindingMeta,
    value: unknown,
    previous: unknown,
  ): boolean {
    const logCtx = { bindingId, category: meta.category, alias: meta.alias, value };

    // Force write on boolean/enum state transitions
    if (meta.type === "boolean" || meta.type === "enum") {
      if (value !== previous) {
        this.logger.trace({ ...logCtx, previous, reason: "state-transition" }, "History write");
        return true;
      }
      this.logger.trace({ ...logCtx, reason: "same-value" }, "History skip");
      return false;
    }

    const last = this.lastWritten.get(bindingId);
    if (!last) {
      this.logger.trace({ ...logCtx, reason: "first-write" }, "History write");
      return true;
    }

    // Minimum interval check
    const elapsed = Date.now() - last.timestamp;
    if (elapsed < this.minWriteInterval) {
      this.logger.trace({ ...logCtx, elapsedMs: elapsed, reason: "min-interval" }, "History skip");
      return false;
    }

    // Maximum interval — force write even if value unchanged (keeps charts fresh)
    if (elapsed > this.maxWriteInterval) {
      this.logger.trace({ ...logCtx, elapsedMs: elapsed, reason: "max-interval" }, "History write");
      return true;
    }

    // Deadband check for numeric values
    if (meta.type === "number" && typeof value === "number" && typeof last.value === "number") {
      const deadband = DEADBAND[meta.category];
      if (deadband !== undefined) {
        const delta = Math.abs(value - (last.value as number));
        // Special case: luminosity uses relative deadband (5%)
        if (meta.category === "luminosity") {
          const threshold = Math.abs(last.value as number) * deadband;
          if (delta < Math.max(threshold, 1)) {
            this.logger.trace(
              { ...logCtx, delta, threshold: Math.max(threshold, 1), reason: "deadband-lux" },
              "History skip",
            );
            return false;
          }
        } else {
          if (delta < deadband) {
            this.logger.trace({ ...logCtx, delta, deadband, reason: "deadband" }, "History skip");
            return false;
          }
        }
      }
      // No deadband configured → write on any change
      if (value !== last.value) {
        this.logger.trace({ ...logCtx, reason: "value-changed" }, "History write");
        return true;
      }
      this.logger.trace({ ...logCtx, reason: "same-value" }, "History skip");
      return false;
    }

    // Default: write on any change
    if (value !== last.value) {
      this.logger.trace({ ...logCtx, reason: "value-changed" }, "History write");
      return true;
    }
    this.logger.trace({ ...logCtx, reason: "same-value" }, "History skip");
    return false;
  }
}

interface BindingMeta {
  alias: string;
  category: DataCategory;
  type: string;
  equipmentId: string;
  zoneId: string;
}
