import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { TariffClassifier } from "./tariff-classifier.js";
import { Point } from "../core/influx-client.js";

/** How often a bucket left open by a silent stream is swept out (ms). */
const FLUSH_INTERVAL_MS = 60_000;

/**
 * One minute of paired Grid + Solar energy, accumulated.
 *
 * The minute is both the aggregation window and the pairing window: ticks
 * that land in the same minute belong to the same physical window whatever
 * the meter's reporting cadence. `hasGrid` / `hasSolar` tell a complete pair
 * from a half one — a minute that saw only one side is dropped rather than
 * paired with a stale value from the other.
 */
interface MinuteBucket {
  /** Epoch-second of the minute start these deltas belong to. */
  minuteS: number;
  gridWh: number;
  solarWh: number;
  hasGrid: boolean;
  hasSolar: boolean;
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
 * recomposed from `max(0, gridΔ) + autoconsoΔ`. This writer does it,
 * and overwrites the HistoryWriter's per-minute Influx points to match
 * the legacy semantic so the existing charts (Consumption + Production)
 * keep rendering correctly with no UI change. InfluxDB keys points by
 * (measurement, tag set, timestamp) — same timestamp + same
 * equipmentId/alias tags ⇒ upsert wins last. Both writers accumulate on
 * the same minute boundary and the HistoryWriter subscribes first, so the
 * SelfConsumptionWriter's value always lands second and wins.
 *
 * Outputs per accumulated minute, all timestamped at the minute start:
 *   On the production_meter:
 *     - autoconso = max(0, solarΔ - injection)   (solar consumed in-house)
 *     - injection = max(0, -gridΔ)               (excess solar pushed to grid)
 *   On the main_energy_meter (overwriting HistoryWriter):
 *     - energy    = household                    (was: signed grid delta)
 *     - energy_hp = TariffClassifier(household).hp
 *     - energy_hc = TariffClassifier(household).hc
 *
 * Properties:
 *   - autoconso + injection ≤ solarΔ
 *   - household = max(0, gridΔ) + autoconso = max(0, gridΔ) + max(0, solarΔ - max(0, -gridΔ))
 *
 * Discovery: equipment ids are resolved by `type` on every relevant event,
 * so users can add/remove the meters at runtime without restarting Sowel.
 *
 * Solo Grid (no production_meter): the writer is inert and the
 * HistoryWriter's grid-only hp/hc values stand — that's the right answer
 * when there's no solar to overlay.
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

        this.accumulate(role, event.value, event.sourceTimestamp ?? Math.floor(Date.now() / 1000));
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
  private accumulate(role: "grid" | "solar", value: number, t: number): void {
    const minuteS = Math.floor(t / 60) * 60;

    if (this.bucket && minuteS > this.bucket.minuteS) {
      const closed = this.bucket;
      this.bucket = null;
      this.writeBucket(closed);
    }
    // A tick for an already-closed minute (out-of-order source timestamps)
    // folds into the open one: misattributing a few Wh across a minute
    // boundary beats dropping them.
    if (!this.bucket) {
      this.bucket = { minuteS, gridWh: 0, solarWh: 0, hasGrid: false, hasSolar: false };
    }

    if (role === "grid") {
      this.bucket.gridWh += value;
      this.bucket.hasGrid = true;
    } else {
      this.bucket.solarWh += value;
      this.bucket.hasSolar = true;
    }
  }

  /** Derive autoconso / injection / household from a closed minute and write them. */
  private writeBucket(bucket: MinuteBucket): void {
    // Half a pair is not a window: without both sides the split is undefined,
    // and the HistoryWriter's raw grid values stand (solo-Grid behaviour).
    if (!bucket.hasGrid || !bucket.hasSolar) {
      this.logger.debug(
        { minuteS: bucket.minuteS, hasGrid: bucket.hasGrid, hasSolar: bucket.hasSolar },
        "Incomplete energy minute — no self-consumption split written",
      );
      return;
    }

    const injection = Math.max(0, -bucket.gridWh);
    const autoconso = Math.max(0, bucket.solarWh - injection);
    const household = Math.max(0, bucket.gridWh) + autoconso;

    this.writePoints({ autoconso, injection, household, sourceTimestamp: bucket.minuteS });
  }

  private writePoints(args: {
    autoconso: number;
    injection: number;
    household: number;
    sourceTimestamp: number;
  }): void {
    if (!this.influxClient.isConnected()) return;

    const prodEquipment = this.findProductionEquipment();
    const gridEquipment = this.findGridEquipment();
    if (!prodEquipment) return;

    const { autoconso, injection, household, sourceTimestamp } = args;

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

    // Grid-side overwrites — replace HistoryWriter's grid-only values
    // with the legacy household semantic (energy = total house, hp/hc =
    // TariffClassifier(household)). Same equipmentId + alias + timestamp
    // ⇒ Influx upsert.
    if (gridEquipment) {
      const split = this.tariffClassifier.classify(household, sourceTimestamp);
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
