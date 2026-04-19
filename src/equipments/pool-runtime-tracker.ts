/**
 * Pool runtime tracker — accumulates daily ON-time for every pool_pump equipment.
 *
 * Listens to `equipment.data.changed` events. When a pool_pump's ON/OFF data
 * transitions from OFF→ON, records the timestamp. From ON→OFF, adds the elapsed
 * time to `cumulative_seconds_today`. Persists state in SQLite so the counter
 * survives restarts. Resets at local midnight via a 60s tick.
 */

import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { ComputedDataEntry } from "../shared/types.js";
import type { EquipmentManager } from "./equipment-manager.js";

interface PoolRuntimeRow {
  equipment_id: string;
  current_state: string;
  state_since: string;
  cumulative_seconds_today: number;
  last_reset_date: string;
}

interface InMemoryState {
  equipmentId: string;
  currentState: "ON" | "OFF" | "UNKNOWN";
  stateSince: number; // epoch ms
  cumulativeSecondsToday: number;
  lastResetDate: string; // YYYY-MM-DD
}

export class PoolRuntimeTracker {
  private readonly db: Database.Database;
  private readonly eventBus: EventBus;
  private readonly equipmentManager: EquipmentManager;
  private readonly logger: Logger;

  private readonly state = new Map<string, InMemoryState>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private unsubscribeData: (() => void) | null = null;
  private unsubscribeEqRemoved: (() => void) | null = null;
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
    this.logger = logger.child({ module: "pool-runtime-tracker" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      upsert: this.db.prepare(
        `INSERT INTO pool_runtime_state (equipment_id, current_state, state_since, cumulative_seconds_today, last_reset_date)
         VALUES (@equipmentId, @currentState, @stateSince, @cumulativeSecondsToday, @lastResetDate)
         ON CONFLICT(equipment_id) DO UPDATE SET
           current_state = excluded.current_state,
           state_since = excluded.state_since,
           cumulative_seconds_today = excluded.cumulative_seconds_today,
           last_reset_date = excluded.last_reset_date`,
      ),
      selectAll: this.db.prepare(`SELECT * FROM pool_runtime_state`),
      deleteOne: this.db.prepare(`DELETE FROM pool_runtime_state WHERE equipment_id = ?`),
    };
  }

  start(): void {
    this.loadFromDb();

    // Apply a startup reset if any state's lastResetDate is stale.
    const today = this.localDateString();
    for (const s of this.state.values()) {
      if (s.lastResetDate !== today) {
        s.cumulativeSecondsToday = 0;
        s.lastResetDate = today;
        this.persist(s);
      }
    }

    // Subscribe to equipment data changes.
    this.unsubscribeData = this.eventBus.on((event) => {
      if (event.type !== "equipment.data.changed") return;
      try {
        this.handleEquipmentDataChanged(event.equipmentId, event.alias, event.value);
      } catch (err) {
        this.logger.error({ err, equipmentId: event.equipmentId }, "pool-runtime: handler error");
      }
    });

    this.unsubscribeEqRemoved = this.eventBus.on((event) => {
      if (event.type !== "equipment.removed") return;
      this.state.delete(event.equipmentId);
      this.stmts.deleteOne.run(event.equipmentId);
    });

    this.intervalId = setInterval(() => this.tick(), 60_000);
    this.logger.info({ tracked: this.state.size }, "Pool runtime tracker started");
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.unsubscribeData?.();
    this.unsubscribeEqRemoved?.();
  }

  /**
   * Return the cumulative seconds today for the given equipment, including any
   * currently running ON interval (live value).
   */
  getRuntime(equipmentId: string): number {
    const s = this.state.get(equipmentId);
    if (!s) return 0;
    return this.liveCumulative(s);
  }

