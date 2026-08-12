/**
 * Low battery monitor (spec 143).
 *
 * Watches the battery level of every battery-powered device and raises a system
 * alarm — hence a notification and a UI banner entry — when it falls under the
 * threshold, reminding once a week until the cell is replaced.
 *
 * Why this exists: spec 116 deliberately classifies the radio silence of
 * event-driven battery hardware as normal (issue #348), so a dead remote shows
 * `online` and nothing notices. The battery percentage that predicts that death
 * is already in the database, days ahead, and nobody reads it.
 *
 * Two triggers: the device's own reports, and a periodic sweep. The sweep is
 * required, not an optimization — battery reports are the sparsest data Sowel
 * receives (spec 116 gives them a 2 h freshness window), and a device that was
 * already low before this feature existed would otherwise wait days for its next
 * report to be noticed.
 */

import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { BatteryAlert, DeviceWithDetails } from "../shared/types.js";
import type { DeviceManager } from "./device-manager.js";
import {
  BATTERY_REMINDER_INTERVAL_MS,
  BATTERY_SWEEP_INTERVAL_MS,
  BATTERY_SWEEP_START_DELAY_MS,
  LOW_BATTERY_RECOVERY_PCT,
  LOW_BATTERY_THRESHOLD_PCT,
  MAINS_DATA_CATEGORIES,
} from "../shared/constants.js";

const ALARM_PREFIX = "battery-low:";

interface BatteryAlertRow {
  device_data_id: string;
  device_id: string;
  device_name: string;
  value: string;
  raised_at: string;
  last_notified_at: string;
}

/**
 * Is this device powered by a battery?
 *
 * The integration's declaration wins. Without one, a device is assumed to run on
 * a battery unless it meters mains electricity — a plug or a meter reporting
 * power/energy/current is not something anyone replaces a cell in. Cell voltage
 * (`voltage`) is not a mains marker: most battery sensors report it.
 */
export function isBatteryPowered(device: DeviceWithDetails): boolean {
  if (device.powerSource === "battery") return true;
  if (device.powerSource === "mains" || device.powerSource === "dc") return false;
  return !device.data.some((d) => MAINS_DATA_CATEGORIES.has(d.category));
}

/**
 * Is this device data a battery reading?
 *
 * The key-based clause is not redundant with the category: plugins assign the
 * category at discovery, and the Zigbee2MQTT plugin categorized `battery_low`
 * as `generic` until 2.5.0 — the sensors that only expose that boolean would be
 * invisible without it.
 */
export function isBatteryData(data: { key: string; category: string }): boolean {
  return data.category === "battery" || data.key === "battery_low";
}

/**
 * Classify a battery reading.
 *
 * `"ignore"` means "hold whatever state the device is in": it covers unreadable
 * values and the hysteresis band, where the reading is neither low enough to
 * alarm nor high enough to call the battery replaced.
 */
export function classifyBattery(value: unknown): "low" | "ok" | "ignore" {
  if (value === null || value === undefined) return "ignore";

  if (typeof value === "boolean") return value ? "low" : "ok";
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true") return "low";
    if (s === "false") return "ok";
    // `Number("")` is 0, which would read as a flat battery.
    if (s === "") return "ignore";
  }

  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "ignore";
  // A percentage is the only numeric shape we understand. Anything else is a
  // raw cell voltage (3000 mV) or a broken report — guessing would either alarm
  // on every mains device or never alarm at all.
  if (num < 0 || num > 100) return "ignore";

  if (num <= LOW_BATTERY_THRESHOLD_PCT) return "low";
  if (num >= LOW_BATTERY_RECOVERY_PCT) return "ok";
  // Hysteresis band: hold the current state, whichever it is.
  return "ignore";
}

export class BatteryMonitor {
  private readonly logger: Logger;
  private readonly stmts;

  /** deviceDataId → active alert. Mirror of the table, written through. */
  private readonly alerts = new Map<string, BatteryAlert>();

  /**
   * Battery data ids of battery-powered devices, rebuilt by each sweep. The
   * `device.data.updated` handler runs for every report of every integration,
   * so its first act has to be a Set lookup, not a SQLite query.
   */
  private watched = new Set<string>();

