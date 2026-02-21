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
  DataType,
  DataCategory,
} from "../shared/types.js";
import { PROPERTY_TO_CATEGORY } from "../shared/constants.js";

interface DiscoveredDevice {
  ieeeAddress: string;
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
    payloadKey: string;
    min?: number;
    max?: number;
    enumValues?: string[];
    unit?: string;
  }[];
  rawExpose: unknown;
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
      findDeviceByMqtt: this.db.prepare<[string, string]>(
        "SELECT * FROM devices WHERE mqtt_base_topic = ? AND mqtt_name = ?",
      ),
      insertDevice: this.db.prepare(
        `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, manufacturer, model, ieee_address, source, status, raw_expose)
         VALUES (@id, @mqttBaseTopic, @mqttName, @name, @manufacturer, @model, @ieeeAddress, @source, @status, @rawExpose)`,
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
      deleteDevice: this.db.prepare("DELETE FROM devices WHERE id = ?"),
      getAllDevices: this.db.prepare("SELECT * FROM devices ORDER BY name"),
      getDeviceById: this.db.prepare("SELECT * FROM devices WHERE id = ?"),
      getDeviceData: this.db.prepare(
        "SELECT * FROM device_data WHERE device_id = ? ORDER BY key",
      ),
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
        "UPDATE device_data SET value = ?, last_updated = datetime('now') WHERE id = ?",
      ),
      deleteDeviceDataById: this.db.prepare(
        "DELETE FROM device_data WHERE id = ?",
      ),
      getDeviceDataIds: this.db.prepare(
        "SELECT id, key FROM device_data WHERE device_id = ?",
      ),
      findDeviceOrderByDeviceAndKey: this.db.prepare<[string, string]>(
        "SELECT * FROM device_orders WHERE device_id = ? AND key = ?",
      ),
      insertDeviceOrder: this.db.prepare(
        `INSERT INTO device_orders (id, device_id, key, type, mqtt_set_topic, payload_key, min_value, max_value, enum_values, unit)
         VALUES (@id, @deviceId, @key, @type, @mqttSetTopic, @payloadKey, @min, @max, @enumValues, @unit)`,
      ),
      updateDeviceOrderDef: this.db.prepare(
        "UPDATE device_orders SET type = ?, mqtt_set_topic = ?, payload_key = ?, min_value = ?, max_value = ?, enum_values = ?, unit = ? WHERE id = ?",
      ),
      deleteDeviceOrderById: this.db.prepare(
        "DELETE FROM device_orders WHERE id = ?",
      ),
      getDeviceOrderIds: this.db.prepare(
        "SELECT id, key FROM device_orders WHERE device_id = ?",
      ),
      countDevices: this.db.prepare("SELECT COUNT(*) as count FROM devices"),
      countByStatus: this.db.prepare(
        "SELECT status, COUNT(*) as count FROM devices GROUP BY status",
      ),
    };
  }

  /**
   * Upsert a device from auto-discovery (zigbee2mqtt bridge/devices).
   * Creates the device if new, updates metadata if existing.
   * Always refreshes Data and Orders definitions.
   */
  upsertFromDiscovery(baseTopic: string, discovered: DiscoveredDevice): void {
    const existing = this.stmts.findDeviceByMqtt.get(
      baseTopic,
      discovered.friendlyName,
    ) as DeviceRow | undefined;

    const deviceId = existing?.id ?? randomUUID();

    const upsert = this.db.transaction(() => {
      if (existing) {
        // Update device metadata (preserve user-edited name if it was changed)
        this.stmts.updateDeviceDiscovery.run({
          id: deviceId,
          name: existing.name, // Keep existing name
          manufacturer: discovered.manufacturer ?? null,
          model: discovered.model ?? null,
          ieeeAddress: discovered.ieeeAddress,
          rawExpose: JSON.stringify(discovered.rawExpose),
        });
      } else {
        // Insert new device
        this.stmts.insertDevice.run({
          id: deviceId,
          mqttBaseTopic: baseTopic,
          mqttName: discovered.friendlyName,
          name: discovered.friendlyName, // Default name = friendly name
          manufacturer: discovered.manufacturer ?? null,
          model: discovered.model ?? null,
          ieeeAddress: discovered.ieeeAddress,
          source: "zigbee2mqtt",
          status: "unknown",
          rawExpose: JSON.stringify(discovered.rawExpose),
        });
      }

      // Sync Data definitions: upsert by (device_id, key) to preserve stable IDs
      const discoveredDataKeys = new Set(discovered.data.map((d) => d.key));
      for (const d of discovered.data) {
        const existingData = this.stmts.findDeviceDataByDeviceAndKey.get(deviceId, d.key) as
          | { id: string } | undefined;
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
      const existingDataRows = this.stmts.getDeviceDataIds.all(deviceId) as { id: string; key: string }[];
      for (const row of existingDataRows) {
        if (!discoveredDataKeys.has(row.key)) {
          this.stmts.deleteDeviceDataById.run(row.id);
        }
      }

      // Sync Orders definitions: upsert by (device_id, key) to preserve stable IDs
      const mqttSetTopic = `${baseTopic}/${discovered.friendlyName}/set`;
      const discoveredOrderKeys = new Set(discovered.orders.map((o) => o.key));
      for (const o of discovered.orders) {
        const existingOrder = this.stmts.findDeviceOrderByDeviceAndKey.get(deviceId, o.key) as
          | { id: string } | undefined;
        if (existingOrder) {
          this.stmts.updateDeviceOrderDef.run(
            o.type, mqttSetTopic, o.payloadKey,
            o.min ?? null, o.max ?? null,
            o.enumValues ? JSON.stringify(o.enumValues) : null,
            o.unit ?? null, existingOrder.id,
          );
        } else {
          this.stmts.insertDeviceOrder.run({
            id: deterministicId(deviceId, "order", o.key),
            deviceId,
            key: o.key,
            type: o.type,
            mqttSetTopic,
            payloadKey: o.payloadKey,
            min: o.min ?? null,
            max: o.max ?? null,
            enumValues: o.enumValues ? JSON.stringify(o.enumValues) : null,
            unit: o.unit ?? null,
          });
        }
      }
      // Remove stale order entries no longer exposed by the device
      const existingOrderRows = this.stmts.getDeviceOrderIds.all(deviceId) as { id: string; key: string }[];
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
          { deviceId, name: discovered.friendlyName, manufacturer: discovered.manufacturer, model: discovered.model },
          "Device discovered",
        );
        this.eventBus.emit({ type: "device.discovered", device });
      }
    }
  }

  /**
   * Remove a device from DB when it disappears from bridge/devices.
   */
  markRemoved(baseTopic: string, mqttName: string): void {
    const existing = this.stmts.findDeviceByMqtt.get(baseTopic, mqttName) as
      | DeviceRow
      | undefined;
    if (existing) {
      this.stmts.deleteDevice.run(existing.id);
      this.logger.warn({ deviceId: existing.id, name: mqttName }, "Device removed from bridge — deleted from DB");
      this.eventBus.emit({ type: "device.removed", deviceId: existing.id, deviceName: existing.name });
    }
  }

  /**
   * Remove all devices for a baseTopic that are NOT in the active set.
   * Called after processing bridge/devices to clean up stale DB entries.
   */
  removeStaleDevices(baseTopic: string, activeNames: Set<string>): void {
    const allDevices = this.db
      .prepare("SELECT id, mqtt_name, name FROM devices WHERE mqtt_base_topic = ?")
      .all(baseTopic) as { id: string; mqtt_name: string; name: string }[];

    for (const device of allDevices) {
      if (!activeNames.has(device.mqtt_name)) {
        this.stmts.deleteDevice.run(device.id);
        this.logger.warn({ deviceId: device.id, name: device.mqtt_name }, "Stale device cleaned up — not in bridge device list");
        this.eventBus.emit({ type: "device.removed", deviceId: device.id, deviceName: device.name });
      }
    }
  }

  /**
   * Update device data values from an incoming MQTT state message.
   * Only emits events when values actually change.
   */
  updateDeviceData(
    baseTopic: string,
    mqttName: string,
    payload: Record<string, unknown>,
  ): void {
    const device = this.stmts.findDeviceByMqtt.get(baseTopic, mqttName) as
      | DeviceRow
      | undefined;
    if (!device) return;

    // A device sending data is online — update status and last_seen
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
      let dataRow = this.stmts.findDeviceDataByKey.get(device.id, key) as
        | DeviceDataRow
        | undefined;

      // Auto-create device_data for known properties missing from exposes (e.g. Tuya battery)
      if (!dataRow) {
        const category = PROPERTY_TO_CATEGORY[key];
        if (!category) continue; // Truly unknown property, skip
        const dataType: DataType = typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "text";
        const unit = category === "battery" ? "%" : category === "temperature" ? "°C" : category === "humidity" ? "%" : category === "pressure" ? "hPa" : category === "luminosity" ? "lx" : undefined;
        const id = deterministicId(device.id, "data", key);
        this.stmts.insertDeviceData.run({ id, deviceId: device.id, key, type: dataType, category, unit: unit ?? null });
        this.logger.info({ deviceId: device.id, key, category }, "Auto-created device_data from MQTT payload");
        dataRow = this.stmts.findDeviceDataByKey.get(device.id, key) as DeviceDataRow | undefined;
        if (!dataRow) continue;
      }

      const serialized = JSON.stringify(value);
      const previous = dataRow.value;

      // Always update last_updated and emit event on every MQTT message,
      // even if the value hasn't changed. This keeps timestamps fresh
      // and prepares for future time-series historization.
      this.stmts.updateDeviceDataValue.run(serialized, dataRow.id);

      this.eventBus.emit({
        type: "device.data.updated",
        deviceId: device.id,
        deviceName: device.name,
        dataId: dataRow.id,
        key,
        value,
        previous: previous !== null ? JSON.parse(previous) : null,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update device status.
   * "online" → update status in DB.
   * "offline" → delete device from DB (will be re-created on next bridge/devices if still present).
   */
  updateDeviceStatus(
    baseTopic: string,
    mqttName: string,
    status: "online" | "offline",
  ): void {
    const device = this.stmts.findDeviceByMqtt.get(baseTopic, mqttName) as
      | DeviceRow
      | undefined;
    if (!device) return;

    if (status === "offline") {
      this.stmts.deleteDevice.run(device.id);
      this.logger.info({ deviceId: device.id, name: mqttName }, "Device offline — deleted from DB");
      this.eventBus.emit({ type: "device.removed", deviceId: device.id, deviceName: device.name });
      return;
    }

    if (device.status !== status) {
      this.stmts.updateDeviceStatus.run(status, device.id);
      this.logger.debug({ deviceId: device.id, name: mqttName, status }, "Device status changed");
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
      this.eventBus.emit({ type: "device.removed", deviceId: id, deviceName: existing?.name ?? id });
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
      `Device summary: ${total} devices (${counts.online} online, ${counts.offline} offline, ${counts.unknown} unknown)`,
    );
  }
}

// ============================================================
// SQLite row types and mappers
// ============================================================

interface DeviceRow {
  id: string;
  mqtt_base_topic: string;
  mqtt_name: string;
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
  mqtt_set_topic: string;
  payload_key: string;
  min_value: number | null;
  max_value: number | null;
  enum_values: string | null;
  unit: string | null;
}

function rowToDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    mqttBaseTopic: row.mqtt_base_topic,
    mqttName: row.mqtt_name,
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
  return {
    id: row.id,
    deviceId: row.device_id,
    key: row.key,
    type: row.type as DataType,
    mqttSetTopic: row.mqtt_set_topic,
    payloadKey: row.payload_key,
    min: row.min_value ?? undefined,
    max: row.max_value ?? undefined,
    enumValues,
    unit: row.unit ?? undefined,
  };
}
