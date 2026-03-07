import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { DataCategory } from "../shared/types.js";
import { InfluxClient, Point } from "./influx-client.js";

// ============================================================
// History defaults — convention over configuration
// ============================================================

/** Categories historized ON by default. */
const CATEGORY_DEFAULTS_ON: ReadonlySet<string> = new Set([
  "temperature",
  "humidity",
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

/** Deadband thresholds by category — skip writes if delta is below this. */
const DEADBAND: Record<string, number> = {
  temperature: 0.2,
  humidity: 1.0,
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

interface LastWritten {
  value: unknown;
  timestamp: number;
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
  private unsubscribe: (() => void) | null = null;

  /** Cache of historized binding IDs for fast lookup. */
  private historizedBindings: Set<string> = new Set();

  /** Binding metadata cache: bindingId → { alias, category, type, equipmentId, zoneId } */
  private bindingMeta: Map<string, BindingMeta> = new Map();

  /** Last written value per binding for deduplication. */
  private lastWritten: Map<string, LastWritten> = new Map();

  /** Resolved min write interval. */
  private minWriteInterval = DEFAULT_MIN_WRITE_INTERVAL;

  /** Resolved max write interval — forces periodic writes for stable values. */
  private maxWriteInterval = DEFAULT_MAX_WRITE_INTERVAL;

  constructor(
    _db: Database.Database,
    eventBus: EventBus,
    settingsManager: SettingsManager,
    equipmentManager: EquipmentManager,
    logger: Logger,
  ) {
    this.eventBus = eventBus;
    this.settingsManager = settingsManager;
    this.equipmentManager = equipmentManager;
    this.logger = logger.child({ module: "history-writer" });
    this.influxClient = new InfluxClient(logger);
  }

  /** Initialize: connect to InfluxDB if configured, subscribe to events. */
  init(): void {
    this.tryConnect();
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
            );
            break;
          case "equipment.created":
          case "equipment.updated":
          case "equipment.removed":
            this.refreshCache();
            break;
          case "settings.changed":
            if (event.keys.some((k) => k.startsWith("history."))) {
              this.tryConnect();
            }
            break;
        }
      } catch (err) {
        this.logger.error({ err }, "Error in history writer event handler");
      }
    });

    this.logger.info(
      { historizedBindings: this.historizedBindings.size },
      "History writer initialized",
    );
  }

  /** Graceful shutdown. */
  async destroy(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.influxClient.disconnect();
  }

  /** Get the InfluxClient instance (for API routes). */
  getInfluxClient(): InfluxClient {
    return this.influxClient;
  }

  /** Check if history is enabled and InfluxDB connected. */
  isEnabled(): boolean {
    return (
      this.settingsManager.get("history.enabled") === "true" && this.influxClient.isConnected()
    );
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
    // 2. Alias default
    if (ALIAS_DEFAULTS_ON.has(alias)) return true;
    // 3. Category default
    if (CATEGORY_DEFAULTS_ON.has(category)) return true;
    return false;
  }

  // ============================================================
  // Private: connection
  // ============================================================

  private tryConnect(): void {
    const url = this.settingsManager.get("history.influx.url")?.trim();
    const token = this.settingsManager.get("history.influx.token")?.trim();
    const org = this.settingsManager.get("history.influx.org")?.trim();
    const bucket = this.settingsManager.get("history.influx.bucket")?.trim();
    const enabled = this.settingsManager.get("history.enabled");

    if (!url || !token || !org || !bucket || enabled !== "true") {
      if (this.influxClient.isConnected()) {
        this.influxClient.disconnect().catch((err) => {
          this.logger.warn({ err }, "Error disconnecting InfluxDB");
        });
      }
      return;
    }

    this.influxClient.connect({ url, token, org, bucket });

    // Auto-setup downsampling buckets and tasks (fire-and-forget)
    this.setupDownsampling();
  }

  private setupDownsampling(): void {
    // Read configurable retention from settings (optional overrides)
    const rawDays = parseInt(this.settingsManager.get("history.retention.rawDays") ?? "", 10);
    const hourlyDays = parseInt(this.settingsManager.get("history.retention.hourlyDays") ?? "", 10);
    const dailyDays = parseInt(this.settingsManager.get("history.retention.dailyDays") ?? "", 10);

    const retention = {
      rawSeconds: !isNaN(rawDays) && rawDays > 0 ? rawDays * 86_400 : undefined,
      hourlySeconds: !isNaN(hourlyDays) && hourlyDays > 0 ? hourlyDays * 86_400 : undefined,
      dailySeconds: !isNaN(dailyDays) && dailyDays > 0 ? dailyDays * 86_400 : undefined,
    };

    Promise.all([
      this.influxClient.ensureBuckets(retention),
      this.influxClient.ensureDownsamplingTasks(),
    ]).catch((err) => {
      this.logger.warn({ err }, "Downsampling setup failed — will retry on next connect");
    });
  }

  // ============================================================
  // Private: cache
  // ============================================================

  private refreshCache(): void {
    this.historizedBindings.clear();
    this.bindingMeta.clear();

    const equipments = this.equipmentManager.getAll();
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
  ): void {
    if (!this.influxClient.isConnected()) return;
    if (value === null || value === undefined) return;

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

    // Deduplication check
    if (!this.shouldWrite(bindingId, meta, value, previous)) return;

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

    this.influxClient.writePoint(point);

    // Update last written
    this.lastWritten.set(bindingId, { value, timestamp: Date.now() });
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
