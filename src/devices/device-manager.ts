import { randomUUID, createHash } from "node:crypto";
import { toISOUtc } from "../core/database.js";

/**
 * Generate a deterministic UUID-shaped ID from input parts.
 * Same inputs always produce the same ID.
 */
function deterministicId(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type {
  Device,
  DeviceData,
  DeviceOrder,
  DeviceWithDetails,
  DeviceSource,
  DataType,
  DataCategory,
} from "../shared/types.js";
import { PROPERTY_TO_CATEGORY } from "../shared/constants.js";

export interface DiscoveredDevice {
  ieeeAddress?: string;
  friendlyName: string;
  manufacturer?: string;
  model?: string;
  data: {
    key: string;
    type: DataType;
    category: DataCategory;
    unit?: string;
  }[];
  orders: {
    key: string;
    type: DataType;
    category?: string;
    dispatchConfig?: Record<string, unknown>;
    min?: number;
    max?: number;
    enumValues?: string[];
    unit?: string;
  }[];
  rawExpose?: unknown;
}

export class DeviceManager {
  private db: Database.Database;
  private logger: Logger;
  private eventBus: EventBus;

  // Prepared statements
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(db: Database.Database, eventBus: EventBus, logger: Logger) {
    this.db = db;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "device-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      findDeviceBySource: this.db.prepare<[string, string]>(
        "SELECT * FROM devices WHERE integration_id = ? AND source_device_id = ?",
      ),
      insertDevice: this.db.prepare(
        `INSERT INTO devices (id, integration_id, source_device_id, name, manufacturer, model, ieee_address, source, status, raw_expose)
         VALUES (@id, @integrationId, @sourceDeviceId, @name, @manufacturer, @model, @ieeeAddress, @source, @status, @rawExpose)`,
      ),
      updateDeviceDiscovery: this.db.prepare(
        `UPDATE devices SET name = @name, manufacturer = @manufacturer, model = @model,
         ieee_address = @ieeeAddress, raw_expose = @rawExpose, updated_at = datetime('now')
         WHERE id = @id`,
      ),
      updateDeviceName: this.db.prepare(
        "UPDATE devices SET name = ?, updated_at = datetime('now') WHERE id = ?",
      ),
      updateDeviceZone: this.db.prepare(
        "UPDATE devices SET zone_id = ?, updated_at = datetime('now') WHERE id = ?",
      ),
      updateDeviceStatus: this.db.prepare(
        "UPDATE devices SET status = ?, last_seen = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      ),
      updateDeviceLastSeen: this.db.prepare(
        "UPDATE devices SET last_seen = datetime('now') WHERE id = ?",
      ),
      deleteDevice: this.db.prepare("DELETE FROM devices WHERE id = ?"),
      getAllDevices: this.db.prepare("SELECT * FROM devices ORDER BY name"),
      getDeviceById: this.db.prepare("SELECT * FROM devices WHERE id = ?"),
      getDeviceData: this.db.prepare("SELECT * FROM device_data WHERE device_id = ? ORDER BY key"),
      getDeviceOrders: this.db.prepare(
        "SELECT * FROM device_orders WHERE device_id = ? ORDER BY key",
      ),
      findDeviceDataByKey: this.db.prepare<[string, string]>(
        "SELECT * FROM device_data WHERE device_id = ? AND key = ?",
      ),
      findDeviceDataByDeviceAndKey: this.db.prepare<[string, string]>(
        "SELECT * FROM device_data WHERE device_id = ? AND key = ?",
      ),
      insertDeviceData: this.db.prepare(
        `INSERT INTO device_data (id, device_id, key, type, category, unit)
         VALUES (@id, @deviceId, @key, @type, @category, @unit)`,
      ),
      updateDeviceDataDef: this.db.prepare(
        "UPDATE device_data SET type = ?, category = ?, unit = ? WHERE id = ?",
      ),
      updateDeviceDataValue: this.db.prepare(
        "UPDATE device_data SET value = ?, last_updated = datetime('now'), last_changed = CASE WHEN value IS NOT ? OR category = 'action' THEN datetime('now') ELSE last_changed END WHERE id = ?",
      ),
      deleteDeviceDataById: this.db.prepare("DELETE FROM device_data WHERE id = ?"),
      getDeviceDataIds: this.db.prepare("SELECT id, key FROM device_data WHERE device_id = ?"),
      findDeviceOrderByDeviceAndKey: this.db.prepare<[string, string]>(
        "SELECT * FROM device_orders WHERE device_id = ? AND key = ?",
      ),
      insertDeviceOrder: this.db.prepare(
        `INSERT INTO device_orders (id, device_id, key, type, category, dispatch_config, min_value, max_value, enum_values, unit)
         VALUES (@id, @deviceId, @key, @type, @category, @dispatchConfig, @min, @max, @enumValues, @unit)`,
      ),
      updateDeviceOrderDef: this.db.prepare(
        "UPDATE device_orders SET type = ?, category = ?, dispatch_config = ?, min_value = ?, max_value = ?, enum_values = ?, unit = ? WHERE id = ?",
      ),
      deleteDeviceOrderById: this.db.prepare("DELETE FROM device_orders WHERE id = ?"),
      getDeviceOrderIds: this.db.prepare("SELECT id, key FROM device_orders WHERE device_id = ?"),
      countDevices: this.db.prepare("SELECT COUNT(*) as count FROM devices"),
      countByStatus: this.db.prepare(
        "SELECT status, COUNT(*) as count FROM devices GROUP BY status",
      ),
    };
  }

  /**
   * Upsert a device from integration discovery.
   * Creates the device if new, updates metadata if existing.
   * Always refreshes Data and Orders definitions.
   */
  upsertFromDiscovery(
    integrationId: string,
    source: DeviceSource,
    discovered: DiscoveredDevice,
  ): void {
    const existing = this.stmts.findDeviceBySource.get(integrationId, discovered.friendlyName) as
      | DeviceRow
      | undefined;

    const deviceId = existing?.id ?? randomUUID();

    const upsert = this.db.transaction(() => {
      if (existing) {
        // Update device metadata (preserve user-edited name if it was changed)
        this.stmts.updateDeviceDiscovery.run({
          id: deviceId,
          name: existing.name, // Keep existing name
          manufacturer: discovered.manufacturer ?? null,
          model: discovered.model ?? null,
          ieeeAddress: discovered.ieeeAddress ?? null,
          rawExpose: discovered.rawExpose ? JSON.stringify(discovered.rawExpose) : null,
        });
      } else {
        // Insert new device
        this.stmts.insertDevice.run({
          id: deviceId,
          integrationId,
          sourceDeviceId: discovered.friendlyName,
          name: discovered.friendlyName, // Default name = friendly name
          manufacturer: discovered.manufacturer ?? null,
          model: discovered.model ?? null,
          ieeeAddress: discovered.ieeeAddress ?? null,
          source,
          status: "unknown",
          rawExpose: discovered.rawExpose ? JSON.stringify(discovered.rawExpose) : null,
        });
      }

      // Sync Data definitions: upsert by (device_id, key) to preserve stable IDs
      const discoveredDataKeys = new Set(discovered.data.map((d) => d.key));
      for (const d of discovered.data) {
        const existingData = this.stmts.findDeviceDataByDeviceAndKey.get(deviceId, d.key) as
          | { id: string }
          | undefined;
        if (existingData) {
          this.stmts.updateDeviceDataDef.run(d.type, d.category, d.unit ?? null, existingData.id);
        } else {
          this.stmts.insertDeviceData.run({
            id: deterministicId(deviceId, "data", d.key),
            deviceId,
            key: d.key,
            type: d.type,
            category: d.category,
            unit: d.unit ?? null,
          });
        }
      }
      // Remove stale data entries no longer exposed by the device
      const existingDataRows = this.stmts.getDeviceDataIds.all(deviceId) as {
        id: string;
        key: string;
      }[];
      for (const row of existingDataRows) {
        if (!discoveredDataKeys.has(row.key)) {
          this.stmts.deleteDeviceDataById.run(row.id);
        }
      }

      // Sync Orders definitions: upsert by (device_id, key) to preserve stable IDs
      const discoveredOrderKeys = new Set(discovered.orders.map((o) => o.key));
      for (const o of discovered.orders) {
        const existingOrder = this.stmts.findDeviceOrderByDeviceAndKey.get(deviceId, o.key) as
          | { id: string }
          | undefined;
        if (existingOrder) {
          this.stmts.updateDeviceOrderDef.run(
            o.type,
            o.category ?? null,
            o.dispatchConfig ? JSON.stringify(o.dispatchConfig) : "{}",
            o.min ?? null,
            o.max ?? null,
            o.enumValues ? JSON.stringify(o.enumValues) : null,
            o.unit ?? null,
            existingOrder.id,
          );
        } else {
          this.stmts.insertDeviceOrder.run({
            id: deterministicId(deviceId, "order", o.key),
            deviceId,
            key: o.key,
            type: o.type,
            category: o.category ?? null,
            dispatchConfig: o.dispatchConfig ? JSON.stringify(o.dispatchConfig) : "{}",
            min: o.min ?? null,
            max: o.max ?? null,
            enumValues: o.enumValues ? JSON.stringify(o.enumValues) : null,
            unit: o.unit ?? null,
          });
        }
      }
      // Remove stale order entries no longer exposed by the device
      const existingOrderRows = this.stmts.getDeviceOrderIds.all(deviceId) as {
        id: string;
        key: string;
      }[];
      for (const row of existingOrderRows) {
        if (!discoveredOrderKeys.has(row.key)) {
          this.stmts.deleteDeviceOrderById.run(row.id);
        }
      }
    });

    upsert();

    if (!existing) {
      const device = this.getById(deviceId);
      if (device) {
        this.logger.info(
          {
            deviceId,
            name: discovered.friendlyName,
            manufacturer: discovered.manufacturer,
            model: discovered.model,
          },
          "Device discovered",
        );
        this.eventBus.emit({ type: "device.discovered", device });
      }
    }
  }

  /**
   * Remove a device from DB when it disappears from an integration.
   */
  markRemoved(integrationId: string, sourceDeviceId: string): void {
    const existing = this.stmts.findDeviceBySource.get(integrationId, sourceDeviceId) as
      | DeviceRow
      | undefined;
    if (existing) {
      this.stmts.deleteDevice.run(existing.id);
      this.logger.warn(
        { deviceId: existing.id, name: sourceDeviceId },
        "Device removed — deleted from DB",
      );
      this.eventBus.emit({
        type: "device.removed",
        deviceId: existing.id,
        deviceName: existing.name,
      });
    }
  }

  /**
   * Remove all devices for an integration that are NOT in the active set.
   * Called after processing device discovery to clean up stale DB entries.
   */
  removeStaleDevices(integrationId: string, activeDeviceIds: Set<string>): void {
    const allDevices = this.db
      .prepare("SELECT id, source_device_id, name FROM devices WHERE integration_id = ?")
      .all(integrationId) as { id: string; source_device_id: string; name: string }[];

    // Safety guard: refuse to purge all devices when the active set is empty
    // but devices exist in DB — this indicates a failed or empty discovery response
    if (activeDeviceIds.size === 0 && allDevices.length > 0) {
      this.logger.warn(
        { integrationId, existingCount: allDevices.length },
        "Skipping stale device cleanup — active set is empty, likely incomplete discovery",
      );
      return;
    }

    for (const device of allDevices) {
      if (!activeDeviceIds.has(device.source_device_id)) {
        this.stmts.deleteDevice.run(device.id);
        this.logger.warn(
          { deviceId: device.id, name: device.source_device_id },
          "Stale device cleaned up — not in integration device list",
        );
        this.eventBus.emit({
          type: "device.removed",
          deviceId: device.id,
          deviceName: device.name,
        });
      }
    }
  }

  /**
   * Update device data values from an incoming data payload.
   * Emits events for each data change.
   */
  updateDeviceData(
    integrationId: string,
    sourceDeviceId: string,
    payload: Record<string, unknown>,
    /** Optional source timestamp (epoch seconds) for aligned time-series writes. */
    sourceTimestamp?: number,
  ): void {
    const device = this.stmts.findDeviceBySource.get(integrationId, sourceDeviceId) as
      | DeviceRow
      | undefined;
    if (!device) return;

    // A device sending data is online — update status and last_seen
    this.stmts.updateDeviceLastSeen.run(device.id);
    this.eventBus.emit({
      type: "device.heartbeat",
      deviceId: device.id,
      timestamp: new Date().toISOString(),
    });
    if (device.status !== "online") {
      this.stmts.updateDeviceStatus.run("online", device.id);
      this.eventBus.emit({
        type: "device.status_changed",
        deviceId: device.id,
        deviceName: device.name,
        status: "online",
      });
    }

    for (const [key, value] of Object.entries(payload)) {
      let dataRow = this.stmts.findDeviceDataByKey.get(device.id, key) as DeviceDataRow | undefined;

      // Auto-create device_data for known properties missing from exposes (e.g. Tuya battery)
      if (!dataRow) {
        const category = PROPERTY_TO_CATEGORY[key];
        if (!category) continue; // Truly unknown property, skip
        const dataType: DataType =
          typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "text";
        const unit =
          category === "battery"
            ? "%"
            : category === "temperature"
              ? "°C"
              : category === "humidity"
                ? "%"
                : category === "pressure"
                  ? "hPa"
                  : category === "luminosity"
                    ? "lx"
                    : category === "voltage"
                      ? "V"
                      : undefined;
        const id = deterministicId(device.id, "data", key);
        this.stmts.insertDeviceData.run({
          id,
          deviceId: device.id,
          key,
          type: dataType,
          category,
          unit: unit ?? null,
        });
        this.logger.info(
          { deviceId: device.id, key, category },
          "Auto-created device_data from payload",
        );
        dataRow = this.stmts.findDeviceDataByKey.get(device.id, key) as DeviceDataRow | undefined;
        if (!dataRow) continue;
      }

      const serialized = JSON.stringify(value);
      const previous = dataRow.value;

      this.stmts.updateDeviceDataValue.run(serialized, serialized, dataRow.id);

      this.eventBus.emit({
        type: "device.data.updated",
        deviceId: device.id,
        deviceName: device.name,
        dataId: dataRow.id,
        key,
        value,
        previous: previous !== null ? JSON.parse(previous) : null,
        timestamp: new Date().toISOString(),
        ...(sourceTimestamp !== undefined && { sourceTimestamp }),
      });
    }
  }

  /**
   * Update device status.
   * "online" / "offline" → update status in DB.
   * Device data and bindings are preserved across offline/online transitions.
   */
  updateDeviceStatus(
    integrationId: string,
    sourceDeviceId: string,
    status: "online" | "offline",
  ): void {
    const device = this.stmts.findDeviceBySource.get(integrationId, sourceDeviceId) as
      | DeviceRow
      | undefined;
    if (!device) return;

    if (device.status !== status) {
      this.stmts.updateDeviceStatus.run(status, device.id);
      this.logger.info(
        { deviceId: device.id, name: sourceDeviceId, status },
        "Device status changed",
      );
      this.eventBus.emit({
        type: "device.status_changed",
        deviceId: device.id,
        deviceName: device.name,
        status,
      });
    }
  }

  // ============================================================
  // CRUD operations (for API)
  // ============================================================

  getAll(): Device[] {
    const rows = this.stmts.getAllDevices.all() as DeviceRow[];
    return rows.map(rowToDevice);
  }

  getAllWithData(): DeviceWithDetails[] {
    const devices = this.getAll();
    return devices.map((device) => ({
      ...device,
      data: this.getDeviceData(device.id),
      orders: this.getDeviceOrders(device.id),
    }));
  }

  getById(id: string): Device | null {
    const row = this.stmts.getDeviceById.get(id) as DeviceRow | undefined;
    return row ? rowToDevice(row) : null;
  }

  getByIdWithDetails(id: string): DeviceWithDetails | null {
    const device = this.getById(id);
    if (!device) return null;
    return {
      ...device,
      data: this.getDeviceData(id),
      orders: this.getDeviceOrders(id),
    };
  }

  getDeviceData(deviceId: string): DeviceData[] {
    const rows = this.stmts.getDeviceData.all(deviceId) as DeviceDataRow[];
    return rows.map(rowToDeviceData);
  }

  getDeviceOrders(deviceId: string): DeviceOrder[] {
    const rows = this.stmts.getDeviceOrders.all(deviceId) as DeviceOrderRow[];
    return rows.map(rowToDeviceOrder);
  }

  getRawExpose(id: string): unknown | null {
    const row = this.stmts.getDeviceById.get(id) as DeviceRow | undefined;
    if (!row?.raw_expose) return null;
    try {
      return JSON.parse(row.raw_expose);
    } catch {
      return null;
    }
  }

  update(id: string, updates: { name?: string; zoneId?: string | null }): Device | null {
    const existing = this.stmts.getDeviceById.get(id) as DeviceRow | undefined;
    if (!existing) return null;

    if (updates.name !== undefined) {
      this.stmts.updateDeviceName.run(updates.name, id);
    }
    if (updates.zoneId !== undefined) {
      this.stmts.updateDeviceZone.run(updates.zoneId, id);
    }

    return this.getById(id);
  }

  delete(id: string): boolean {
    const existing = this.getById(id);
    const result = this.stmts.deleteDevice.run(id);
    if (result.changes > 0) {
      this.logger.info({ deviceId: id }, "Device deleted");
      this.eventBus.emit({
        type: "device.removed",
        deviceId: id,
        deviceName: existing?.name ?? id,
      });
      return true;
    }
    return false;
  }

  getDeviceCount(): number {
    const row = this.stmts.countDevices.get() as { count: number };
    return row.count;
  }

  getStatusCounts(): Record<string, number> {
    const rows = this.stmts.countByStatus.all() as {
      status: string;
      count: number;
    }[];
    const counts: Record<string, number> = { online: 0, offline: 0, unknown: 0 };
    for (const row of rows) {
      counts[row.status] = row.count;
    }
    return counts;
  }

  logSummary(): void {
    const counts = this.getStatusCounts();
    const total = this.getDeviceCount();
    this.logger.info(
      { total, online: counts.online, offline: counts.offline, unknown: counts.unknown },
      "Device summary",
    );
  }

  /**
   * Migrate devices from one integration ID to another, filtered by device model.
   * Used when a built-in integration is externalized as a plugin.
   * Preserves device UUIDs, equipment bindings, and history.
   *
   * Uses DB data only (no API calls) — safe to call before authentication.
   * Runs in a transaction for consistency.
   *
   * @param oldIntegrationId - The current integration_id to migrate from
   * @param newIntegrationId - The new integration_id to migrate to
   * @param models - If provided, only migrate devices with these model values. If omitted, migrate ALL.
   * @returns The number of devices migrated
   */
  migrateIntegrationId(
    oldIntegrationId: string,
    newIntegrationId: string,
    models?: string[],
  ): number {
    const migrate = this.db.transaction(() => {
      const stmt =
        models && models.length > 0
          ? this.db.prepare(
              `UPDATE devices SET integration_id = ?, source = ?, updated_at = datetime('now')
             WHERE integration_id = ? AND model IN (${models.map(() => "?").join(", ")})`,
            )
          : this.db.prepare(
              `UPDATE devices SET integration_id = ?, source = ?, updated_at = datetime('now')
             WHERE integration_id = ?`,
            );

      const args =
        models && models.length > 0
          ? [newIntegrationId, newIntegrationId, oldIntegrationId, ...models]
          : [newIntegrationId, newIntegrationId, oldIntegrationId];

      return stmt.run(...args).changes;
    });

    return migrate();
  }
}

