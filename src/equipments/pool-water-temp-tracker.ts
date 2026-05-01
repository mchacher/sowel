/**
 * Pool water temperature tracker — exposes a computed `effective_water_temperature`
 * data entry on every `pool_heat_pump` equipment.
 *
 * Rationale: a pool heat pump only reads a meaningful water temperature when
 * water is actively flowing through its sensor — typically when the filtration
 * pump is running (or, as a fallback, when the heat pump itself is in any
 * non-OFF mode). When water is stagnant, the sensor reads stale air or pipe
 * temperature, which is not representative of the pool.
 *
 * The tracker therefore caches the **last active** water temperature sample
 * per equipment and exposes it as `effective_water_temperature`:
 *
 *   - filtration_state alias bound + ON  → live water_temperature, cache updated
 *   - filtration_state alias bound + OFF → cached value (within 24h) or null
 *   - filtration_state not bound, mode != OFF → live water_temperature
 *   - filtration_state not bound, mode == OFF → cached value (within 24h) or null
 *   - filtration_state not bound, mode not bound → live water_temperature (no gating)
 *
 * Aliases consumed (must come from the equipment's own bindings):
 *   - `temperature`        — the live water temperature reading from the PAC
 *   - `filtration_state`   — optional: ON/OFF signal of the filtration pump
 *   - `mode`               — optional: heat pump operating mode (OFF | SMART | BOOST | ECO | …)
 */

import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { ComputedDataEntry } from "../shared/types.js";
import type { EquipmentManager } from "./equipment-manager.js";

interface PoolWaterTempRow {
  equipment_id: string;
  last_active_value: number | null;
  last_active_ts: string | null;
}

interface InMemoryState {
  equipmentId: string;
  lastActiveValue: number | null;
  lastActiveTs: number | null; // epoch ms
}

const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

const TRACKED_ALIASES = new Set(["temperature", "filtration_state", "mode"]);

export class PoolWaterTempTracker {
  private readonly db: Database.Database;
  private readonly eventBus: EventBus;
  private readonly equipmentManager: EquipmentManager;
  private readonly logger: Logger;

  private readonly state = new Map<string, InMemoryState>();
  private unsubscribe: (() => void) | null = null;
  private unsubscribeEqRemoved: (() => void) | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly stmts;

  constructor(
    db: Database.Database,
    eventBus: EventBus,
    equipmentManager: EquipmentManager,
    logger: Logger,
  ) {
    this.db = db;
    this.eventBus = eventBus;
    this.equipmentManager = equipmentManager;
    this.logger = logger.child({ module: "pool-water-temp-tracker" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      upsert: this.db.prepare(
        `INSERT INTO pool_water_temp_state (equipment_id, last_active_value, last_active_ts)
         VALUES (@equipmentId, @lastActiveValue, @lastActiveTs)
         ON CONFLICT(equipment_id) DO UPDATE SET
           last_active_value = excluded.last_active_value,
           last_active_ts = excluded.last_active_ts`,
      ),
      selectAll: this.db.prepare(`SELECT * FROM pool_water_temp_state`),
      deleteOne: this.db.prepare(`DELETE FROM pool_water_temp_state WHERE equipment_id = ?`),
    };
  }

  start(): void {
    this.loadFromDb();

    this.unsubscribe = this.eventBus.on((event) => {
      if (event.type !== "equipment.data.changed") return;
      try {
        if (!TRACKED_ALIASES.has(event.alias)) return;
        if (event.alias === "effective_water_temperature") return; // safety guard
        this.recompute(event.equipmentId);
      } catch (err) {
        this.logger.error(
          { err, equipmentId: event.equipmentId },
          "pool-water-temp: handler error",
        );
      }
    });

    this.unsubscribeEqRemoved = this.eventBus.on((event) => {
      if (event.type !== "equipment.removed") return;
      this.state.delete(event.equipmentId);
      this.stmts.deleteOne.run(event.equipmentId);
    });

    // Re-evaluate every 5 minutes so the 24h cap kicks in even without an
    // incoming data event (e.g. filtration has been off for 25h, no update).
    this.intervalId = setInterval(() => this.tick(), 5 * 60_000);

    this.logger.info({ tracked: this.state.size }, "Pool water temp tracker started");
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.unsubscribe?.();
    this.unsubscribeEqRemoved?.();
  }

  /**
   * ComputedDataProvider entry. Returns `effective_water_temperature` for
   * `pool_heat_pump` equipments.
   */
  getComputedDataForEquipment(equipmentId: string): ComputedDataEntry[] {
    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq || eq.type !== "pool_heat_pump") return [];
    const value = this.computeEffective(equipmentId, Date.now());
    return [
      {
        alias: "effective_water_temperature",
        value,
        unit: "°C",
        category: "pool_water_temperature",
        lastUpdated: new Date().toISOString(),
      },
    ];
  }

  // ────────────────────────────────────────────────────────────────

