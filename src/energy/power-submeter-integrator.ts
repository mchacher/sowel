import type Database from "better-sqlite3";
import { Point } from "@influxdata/influxdb-client";
import type { EventBus } from "../core/event-bus.js";
import type { Logger } from "../core/logger.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { InfluxClient } from "../core/influx-client.js";

/**
 * Power-only submeter integration.
 *
 * Devices like the Legrand GEM zigbee clamps report only instantaneous
 * power (W). To historize their consumption alongside the main meter we
 * trapezoidal-integrate W between samples and write the result, in 1-minute
 * delta Wh chunks, to InfluxDB on the submeter's `equipmentId`.
 *
 * Why deltas, not cumulatives: the existing energy downsampling tasks
 * (`sowel-energy-sum-hourly`, `sowel-energy-sum-daily`) sum on
 * `category=energy`. Cumulative writes would multiply absurdly. Deltas
 * line up with how the main meter writes today.
 *
 * Stale guard: a sample older than STALE_THRESHOLD_S compared to the new
 * one means the device was offline. We do not extrapolate over that gap —
 * the new sample resets the integration baseline without crediting any
 * pending Wh.
 *
 * Negative power: zigbee clamps sometimes report a negative reading when
 * wired backwards. Per spec 091 we integrate the absolute value, log
 * once, and continue. We never emit negative Wh deltas.
 */

const STALE_THRESHOLD_S = 600; // 10 minutes
const FLUSH_INTERVAL_MS = 60_000; // 1 minute
const MIN_WRITE_WH = 0.001; // skip writing absurdly small deltas

interface IntegratorState {
  pendingWh: number;
  /** Lifetime Wh integrated by Sowel for this submeter. Surfaced as
   *  computed data on the equipment so the user sees something growing. */
  cumulativeWh: number;
  lastSampleAt: number | null; // epoch seconds
  lastSampleW: number | null;
  lastWriteAt: string | null;
  warnedNegative: boolean;
}

interface StateRow {
  equipment_id: string;
  pending_wh: number;
  cumulative_wh: number;
  last_sample_at: string | null;
  last_sample_w: number | null;
  last_write_at: string | null;
}