// ============================================================
// SQLite row types and mappers
// ============================================================

interface DeviceRow {
  id: string;
  integration_id: string;
  source_device_id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  ieee_address: string | null;
  zone_id: string | null;
  source: string;
  status: string;
  last_seen: string | null;
  raw_expose: string | null;
  created_at: string;
  updated_at: string;
}

interface DeviceDataRow {
  id: string;
  device_id: string;
  key: string;
  type: string;
  category: string;
  value: string | null;
  unit: string | null;
  last_updated: string | null;
}

interface DeviceOrderRow {
  id: string;
  device_id: string;
  key: string;
  type: string;
  dispatch_config: string;
  min_value: number | null;
  max_value: number | null;
  enum_values: string | null;
  unit: string | null;
}

function rowToDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    integrationId: row.integration_id,
    sourceDeviceId: row.source_device_id,
    name: row.name,
    manufacturer: row.manufacturer ?? undefined,
    model: row.model ?? undefined,
    ieeeAddress: row.ieee_address ?? undefined,
    zoneId: row.zone_id,
    source: row.source as Device["source"],
    status: row.status as Device["status"],
    lastSeen: toISOUtc(row.last_seen),
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
  };
}

function rowToDeviceData(row: DeviceDataRow): DeviceData {
  let value: unknown = null;
  if (row.value !== null) {
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }
  }
  return {
    id: row.id,
    deviceId: row.device_id,
    key: row.key,
    type: row.type as DataType,
    category: row.category as DataCategory,
    value,
    unit: row.unit ?? undefined,
    lastUpdated: toISOUtc(row.last_updated),
  };
}

function rowToDeviceOrder(row: DeviceOrderRow): DeviceOrder {
  let enumValues: string[] | undefined;
  if (row.enum_values) {
    try {
      enumValues = JSON.parse(row.enum_values);
    } catch {
      enumValues = undefined;
    }
  }
  let dispatchConfig: Record<string, unknown> = {};
  if (row.dispatch_config) {
    try {
      dispatchConfig = JSON.parse(row.dispatch_config);
    } catch {
      dispatchConfig = {};
    }
  }
  return {
    id: row.id,
    deviceId: row.device_id,
    key: row.key,
    type: row.type as DataType,
    dispatchConfig,
    min: row.min_value ?? undefined,
    max: row.max_value ?? undefined,
    enumValues,
    unit: row.unit ?? undefined,
  };
}