  private unsubscribe: (() => void) | null = null;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    private readonly deviceManager: DeviceManager,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "battery-monitor" });
    this.stmts = {
      selectAll: this.db.prepare(`SELECT * FROM battery_alerts`),
      upsert: this.db.prepare(
        `INSERT INTO battery_alerts (device_data_id, device_id, device_name, value, raised_at, last_notified_at)
         VALUES (@deviceDataId, @deviceId, @deviceName, @value, @raisedAt, @lastNotifiedAt)
         ON CONFLICT(device_data_id) DO UPDATE SET
           device_id = excluded.device_id,
           device_name = excluded.device_name,
           value = excluded.value,
           last_notified_at = excluded.last_notified_at`,
      ),
      delete: this.db.prepare(`DELETE FROM battery_alerts WHERE device_data_id = ?`),
    };
  }

  init(): void {
    this.loadFromDb();

    this.unsubscribe = this.eventBus.on((event) => {
      if (event.type !== "device.data.updated") return;
      if (!this.watched.has(event.dataId)) return;
      try {
        this.evaluate(event.deviceId, event.dataId, event.deviceName, event.value);
      } catch (err) {
        this.logger.error({ err, dataId: event.dataId }, "Battery evaluation failed");
      }
    });

    this.scheduleSweep(BATTERY_SWEEP_START_DELAY_MS);
    this.logger.info({ activeAlerts: this.alerts.size }, "Battery monitor initialized");
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Active alerts, newest first. Feeds `GET /devices/battery-alerts`. */
  getActiveAlerts(): BatteryAlert[] {
    return [...this.alerts.values()].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  }

  /**
   * Re-read every battery-powered device: pick up devices discovered since the
   * last pass, send the due weekly reminders, and drop alerts whose data no
   * longer exists.
   */
  sweep(): void {
    const seen = new Set<string>();
    const watched = new Set<string>();

    for (const device of this.deviceManager.getAllWithData()) {
      if (!isBatteryPowered(device)) continue;
      for (const data of device.data) {
        if (!isBatteryData(data)) continue;
        watched.add(data.id);
        seen.add(data.id);
        this.evaluate(device.id, data.id, device.name, data.value);
      }
    }
    this.watched = watched;

    // Orphans: device deleted, key renamed, or the device just became mains-fed
    // because its plugin learned to declare a power source.
    for (const alert of [...this.alerts.values()]) {
      if (seen.has(alert.deviceDataId)) continue;
      this.resolve(alert, "no longer watched");
    }

    // Weekly reminder for everything still low.
    const now = Date.now();
    for (const alert of [...this.alerts.values()]) {
      const since = now - new Date(alert.lastNotifiedAt).getTime();
      if (since < BATTERY_REMINDER_INTERVAL_MS) continue;
      this.notify(alert);
      this.persist({ ...alert, lastNotifiedAt: new Date().toISOString() });
    }
  }

  // ── Internals ────────────────────────────────────────────────

  private evaluate(deviceId: string, dataId: string, deviceName: string, value: unknown): void {
    const existing = this.alerts.get(dataId);
    const verdict = classifyBattery(value);

    if (verdict === "ignore") return;

    if (verdict === "low") {
      if (existing) {
        // Still low. Keep the alert current (the device may have been renamed,
        // the level may have dropped further) but stay silent until the weekly
        // reminder — a sensor reporting every 30 min must not notify every 30 min.
        if (existing.value !== formatValue(value) || existing.deviceName !== deviceName) {
          this.persist({ ...existing, value: formatValue(value), deviceName });
        }
        return;
      }
      const now = new Date().toISOString();
      const alert: BatteryAlert = {
        deviceDataId: dataId,
        deviceId,
        deviceName,
        value: formatValue(value),
        raisedAt: now,
        lastNotifiedAt: now,
      };
      this.persist(alert);
      this.logger.warn({ deviceId, deviceName, value }, "Low battery");
      this.notify(alert);
      return;
    }

    if (existing) this.resolve(existing, formatValue(value));
  }

  private notify(alert: BatteryAlert): void {
    this.eventBus.emit({
      type: "system.alarm.raised",
      alarmId: `${ALARM_PREFIX}${alert.deviceDataId}`,
      level: "warning",
      source: alert.deviceName,
      message: batteryMessage(alert.value),
    });
  }

  private resolve(alert: BatteryAlert, newValue: string): void {
    this.alerts.delete(alert.deviceDataId);
    this.stmts.delete.run(alert.deviceDataId);
    this.logger.info(
      { deviceId: alert.deviceId, deviceName: alert.deviceName, value: newValue },
      "Low battery cleared",
    );
    this.eventBus.emit({
      type: "system.alarm.resolved",
      alarmId: `${ALARM_PREFIX}${alert.deviceDataId}`,
      source: alert.deviceName,
      message: isPercentage(newValue) ? `Battery back to ${newValue}%` : "Battery back to normal",
    });
  }

  private persist(alert: BatteryAlert): void {
    this.alerts.set(alert.deviceDataId, alert);
    this.stmts.upsert.run(alert);
  }

  private loadFromDb(): void {
    for (const row of this.stmts.selectAll.all() as BatteryAlertRow[]) {
      this.alerts.set(row.device_data_id, {
        deviceDataId: row.device_data_id,
        deviceId: row.device_id,
        deviceName: row.device_name,
        value: row.value,
        raisedAt: row.raised_at,
        lastNotifiedAt: row.last_notified_at,
      });
    }
  }

  private scheduleSweep(delayMs: number): void {
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      try {
        this.sweep();
      } catch (err) {
        this.logger.error({ err }, "Battery sweep failed");
      }
      this.scheduleSweep(BATTERY_SWEEP_INTERVAL_MS);
    }, delayMs);
    this.sweepTimer.unref?.();
  }
}

/** Alert values are stored as text: "12" for a level, "true" for a flag. */
function formatValue(value: unknown): string {
  return String(value);
}

function isPercentage(value: string): boolean {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 && num <= 100;
}

function batteryMessage(value: string): string {
  return isPercentage(value) ? `Low battery: ${value}%` : "Low battery";
}
