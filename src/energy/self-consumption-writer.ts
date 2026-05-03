import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { TariffClassifier } from "./tariff-classifier.js";
import { Point } from "../core/influx-client.js";

/**
 * Maximum time skew (seconds) between the latest Grid energy tick and
 * the latest Solar energy tick we accept as "same window". Shelly
 * publishes em1data:0 and em1data:1 in immediate succession (a few ms
 * apart), so 30s is generous. A wider window risks pairing a stale tick
 * from one channel with a fresh one from the other when one channel
 * temporarily drops a minute (e.g. brief MQTT hiccup).
 */
const MATCH_WINDOW_S = 30;

interface LatestTick {
  /** Signed energy delta (Wh) over the last sampling window. */
  value: number;
  /** Epoch seconds. Source timestamp when present, else Date.now()/1000. */
  t: number;
}

/**
 * Self-consumption + household-energy normaliser.
 *
 * Inputs (signed energy deltas, Wh, per minute):
 *   gridΔ  = main_energy_meter `energy`        (positive = imported, negative = exported)
 *   solarΔ = energy_production_meter `energy`  (≥ 0 in normal operation)
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
 * (measurement, tag set, timestamp) — same source timestamp + same
 * equipmentId/alias tags ⇒ upsert wins last. Both writers commit a
 * couple of milliseconds apart on the same physical tick, so the
 * SelfConsumptionWriter's value always lands second and wins.
 *
 * Outputs per matched (Grid, Solar) tick, all timestamped at the source
 * minute:
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

  private latestGrid: LatestTick | null = null;
  private latestSolar: LatestTick | null = null;
  /** Epoch-minute of the last write — prevents double-writes when both
   *  events fire close in time and re-trigger compute. */
  private lastWrittenMinute = 0;

  private unsubscribe: (() => void) | null = null;

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

        const tick: LatestTick = {
          value: event.value,
          t: event.sourceTimestamp ?? Math.floor(Date.now() / 1000),
        };
        if (role === "grid") this.latestGrid = tick;
        else this.latestSolar = tick;

        this.tryCompute();
      } catch (err) {
        this.logger.error({ err }, "Error in self-consumption writer event handler");
      }
    });
    this.logger.info({}, "Self-consumption writer initialized");
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
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

  private tryCompute(): void {
    if (!this.latestGrid || !this.latestSolar) return;
    if (Math.abs(this.latestGrid.t - this.latestSolar.t) > MATCH_WINDOW_S) return;

    const ts = Math.max(this.latestGrid.t, this.latestSolar.t);
    const minuteBucket = Math.floor(ts / 60);
    if (minuteBucket === this.lastWrittenMinute) return;
    this.lastWrittenMinute = minuteBucket;

    const grid = this.latestGrid.value;
    const solar = this.latestSolar.value;
    const injection = Math.max(0, -grid);
    const autoconso = Math.max(0, solar - injection);
    const household = Math.max(0, grid) + autoconso;

    this.writePoints({ autoconso, injection, household, sourceTimestamp: ts });
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
