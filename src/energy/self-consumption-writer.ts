import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { InfluxClient } from "../core/influx-client.js";
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
 * Computes household-level self-consumption split from Shelly Pro 3EM
 * and writes `autoconso` / `injection` aliases on the production
 * equipment so the existing energy API + UI display them as before.
 *
 * Inputs (signed energy deltas, Wh, per minute):
 *   gridΔ  = main_energy_meter `energy`     (positive = imported, negative = exported)
 *   solarΔ = energy_production_meter `energy` (≥ 0 in normal operation)
 *
 * Output (per minute, written to InfluxDB on the production equipmentId):
 *   injection = max(0, -gridΔ)              (excess solar pushed to the grid)
 *   autoconso = max(0, solarΔ - injection)  (solar consumed in-house)
 *
 * Properties:
 *   - autoconso + injection ≤ solarΔ      (split conserves total production)
 *   - house_total_consumption ≈ max(0, gridΔ) + autoconso (for charts that
 *     overlay autoconso on top of the grid HP/HC bars).
 *
 * Why this lives outside HistoryWriter: keeps each writer single-purpose
 * (the same precedent as TariffClassifier — the HP/HC writer is also
 * called out from HistoryWriter, but it's a self-contained helper).
 *
 * Discovery: equipment ids are resolved by `type` on every relevant event,
 * so users can add/remove the meters at runtime without restarting Sowel.
 */
export class SelfConsumptionWriter {
  private readonly logger: Logger;
  private readonly eventBus: EventBus;
  private readonly equipmentManager: EquipmentManager;
  private readonly influxClient: InfluxClient;

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
    logger: Logger,
  ) {
    this.eventBus = eventBus;
    this.equipmentManager = equipmentManager;
    this.influxClient = influxClient;
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

    this.writePoints(autoconso, injection, ts);
  }

  private writePoints(autoconso: number, injection: number, sourceTimestamp: number): void {
    if (!this.influxClient.isConnected()) return;

    const prodEquipment = this.findProductionEquipment();
    if (!prodEquipment) return;

    for (const [alias, value] of [
      ["autoconso", autoconso],
      ["injection", injection],
    ] as const) {
      const point = new Point("equipment_data")
        .tag("equipmentId", prodEquipment.id)
        .tag("alias", alias)
        .tag("category", "energy")
        .tag("zoneId", prodEquipment.zoneId)
        .tag("type", "number")
        .floatField("value_number", value)
        .timestamp(sourceTimestamp);

      this.influxClient.writePoint(point);
    }

    this.logger.trace({ autoconso, injection, sourceTimestamp }, "Self-consumption points written");
  }

  private findProductionEquipment(): { id: string; zoneId: string } | null {
    const eq = this.equipmentManager
      .getAll()
      .find((e) => e.type === "energy_production_meter" && e.enabled);
    if (!eq) return null;
    return { id: eq.id, zoneId: eq.zoneId };
  }
}
