import { randomUUID } from "node:crypto";
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
      insertDeviceData: this.db.prepare(
        `INSERT INTO device_data (id, device_id, key, type, category, unit)
         VALUES (@id, @deviceId, @key, @type, @category, @unit)`,
      ),
      updateDeviceDataValue: this.db.prepare(
        "UPDATE device_data SET value = ?, last_updated = datetime('now') WHERE id = ?",
      ),
      deleteDeviceData: this.db.prepare(
        "DELETE FROM device_data WHERE device_id = ?",
      ),
      insertDeviceOrder: this.db.prepare(
        `INSERT INTO device_orders (id, device_id, key, type, mqtt_set_topic, payload_key, min_value, max_value, enum_values, unit)
         VALUES (@id, @deviceId, @key, @type, @mqttSetTopic, @payloadKey, @min, @max, @enumValues, @unit)`,
      ),
      deleteDeviceOrders: this.db.prepare(
        "DELETE FROM device_orders WHERE device_id = ?",
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

      // Refresh Data definitions: delete and re-create
      this.stmts.deleteDeviceData.run(deviceId);
      for (const d of discovered.data) {
        this.stmts.insertDeviceData.run({
          id: randomUUID(),
          deviceId,
          key: d.key,
          type: d.type,
          category: d.category,
          unit: d.unit ?? null,
        });
      }

      // Refresh Orders definitions: delete and re-create
      this.stmts.deleteDeviceOrders.run(deviceId);
      for (const o of discovered.orders) {
        this.stmts.insertDeviceOrder.run({
          id: randomUUID(),
          deviceId,
          key: o.key,
          type: o.type,
          mqttSetTopic: `${baseTopic}/${discovered.friendlyName}/set`,
          payloadKey: o.payloadKey,
          min: o.min ?? null,
          max: o.max ?? null,
          enumValues: o.enumValues ? JSON.stringify(o.enumValues) : null,
          unit: o.unit ?? null,
        });
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
   * Mark a device as removed (offline) when it disappears from bridge/devices.
   * Does NOT delete from DB — user can delete via API.
   */
  markRemoved(baseTopic: string, mqttName: string): void {
    const existing = this.stmts.findDeviceByMqtt.get(baseTopic, mqttName) as
      | DeviceRow
      | undefined;
    if (existing) {
      this.stmts.updateDeviceStatus.run("offline", existing.id);
      this.logger.warn({ deviceId: existing.id, name: mqttName }, "Device removed from bridge");
      this.eventBus.emit({ type: "device.removed", deviceId: existing.id });
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
        status: "online",
      });
    }

    for (const [key, value] of Object.entries(payload)) {
      const dataRow = this.stmts.findDeviceDataByKey.get(device.id, key) as
        | DeviceDataRow
        | undefined;
      if (!dataRow) continue; // Unknown property, skip

      const serialized = JSON.stringify(value);
      const previous = dataRow.value;

      // Only update and emit if value changed
      if (serialized !== previous) {
        this.stmts.updateDeviceDataValue.run(serialized, dataRow.id);

        this.eventBus.emit({
          type: "device.data.updated",
          deviceId: device.id,
          dataId: dataRow.id,
          key,
          value,
          previous: previous !== null ? JSON.parse(previous) : null,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Update device online/offline status.
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

    if (device.status !== status) {
      this.stmts.updateDeviceStatus.run(status, device.id);
      this.logger.debug({ deviceId: device.id, name: mqttName, status }, "Device status changed");
      this.eventBus.emit({
        type: "device.status_changed",
        deviceId: device.id,
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
    const result = this.stmts.deleteDevice.run(id);
    if (result.changes > 0) {
      this.logger.info({ deviceId: id }, "Device deleted");
      this.eventBus.emit({ type: "device.removed", deviceId: id });
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
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    lastUpdated: row.last_updated,
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
