/**
 * Weather daily temperature extremes tracker (spec 134).
 *
 * Tracks, per `weather` equipment and per temperature binding, the minimum
 * and maximum value observed since local midnight, and exposes them as
 * computed data entries `<alias>_min_today` / `<alias>_max_today`.
 *
 * Vendor-agnostic by design: some stations (Netatmo) report daily min/max
 * themselves, most don't — Sowel derives the envelope from the temperature
 * samples it already receives, so any station that reports a temperature
 * gets min/max for free.
 *
 * Midnight rollover is lazy: the first sample of a new day resets the
 * envelope, and `getComputedDataForEquipment` hides rows from past days,
 * so no timer is required for correctness. Persistence (SQLite) keeps the
 * envelope across restarts; long-term history remains InfluxDB's job.
 */

import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { ComputedDataEntry, DataCategory } from "../shared/types.js";
import type { EquipmentManager } from "./equipment-manager.js";

interface ExtremesRow {
  equipment_id: string;
  alias: string;
  day: string;
  min_value: number;
  max_value: number;
  updated_at: string;
}

interface Envelope {
  day: string;
  min: number;
  max: number;
  category: DataCategory;
  updatedAt: string;
}

const TRACKED_CATEGORIES = new Set<DataCategory>(["temperature", "temperature_outdoor"]);

/** Local calendar day of the server timezone (same convention as energy day boundaries). */
function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export class WeatherTempExtremesTracker {
  private readonly db: Database.Database;
  private readonly eventBus: EventBus;
  private readonly equipmentManager: EquipmentManager;
  private readonly logger: Logger;

  /** equipmentId → alias → envelope */
  private readonly state = new Map<string, Map<string, Envelope>>();
  private unsubscribeData: (() => void) | null = null;
  private unsubscribeRemoved: (() => void) | null = null;
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
    this.logger = logger.child({ module: "weather-temp-extremes" });
    this.stmts = {
      upsert: this.db.prepare(
        `INSERT INTO weather_temp_extremes (equipment_id, alias, day, min_value, max_value, updated_at)
         VALUES (@equipmentId, @alias, @day, @minValue, @maxValue, @updatedAt)
         ON CONFLICT(equipment_id, alias) DO UPDATE SET
           day = excluded.day,
           min_value = excluded.min_value,
           max_value = excluded.max_value,
           updated_at = excluded.updated_at`,
      ),
      selectAll: this.db.prepare(`SELECT * FROM weather_temp_extremes`),
      deleteEquipment: this.db.prepare(`DELETE FROM weather_temp_extremes WHERE equipment_id = ?`),
    };
  }

  start(): void {
    this.loadFromDb();

    this.unsubscribeData = this.eventBus.on((event) => {
      if (event.type !== "equipment.data.changed") return;
      try {
        this.handleSample(event.equipmentId, event.alias, event.value);
      } catch (err) {
        this.logger.error(
          { err, equipmentId: event.equipmentId, alias: event.alias },
          "weather-temp-extremes: handler error",
        );
      }
    });

    this.unsubscribeRemoved = this.eventBus.on((event) => {
      if (event.type !== "equipment.removed") return;
      this.state.delete(event.equipmentId);
      this.stmts.deleteEquipment.run(event.equipmentId);
    });

    this.logger.info({ equipments: this.state.size }, "Weather temp extremes tracker started");
  }

  stop(): void {
    this.unsubscribeData?.();
    this.unsubscribeData = null;
    this.unsubscribeRemoved?.();
    this.unsubscribeRemoved = null;
  }

  /**
   * ComputedDataProvider entry — daily extremes for `weather` equipments.
   * Rows from past days are hidden (pre-first-sample mornings show nothing
   * rather than yesterday's envelope).
   */
  getComputedDataForEquipment(equipmentId: string): ComputedDataEntry[] {
    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq || eq.type !== "weather") return [];
    const perAlias = this.state.get(equipmentId);
    if (!perAlias) return [];

    const today = localDay(new Date());
    const entries: ComputedDataEntry[] = [];
    for (const [alias, env] of perAlias) {
      if (env.day !== today) continue;
      entries.push(
        {
          alias: `${alias}_min_today`,
          value: env.min,
          unit: "°C",
          category: env.category,
          lastUpdated: env.updatedAt,
        },
        {
          alias: `${alias}_max_today`,
          value: env.max,
          unit: "°C",
          category: env.category,
          lastUpdated: env.updatedAt,
        },
      );
    }
    return entries;
  }

  // ────────────────────────────────────────────────────────────────

  private handleSample(equipmentId: string, alias: string, value: unknown): void {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    // Ignore our own computed aliases (safety against feedback loops).
    if (alias.endsWith("_min_today") || alias.endsWith("_max_today")) return;

    const eq = this.equipmentManager.getById(equipmentId);
    if (!eq || eq.type !== "weather") return;

    const binding = this.equipmentManager
      .getDataBindingsWithValues(equipmentId)
      .find((b) => b.alias === alias);
    if (!binding || !TRACKED_CATEGORIES.has(binding.category)) return;

    const now = new Date();
    const today = localDay(now);
    const updatedAt = now.toISOString();

    let perAlias = this.state.get(equipmentId);
    if (!perAlias) {
      perAlias = new Map();
      this.state.set(equipmentId, perAlias);
    }

    const current = perAlias.get(alias);
    let env: Envelope;
    if (!current || current.day !== today) {
      // First sample of the day (or of ever): the envelope starts here.
      env = { day: today, min: value, max: value, category: binding.category, updatedAt };
    } else if (value < current.min || value > current.max) {
      env = {
        ...current,
        min: Math.min(current.min, value),
        max: Math.max(current.max, value),
        updatedAt,
      };
    } else {
      return; // inside the envelope — nothing to update or persist
    }

    perAlias.set(alias, env);
    this.stmts.upsert.run({
      equipmentId,
      alias,
      day: env.day,
      minValue: env.min,
      maxValue: env.max,
      updatedAt: env.updatedAt,
    });

    // Re-emit the computed aliases so the WebSocket layer pushes a fresh
    // equipment payload (same convention as the pool trackers). handleSample
    // ignores *_min_today / *_max_today, so this cannot loop.
    for (const [computedAlias, computedValue] of [
      [`${alias}_min_today`, env.min],
      [`${alias}_max_today`, env.max],
    ] as const) {
      this.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId,
        alias: computedAlias,
        value: computedValue,
        previous: null,
      });
    }
  }

  private loadFromDb(): void {
    const rows = this.stmts.selectAll.all() as ExtremesRow[];
    const today = localDay(new Date());
    for (const row of rows) {
      // Past-day rows are left in place (overwritten on the next sample) but
      // not loaded — getComputedDataForEquipment would hide them anyway.
      if (row.day !== today) continue;
      const binding = this.equipmentManager
        .getDataBindingsWithValues(row.equipment_id)
        .find((b) => b.alias === row.alias);
      const category: DataCategory = binding?.category ?? "temperature";
      let perAlias = this.state.get(row.equipment_id);
      if (!perAlias) {
        perAlias = new Map();
        this.state.set(row.equipment_id, perAlias);
      }
      perAlias.set(row.alias, {
        day: row.day,
        min: row.min_value,
        max: row.max_value,
        category,
        updatedAt: row.updated_at,
      });
    }
  }
}