  /**
   * ComputedDataProvider entry: surfaces `runtime_daily` (in seconds) on every
   * pool_pump equipment, so the UI can display it like any other data binding.
   * Returns an empty array for any equipment we have no state for.
   */
  getComputedDataForEquipment(equipmentId: string): ComputedDataEntry[] {
    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq || eq.type !== "pool_pump") return [];
    const s = this.state.get(equipmentId);
    const value = s ? this.liveCumulative(s) : 0;
    return [
      {
        alias: "runtime_daily",
        value,
        unit: "s",
        category: "runtime_daily",
        lastUpdated: new Date().toISOString(),
      },
    ];
  }

  // ────────────────────────────────────────────────────────────────

  private handleEquipmentDataChanged(equipmentId: string, alias: string, value: unknown): void {
    // Skip our own derived alias to avoid re-entry loops (runtime_daily values
    // like 0 would otherwise look like an OFF transition and corrupt state).
    if (alias === "runtime_daily") return;

    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq || eq.type !== "pool_pump") return;

    // We track the first ON/OFF-like alias of the equipment.
    if (!this.isOnOffAlias(alias, value)) return;

    const upper = String(value).toUpperCase();
    const isOn = upper === "ON" || upper === "TRUE" || upper === "1";
    const isOff = upper === "OFF" || upper === "FALSE" || upper === "0";
    if (!isOn && !isOff) return;

    let s = this.state.get(equipmentId);
    if (!s) {
      s = {
        equipmentId,
        currentState: "UNKNOWN",
        stateSince: Date.now(),
        cumulativeSecondsToday: 0,
        lastResetDate: this.localDateString(),
      };
      this.state.set(equipmentId, s);
    }

    const now = Date.now();
    const nextState = isOn ? "ON" : "OFF";

    // First transition from UNKNOWN — just record the state, no elapsed time counted.
    if (s.currentState === "UNKNOWN") {
      s.currentState = nextState;
      s.stateSince = now;
      this.persist(s);
      return;
    }

    // No change — just refresh timestamp (keep counting smoothly).
    if (s.currentState === nextState) return;

    if (s.currentState === "ON" && nextState === "OFF") {
      // Close the ON interval.
      const elapsedMs = Math.max(0, now - s.stateSince);
      s.cumulativeSecondsToday += Math.floor(elapsedMs / 1000);
    }

    s.currentState = nextState;
    s.stateSince = now;
    this.persist(s);

    // Emit the updated runtime_daily to keep UI in sync.
    this.eventBus.emit({
      type: "equipment.data.changed",
      equipmentId,
      alias: "runtime_daily",
      value: this.liveCumulative(s),
      previous: null,
    });
  }

  private isOnOffAlias(_alias: string, value: unknown): boolean {
    // We accept any alias whose value is an ON/OFF-like string or boolean.
    if (typeof value === "boolean") return true;
    if (typeof value === "number") return value === 0 || value === 1;
    if (typeof value !== "string") return false;
    const u = value.toUpperCase();
    return u === "ON" || u === "OFF" || u === "TRUE" || u === "FALSE";
  }

  private tick(): void {
    const today = this.localDateString();
    for (const s of this.state.values()) {
      if (s.lastResetDate === today) continue;

      // Close any open ON interval (count until end of previous day = start of today at 00:00).
      if (s.currentState === "ON") {
        const midnight = this.startOfLocalDayMs(today);
        const elapsedMs = Math.max(0, midnight - s.stateSince);
        s.cumulativeSecondsToday += Math.floor(elapsedMs / 1000);
        // If still ON, resume accounting from midnight.
        s.stateSince = midnight;
      }
      s.cumulativeSecondsToday = 0;
      s.lastResetDate = today;
      this.persist(s);

      this.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: s.equipmentId,
        alias: "runtime_daily",
        value: 0,
        previous: null,
      });
    }
  }

  private liveCumulative(s: InMemoryState): number {
    if (s.currentState !== "ON") return s.cumulativeSecondsToday;
    const elapsedMs = Math.max(0, Date.now() - s.stateSince);
    return s.cumulativeSecondsToday + Math.floor(elapsedMs / 1000);
  }

  private persist(s: InMemoryState): void {
    this.stmts.upsert.run({
      equipmentId: s.equipmentId,
      currentState: s.currentState,
      stateSince: new Date(s.stateSince).toISOString(),
      cumulativeSecondsToday: s.cumulativeSecondsToday,
      lastResetDate: s.lastResetDate,
    });
  }

  private loadFromDb(): void {
    const rows = this.stmts.selectAll.all() as PoolRuntimeRow[];
    for (const r of rows) {
      this.state.set(r.equipment_id, {
        equipmentId: r.equipment_id,
        currentState: (r.current_state as InMemoryState["currentState"]) ?? "UNKNOWN",
        stateSince: new Date(r.state_since).getTime(),
        cumulativeSecondsToday: r.cumulative_seconds_today,
        lastResetDate: r.last_reset_date,
      });
    }
  }

  private localDateString(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  private startOfLocalDayMs(dateStr: string): number {
    // dateStr = YYYY-MM-DD local
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  }
}