  /**
   * Read the latest values of (temperature, filtration_state, mode) from the
   * equipment's bindings, update the active cache if appropriate, then return
   * the current `effective_water_temperature`.
   */
  private computeEffective(equipmentId: string, now: number): number | null {
    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq || eq.type !== "pool_heat_pump") return null;

    const bindings = this.equipmentManager.getDataBindingsWithValues(equipmentId);
    const water = pickAliasNumber(bindings, "temperature");
    const filtState = pickAlias(bindings, "filtration_state");
    const mode = pickAlias(bindings, "mode");

    const isActive = decideActive(filtState, mode);

    if (isActive && water !== null) {
      let s = this.state.get(equipmentId);
      if (!s) {
        s = { equipmentId, lastActiveValue: null, lastActiveTs: null };
        this.state.set(equipmentId, s);
      }
      s.lastActiveValue = water;
      s.lastActiveTs = now;
      this.persist(s);
      return water;
    }

    const s = this.state.get(equipmentId);
    if (s && s.lastActiveTs && s.lastActiveValue !== null) {
      if (now - s.lastActiveTs < FRESHNESS_WINDOW_MS) {
        return s.lastActiveValue;
      }
    }
    return null;
  }

  /**
   * Re-evaluate one equipment in response to an equipment.data.changed event,
   * and emit the resulting `effective_water_temperature` so the UI can refresh.
   */
  private recompute(equipmentId: string): void {
    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq || eq.type !== "pool_heat_pump") return;
    const value = this.computeEffective(equipmentId, Date.now());
    this.eventBus.emit({
      type: "equipment.data.changed",
      equipmentId,
      alias: "effective_water_temperature",
      value,
      previous: null,
    });
  }

  /**
   * Periodic tick: re-emit `effective_water_temperature` for every tracked
   * equipment so the UI reflects the 24h cap rolling over even without
   * incoming sensor data.
   */
  private tick(): void {
    const now = Date.now();
    for (const equipmentId of this.state.keys()) {
      const eq = this.equipmentManager.getById(equipmentId);
      if (!eq || eq.type !== "pool_heat_pump") continue;
      const value = this.computeEffective(equipmentId, now);
      this.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId,
        alias: "effective_water_temperature",
        value,
        previous: null,
      });
    }
  }

  private persist(s: InMemoryState): void {
    this.stmts.upsert.run({
      equipmentId: s.equipmentId,
      lastActiveValue: s.lastActiveValue,
      lastActiveTs: s.lastActiveTs ? new Date(s.lastActiveTs).toISOString() : null,
    });
  }

  private loadFromDb(): void {
    const rows = this.stmts.selectAll.all() as PoolWaterTempRow[];
    for (const r of rows) {
      this.state.set(r.equipment_id, {
        equipmentId: r.equipment_id,
        lastActiveValue: r.last_active_value,
        lastActiveTs: r.last_active_ts ? new Date(r.last_active_ts).getTime() : null,
      });
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit testing)
// ────────────────────────────────────────────────────────────────

interface AliasedBinding {
  alias: string;
  value: unknown;
}

export function pickAlias(bindings: readonly AliasedBinding[], alias: string): unknown {
  const b = bindings.find((x) => x.alias === alias);
  return b ? b.value : undefined;
}

export function pickAliasNumber(bindings: readonly AliasedBinding[], alias: string): number | null {
  const v = pickAlias(bindings, alias);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Decide whether the heat pump's water sensor reading is "active" — i.e. water
 * is flowing past the sensor and the temperature can be trusted.
 *
 * Priority: filtration_state if bound; then mode if bound; otherwise default
 * to active (the user has not provided any gating signal).
 */
export function decideActive(filtration: unknown, mode: unknown): boolean {
  if (filtration !== undefined) {
    if (typeof filtration === "boolean") return filtration;
    if (typeof filtration === "number") return filtration !== 0;
    if (typeof filtration === "string") {
      const u = filtration.toUpperCase();
      return u === "ON" || u === "TRUE" || u === "1";
    }
    return false;
  }
  if (mode !== undefined) {
    if (typeof mode === "string") return mode.toUpperCase() !== "OFF";
    if (typeof mode === "number") return mode !== 0;
    return true;
  }
  return true;
}

/**
 * Pure evaluator used by unit tests: given the inputs and prior state,
 * return the new state and the effective value to expose.
 */
export function evaluateEffectiveWaterTemperature(args: {
  water: number | null;
  filtration: unknown;
  mode: unknown;
  prior: { lastActiveValue: number | null; lastActiveTs: number | null };
  now: number;
}): {
  effective: number | null;
  next: { lastActiveValue: number | null; lastActiveTs: number | null };
} {
  const { water, filtration, mode, prior, now } = args;
  const isActive = decideActive(filtration, mode);
  if (isActive && water !== null) {
    return {
      effective: water,
      next: { lastActiveValue: water, lastActiveTs: now },
    };
  }
  if (
    prior.lastActiveTs !== null &&
    prior.lastActiveValue !== null &&
    now - prior.lastActiveTs < FRESHNESS_WINDOW_MS
  ) {
    return { effective: prior.lastActiveValue, next: prior };
  }
  return { effective: null, next: prior };
}