export class PowerSubmeterIntegrator {
  private readonly logger: Logger;
  private readonly states: Map<string, IntegratorState> = new Map();
  private unsubscribe: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private stmts!: ReturnType<typeof this.prepareStatements>;
  private now: () => number;
  private flushIntervalMs: number;

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    private readonly equipmentManager: EquipmentManager,
    private readonly influxClient: InfluxClient,
    logger: Logger,
    options: { now?: () => number; flushIntervalMs?: number } = {},
  ) {
    this.logger = logger.child({ module: "power-submeter-integrator" });
    this.now = options.now ?? (() => Date.now());
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
  }

  init(): void {
    this.stmts = this.prepareStatements();
    this.loadStateFromDb();
  }

  start(): void {
    this.unsubscribe = this.eventBus.on((event) => {
      try {
        if (event.type === "equipment.data.changed") {
          this.handleEvent(event.equipmentId, event.alias, event.value);
        } else if (
          event.type === "equipment.created" ||
          event.type === "equipment.updated" ||
          event.type === "equipment.removed"
        ) {
          // Equipment list may have changed — re-evaluate which equipments
          // qualify as power-only submeters on the next sample.
        }
      } catch (err) {
        this.logger.error({ err }, "Error in submeter integrator event handler");
      }
    });

    this.flushTimer = setInterval(() => {
      try {
        this.flushAll();
      } catch (err) {
        this.logger.error({ err }, "Error flushing submeter integrators");
      }
    }, this.flushIntervalMs);

    this.logger.info({ submeters: this.states.size }, "Power submeter integrator started");
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Test / shutdown helper: flush pending Wh deltas to InfluxDB now.
   */
  flushAll(): void {
    for (const [equipmentId, state] of this.states) {
      this.flushOne(equipmentId, state);
    }
  }

  // ============================================================
  // Internal
  // ============================================================

  private prepareStatements() {
    return {
      selectAll: this.db.prepare(`SELECT * FROM submeter_integrator_state`),
      upsert: this.db.prepare(
        `INSERT INTO submeter_integrator_state (equipment_id, pending_wh, cumulative_wh, last_sample_at, last_sample_w, last_write_at, updated_at)
         VALUES (@equipmentId, @pendingWh, @cumulativeWh, @lastSampleAt, @lastSampleW, @lastWriteAt, datetime('now'))
         ON CONFLICT(equipment_id) DO UPDATE SET
           pending_wh = excluded.pending_wh,
           cumulative_wh = excluded.cumulative_wh,
           last_sample_at = excluded.last_sample_at,
           last_sample_w = excluded.last_sample_w,
           last_write_at = excluded.last_write_at,
           updated_at = datetime('now')`,
      ),
    };
  }

  private loadStateFromDb(): void {
    const rows = this.stmts.selectAll.all() as StateRow[];
    for (const row of rows) {
      this.states.set(row.equipment_id, {
        pendingWh: row.pending_wh,
        cumulativeWh: row.cumulative_wh,
        lastSampleAt: row.last_sample_at ? Math.floor(Date.parse(row.last_sample_at) / 1000) : null,
        lastSampleW: row.last_sample_w,
        lastWriteAt: row.last_write_at,
        warnedNegative: false,
      });
    }
  }

  /**
   * Decide if an equipment is a power-only submeter (i.e. `energy_meter`
   * with a `power` data binding and no `energy` binding). Computed each
   * time because bindings are stable enough that recomputing is cheap.
   */
  private isPowerOnlySubmeter(equipmentId: string): boolean {
    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq || eq.type !== "energy_meter" || !eq.enabled) return false;
    const bindings = this.equipmentManager.getDataBindingsWithValues(equipmentId);
    const hasPower = bindings.some((b) => b.alias === "power" || b.category === "power");
    const hasEnergy = bindings.some((b) => b.alias === "energy" || b.category === "energy");
    return hasPower && !hasEnergy;
  }

  private handleEvent(equipmentId: string, alias: string, value: unknown): void {
    if (alias !== "power") return;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    if (!this.isPowerOnlySubmeter(equipmentId)) return;

    const nowS = Math.floor(this.now() / 1000);
    const state = this.states.get(equipmentId) ?? {
      pendingWh: 0,
      cumulativeWh: 0,
      lastSampleAt: null,
      lastSampleW: null,
      lastWriteAt: null,
      warnedNegative: false,
    };

    const currentW = value;
    let absW = currentW;
    if (currentW < 0) {
      if (!state.warnedNegative) {
        this.logger.warn(
          { equipmentId, sampleW: currentW },
          "Negative power on submeter — integrating absolute value (clamp likely wired backwards)",
        );
        state.warnedNegative = true;
      }
      absW = -currentW;
    }

    if (state.lastSampleAt !== null && state.lastSampleW !== null) {
      const dtS = nowS - state.lastSampleAt;
      if (dtS > 0 && dtS <= STALE_THRESHOLD_S) {
        const prevAbsW = Math.abs(state.lastSampleW);
        const meanW = (prevAbsW + absW) / 2;
        const deltaWh = (meanW * dtS) / 3600;
        state.pendingWh += deltaWh;
        state.cumulativeWh += deltaWh;
      } else if (dtS > STALE_THRESHOLD_S) {
        this.logger.debug({ equipmentId, dtS }, "Stale sample, skipping integration window");
      }
    }

    state.lastSampleAt = nowS;
    state.lastSampleW = currentW;
    this.states.set(equipmentId, state);
    this.persist(equipmentId, state);
  }

  private flushOne(equipmentId: string, state: IntegratorState): void {
    if (state.pendingWh < MIN_WRITE_WH) return;
    if (!this.influxClient.isConnected()) return;

    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq) return;

    // Align timestamp on minute boundary so points cleanly downsample.
    const minuteEpochMs = Math.floor(this.now() / 60_000) * 60_000;

    const point = new Point("equipment_data")
      .tag("equipmentId", equipmentId)
      .tag("alias", "energy")
      .tag("category", "energy")
      .tag("zoneId", eq.zoneId)
      .tag("type", "number")
      .floatField("value_number", state.pendingWh)
      .timestamp(Math.floor(minuteEpochMs / 1000));

    this.influxClient.writePoint(point);

    this.logger.trace(
      { equipmentId, deltaWh: state.pendingWh, time: new Date(minuteEpochMs).toISOString() },
      "Submeter delta written",
    );

    state.pendingWh = 0;
    state.lastWriteAt = new Date(minuteEpochMs).toISOString();
    this.persist(equipmentId, state);
  }

  private persist(equipmentId: string, state: IntegratorState): void {
    const lastSampleAtIso =
      state.lastSampleAt !== null ? new Date(state.lastSampleAt * 1000).toISOString() : null;
    this.stmts.upsert.run({
      equipmentId,
      pendingWh: state.pendingWh,
      cumulativeWh: state.cumulativeWh,
      lastSampleAt: lastSampleAtIso,
      lastSampleW: state.lastSampleW,
      lastWriteAt: state.lastWriteAt,
    });
  }

  /**
   * ComputedDataProvider: surface a live `energy` cumulative on the submeter
   * equipment so the user sees a growing Wh value alongside the raw `power`
   * binding. Called by EquipmentManager when serializing the equipment.
   */
  getComputedDataForEquipment(
    equipmentId: string,
  ): import("../shared/types.js").ComputedDataEntry[] {
    const state = this.states.get(equipmentId);
    if (!state) return [];
    if (!this.isPowerOnlySubmeter(equipmentId)) return [];
    const lastUpdated =
      state.lastSampleAt !== null ? new Date(state.lastSampleAt * 1000).toISOString() : null;
    return [
      {
        alias: "energy",
        value: Math.round(state.cumulativeWh * 100) / 100,
        unit: "Wh",
        category: "energy",
        lastUpdated,
      },
    ];
  }
}
