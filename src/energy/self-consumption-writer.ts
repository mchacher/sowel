import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { TariffClassifier } from "./tariff-classifier.js";
import { Point } from "../core/influx-client.js";

/** How often a bucket left open by a silent stream is swept out (ms). */
const FLUSH_INTERVAL_MS = 60_000;

/** Tariff window of a live per-minute bucket (s). */
const LIVE_WINDOW_S = 60;

/** Tariff window of a plugin-supplied aligned historical window (s). */
const ALIGNED_WINDOW_S = 1800;

/**
 * One minute of paired Grid + Solar energy, accumulated.
 *
 * The minute is both the aggregation window and the pairing window: ticks
 * that land in the same minute belong to the same physical window whatever
 * the meter's reporting cadence. `hasGrid` / `hasSolar` record which sides
 * reported: a minute with a grid tick is always written (a missing solar
 * tick means autoconso = 0, i.e. pure grid import), while a solar-only
 * minute is dropped — injection is undefined without the grid side.
 */
interface MinuteBucket {
  /** Epoch-second of the minute start these deltas belong to. */
  minuteS: number;
  gridWh: number;
  solarWh: number;
  hasGrid: boolean;
  hasSolar: boolean;
  /**
   * Window length handed to the TariffClassifier, in seconds. A live stream
   * accumulates one minute; a plugin posting aligned historical windows
   * (Netatmo / Legrand, `sourceTimestamp` set) already covers 30 minutes, and
   * classifying it as one minute would mis-prorate a tariff transition.
   */
  windowS: number;
}

/**
 * Self-consumption + household-energy normaliser.
 *
 * Inputs (signed energy deltas, Wh, per minute):
 *   gridΔ  = main_energy_meter `energy`        (positive = imported, negative = exported)
 *   solarΔ = energy_production_meter `energy`  (≥ 0 in normal operation)
 *
 * Both are ADDITIVE deltas: a meter may emit one tick a minute (Shelly EM)
 * or thirty (Tuya PJ-1203A, where a single tick in the burst carries the
 * 10 Wh counter jump and the rest are 0). So a minute of ticks is summed,
 * not sampled — sampling one pair per minute is what used to pin
 * `autoconso` / `injection` to 0 on burst-reporting meters and leave the
 * Production chart empty.
 *
 * The plugin emits the raw signed grid delta on the main_energy_meter,
 * which the HistoryWriter writes to Influx and uses to classify HP/HC.
 * That representation is internally consistent (grid imports only) but
 * does not match the legacy Netatmo semantic the consumption chart was
 * designed against:
 *
 *     legacy: hp + hc = TOTAL HOUSEHOLD consumption (grid + solar)
 *             autoconso ⊂ hp + hc (the share covered by solar)
 *
 * With Shelly delivering raw counters, the household total has to be
 * recomposed from `max(0, gridΔ) + autoconsoΔ`. This writer does it, and
 * it is the SOLE writer of the grid meter's `energy` / `energy_hp` /
 * `energy_hc` series whenever an energy_production_meter is configured:
 * the HistoryWriter skips those three aliases for the main_energy_meter
 * in that case (see HistoryWriter.refreshCache). One authority per
 * series — no upsert over another writer's points, no dependency on
 * subscription order or on both writers closing their minute on the same
 * trigger.
 *
 * Outputs per accumulated minute, all timestamped at the minute start.
 * Every minute that saw a grid tick is written — a missing solar tick
 * just means autoconso = 0 (pure grid import), so the household series
 * has no holes:
 *   On the production_meter:
 *     - autoconso = max(0, solarΔ - injection)   (solar consumed in-house)
 *     - injection = max(0, -gridΔ)               (excess solar pushed to grid)
 *   On the main_energy_meter:
 *     - energy    = household                    (grid emits the signed delta)
 *     - energy_hp = TariffClassifier(household).hp
 *     - energy_hc = TariffClassifier(household).hc
 *
 * Properties:
 *   - autoconso + injection ≤ solarΔ (when the solar side reported)
 *   - household = max(0, gridΔ) + autoconso = max(0, gridΔ) + max(0, solarΔ - max(0, -gridΔ))
 *
 * Discovery: equipment ids are resolved by `type` on every relevant event,
 * so users can add/remove the meters at runtime without restarting Sowel.
 *
 * Solo Grid (no production_meter): the writer is inert and the
 * HistoryWriter writes the grid `energy` / hp / hc as before — that's the
 * right answer when there's no solar to overlay.
 */
