/**
 * Daily temperature extremes tracker (spec 134, widened by spec 211).
 *
 * Tracks, per thermometer binding, the minimum and maximum value observed
 * since local midnight, and exposes them as computed data entries
 * `<alias>_min_today` / `<alias>_max_today`. Which bindings: see `isTracked`.
 * The class keeps its spec 134 name; it is no longer `weather`-only.
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
import { localDateStr } from "../shared/local-date.js";

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
  /**
   * Spec 211 FR1.3 — instant of the last sample integrated into the envelope,
   * even one that did not widen it. In memory only (no SQLite write per
   * sample); empty after a reload, when `updatedAt` stands in for it.
   */
  lastSampleAt?: string;
}

const TRACKED_CATEGORIES = new Set<DataCategory>(["temperature", "temperature_outdoor"]);
/** How long the tracked-aliases cache of an equipment is trusted. */
const TRACKED_TTL_MS = 60_000;

// Day keys come from the shared formatter: three private copies of this exact
// function drifted apart once before (the spec 061 timezone bugs), and a fix
// landing in one and not the others is precisely how they did.
const localDay = localDateStr;

/**
 * Spec 211 FR1.1 — which bindings get today's extremes.
 * - `weather`: every binding of a spec 134 category, as before.
 * - any other type: what the core already treats as a room temperature
 *   (category `temperature` with alias `temperature`, the zone aggregator's
 *   rule — a setpoint never matches), plus any `temperature_outdoor` binding.
 */
export function isTracked(
  equipmentType: string,
  binding: { alias: string; category: DataCategory },
): boolean {
  if (equipmentType === "weather") return TRACKED_CATEGORIES.has(binding.category);
  if (binding.category === "temperature_outdoor") return true;
  return binding.category === "temperature" && binding.alias === "temperature";
}

export class WeatherTempExtremesTracker {
  private readonly db: Database.Database;
  private readonly eventBus: EventBus;
  private readonly equipmentManager: EquipmentManager;
  private readonly logger: Logger;

  /** equipmentId → alias → envelope */
  private readonly state = new Map<string, Map<string, Envelope>>();
  /**
   * equipmentId → tracked alias → category, so a sample costs a map lookup
   * rather than a bindings query (every equipment's samples reach this
   * handler since spec 211). Dropped on equipment.created/updated/removed,
   * and rebuilt after TRACKED_TTL_MS: a plugin that reclassifies a device
   * data category on rediscovery emits no equipment event.
   */
  private readonly trackedCache = new Map<
    string,
    { at: number; aliases: Map<string, DataCategory> }
  >();
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
      if (event.type === "equipment.created" || event.type === "equipment.updated") {
        this.trackedCache.delete(event.equipment.id);
        return;
      }
      if (event.type !== "equipment.removed") return;
      this.trackedCache.delete(event.equipmentId);
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
   * ComputedDataProvider entry — daily extremes of the tracked bindings.
   * Rows from past days are hidden (pre-first-sample mornings show nothing
   * rather than yesterday's envelope).
   */
  getComputedDataForEquipment(equipmentId: string): ComputedDataEntry[] {
    const perAlias = this.state.get(equipmentId);
    if (!perAlias) return [];
    const tracked = this.trackedOf(equipmentId);

    const today = localDay(new Date());
    const entries: ComputedDataEntry[] = [];
    for (const [alias, env] of perAlias) {
      if (env.day !== today) continue;
      // A binding that stopped qualifying (retyped equipment, renamed alias)
      // keeps its row until midnight, but is no longer shown.
      if (!tracked.has(alias)) continue;
      const lastUpdated = env.lastSampleAt ?? env.updatedAt;
      entries.push(
        {
          alias: `${alias}_min_today`,
          value: env.min,
          unit: "°C",
          category: env.category,
          lastUpdated,
        },
        {
          alias: `${alias}_max_today`,
          value: env.max,
          unit: "°C",
          category: env.category,
          lastUpdated,
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

    const category = this.trackedOf(equipmentId).get(alias);
    if (!category) return;

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
      env = {
        day: today,
        min: value,
        max: value,
        category,
        updatedAt,
        lastSampleAt: updatedAt,
      };
    } else if (value < current.min || value > current.max) {
      env = {
        ...current,
        min: Math.min(current.min, value),
        max: Math.max(current.max, value),
        updatedAt,
        lastSampleAt: updatedAt,
      };
    } else {
      // Inside the envelope: nothing to persist, but the entries' lastUpdated
      // follows the sample (spec 211 FR1.3), so a minimum reached at 06:30
      // does not read as stale at 18:00.
      current.lastSampleAt = updatedAt;
      return;
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

  /** The tracked aliases of an equipment and their categories (see `trackedCache`). */
  private trackedOf(equipmentId: string): Map<string, DataCategory> {
    const now = Date.now();
    const cached = this.trackedCache.get(equipmentId);
    if (cached && now - cached.at < TRACKED_TTL_MS) return cached.aliases;
    const tracked = new Map<string, DataCategory>();
    const eq = this.equipmentManager.getById(equipmentId);
    if (eq) {
      for (const b of this.equipmentManager.getDataBindingsWithValues(equipmentId)) {
        if (isTracked(eq.type, b)) tracked.set(b.alias, b.category);
      }
    }
    this.trackedCache.set(equipmentId, { at: now, aliases: tracked });
    return tracked;
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