export class SelfConsumptionWriter {
  private readonly logger: Logger;
  private readonly eventBus: EventBus;
  private readonly equipmentManager: EquipmentManager;
  private readonly influxClient: InfluxClient;
  private readonly tariffClassifier: TariffClassifier;

  /** The minute currently being accumulated, or null before the first tick. */
  private bucket: MinuteBucket | null = null;

  private unsubscribe: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    eventBus: EventBus,
    equipmentManager: EquipmentManager,
    influxClient: InfluxClient,
    tariffClassifier: TariffClassifier,
    logger: Logger,
  ) {
    this.eventBus = eventBus;
    this.equipmentManager = equipmentManager;
    this.influxClient = influxClient;
    this.tariffClassifier = tariffClassifier;
    this.logger = logger.child({ module: "self-consumption-writer" });
  }

  init(): void {
    this.unsubscribe = this.eventBus.on((event) => {
      try {
        if (event.type !== "equipment.data.changed") return;
        if (event.alias !== "energy") return;
        if (typeof event.value !== "number") return;

        const role = this.resolveEquipmentRole(event.equipmentId);
        if (!role) return;

        this.accumulate(
          role,
          event.value,
          event.sourceTimestamp ?? Math.floor(Date.now() / 1000),
          event.sourceTimestamp !== undefined,
        );
      } catch (err) {
        this.logger.error({ err }, "Error in self-consumption writer event handler");
      }
    });

    // A minute only closes when a tick from the next one arrives. If the
    // stream goes quiet (device offline, integration restart) the last minute
    // would sit in memory forever — sweep it out on its own.
    this.flushTimer = setInterval(() => {
      try {
        this.flushPending();
      } catch (err) {
        this.logger.error({ err }, "Error flushing self-consumption bucket");
      }
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();

    this.logger.info({}, "Self-consumption writer initialized");
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushPending(true);
  }

  /**
   * Write out the accumulated minute once it has elapsed.
   *
   * Also the shutdown / test hook: `force` flushes the still-open minute.
   */
  flushPending(force = false): void {
    if (!this.bucket) return;
    const currentMinuteS = Math.floor(Date.now() / 60_000) * 60;
    if (!force && this.bucket.minuteS >= currentMinuteS) return;
    const bucket = this.bucket;
    this.bucket = null;
    this.writeBucket(bucket);
  }

  /**
   * Resolve the role of an equipmentId by querying the EquipmentManager
   * fresh each time. Cheaper than maintaining a cache that has to track
   * `equipment.created/updated/removed` and the type-change edge case.
   */
  private resolveEquipmentRole(equipmentId: string): "grid" | "solar" | null {
    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq?.enabled) return null;
    if (eq.type === "main_energy_meter") return "grid";
    if (eq.type === "energy_production_meter") return "solar";
    return null;
  }

  /** Fold one tick into the open minute, closing the previous one first. */
  private accumulate(role: "grid" | "solar", value: number, t: number, aligned: boolean): void {
    const minuteS = Math.floor(t / 60) * 60;
    const windowS = aligned ? ALIGNED_WINDOW_S : LIVE_WINDOW_S;

    if (this.bucket && minuteS > this.bucket.minuteS) {
      const closed = this.bucket;
      this.bucket = null;
      this.writeBucket(closed);
    }
    // A tick for an already-closed minute (out-of-order source timestamps)
    // folds into the open one: misattributing a few Wh across a minute
    // boundary beats dropping them.
    if (!this.bucket) {
      this.bucket = { minuteS, gridWh: 0, solarWh: 0, hasGrid: false, hasSolar: false, windowS };
    }

    if (role === "grid") {
      this.bucket.gridWh += value;
      this.bucket.hasGrid = true;
      // HP/HC is classified on the household total, whose window is the grid
      // side's: it is the meter that says how much time this bucket covers.
      this.bucket.windowS = windowS;
    } else {
      this.bucket.solarWh += value;
      this.bucket.hasSolar = true;
    }
  }

  /** Derive autoconso / injection / household from a closed minute and write them. */
  private writeBucket(bucket: MinuteBucket): void {
    // As sole writer of the grid series we must cover every minute the grid
    // reported: no solar tick simply means autoconso = 0 (pure import).
    // A solar-only minute stays undefined — injection needs the grid side —
    // so it is dropped rather than guessed.
    if (!bucket.hasGrid) {
      this.logger.debug(
        { minuteS: bucket.minuteS, hasSolar: bucket.hasSolar },
        "Energy minute without grid tick — no self-consumption split written",
      );
      return;
    }

    const injection = Math.max(0, -bucket.gridWh);
    const autoconso = Math.max(0, bucket.solarWh - injection);
    const household = Math.max(0, bucket.gridWh) + autoconso;

    this.writePoints({
      autoconso,
      injection,
      household,
      sourceTimestamp: bucket.minuteS,
      windowS: bucket.windowS,
    });
  }

  private writePoints(args: {
    autoconso: number;
    injection: number;
    household: number;
    sourceTimestamp: number;
    windowS: number;
  }): void {
    if (!this.influxClient.isConnected()) return;

    const prodEquipment = this.findProductionEquipment();
    const gridEquipment = this.findGridEquipment();
    if (!prodEquipment) return;

    const { autoconso, injection, household, sourceTimestamp, windowS } = args;

    // Production-side aliases (autoconso, injection) — new points.
    for (const [alias, value] of [
      ["autoconso", autoconso],
      ["injection", injection],
    ] as const) {
      this.writeEquipmentDataPoint({
        equipmentId: prodEquipment.id,
        zoneId: prodEquipment.zoneId,
        alias,
        value,
        sourceTimestamp,
      });
    }

    // Grid-side series — this writer is their sole author when a production
    // meter is configured (energy = total house, hp/hc =
    // TariffClassifier(household) over the bucket's real duration).
    if (gridEquipment) {
      const split = this.tariffClassifier.classify(household, sourceTimestamp, windowS);
      for (const [alias, value] of [
        ["energy", household],
        ["energy_hp", split.hp],
        ["energy_hc", split.hc],
      ] as const) {
        this.writeEquipmentDataPoint({
          equipmentId: gridEquipment.id,
          zoneId: gridEquipment.zoneId,
          alias,
          value,
          sourceTimestamp,
        });
      }
    }

    this.logger.trace(
      { autoconso, injection, household, sourceTimestamp },
      "Self-consumption points written",
    );
  }

  private writeEquipmentDataPoint(args: {
    equipmentId: string;
    zoneId: string;
    alias: string;
    value: number;
    sourceTimestamp: number;
  }): void {
    const point = new Point("equipment_data")
      .tag("equipmentId", args.equipmentId)
      .tag("alias", args.alias)
      .tag("category", "energy")
      .tag("zoneId", args.zoneId)
      .tag("type", "number")
      .floatField("value_number", args.value)
      .timestamp(args.sourceTimestamp);
    this.influxClient.writePoint(point);
  }

  private findProductionEquipment(): { id: string; zoneId: string } | null {
    const eq = this.equipmentManager
      .getAll()
      .find((e) => e.type === "energy_production_meter" && e.enabled);
    if (!eq) return null;
    return { id: eq.id, zoneId: eq.zoneId };
  }

  private findGridEquipment(): { id: string; zoneId: string } | null {
    const eq = this.equipmentManager
      .getAll()
      .find((e) => e.type === "main_energy_meter" && e.enabled);
    if (!eq) return null;
    return { id: eq.id, zoneId: eq.zoneId };
  }
}
