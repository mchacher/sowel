import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { MqttConnector } from "../mqtt/mqtt-connector.js";
import { toISOUtc } from "../core/database.js";
import type {
  Equipment,
  EquipmentType,
  EquipmentWithDetails,
  DataBinding,
  DataBindingWithValue,
  OrderBinding,
  OrderBindingWithDetails,
  DataType,
  DataCategory,
} from "../shared/types.js";

// ============================================================
// Valid EquipmentType values
// ============================================================

const VALID_EQUIPMENT_TYPES: Set<string> = new Set([
  "light_onoff", "light_dimmable", "light_color", "shutter", "thermostat",
  "lock", "alarm", "sensor", "motion_sensor", "contact_sensor",
  "media_player", "camera", "switch", "generic",
]);

// ============================================================
// Input types
// ============================================================

interface CreateEquipmentInput {
  name: string;
  zoneId: string;
  type: EquipmentType;
  icon?: string;
  description?: string;
}

interface UpdateEquipmentInput {
  name?: string;
  zoneId?: string;
  type?: EquipmentType;
  icon?: string | null;
  description?: string | null;
  enabled?: boolean;
}

// ============================================================
// Equipment Manager
// ============================================================

export class EquipmentManager {
  private db: Database.Database;
  private logger: Logger;
  private eventBus: EventBus;
  private mqttConnector: MqttConnector;
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(
    db: Database.Database,
    eventBus: EventBus,
    mqttConnector: MqttConnector,
    logger: Logger,
  ) {
    this.db = db;
    this.eventBus = eventBus;
    this.mqttConnector = mqttConnector;
    this.logger = logger.child({ module: "equipment-manager" });
    this.stmts = this.prepareStatements();

    // Listen for device data changes to propagate to equipment bindings
    this.eventBus.on((event) => {
      if (event.type === "device.data.updated") {
        try {
          this.handleDeviceDataUpdated(event.dataId, event.value, event.previous);
        } catch (err) {
          this.logger.error({ err }, "Error handling device.data.updated for equipment bindings");
        }
      }
    });
  }

  private prepareStatements() {
    return {
      // Equipment CRUD
      insertEquipment: this.db.prepare(
        `INSERT INTO equipments (id, name, zone_id, type, icon, description, enabled)
         VALUES (@id, @name, @zoneId, @type, @icon, @description, @enabled)`,
      ),
      getEquipmentById: this.db.prepare("SELECT * FROM equipments WHERE id = ?"),
      getAllEquipments: this.db.prepare("SELECT * FROM equipments ORDER BY name"),
      getEquipmentsByZone: this.db.prepare(
        "SELECT * FROM equipments WHERE zone_id = ? ORDER BY name",
      ),
      updateEquipment: this.db.prepare(
        `UPDATE equipments SET name = @name, zone_id = @zoneId,
         type = @type, icon = @icon, description = @description, enabled = @enabled,
         updated_at = datetime('now') WHERE id = @id`,
      ),
      deleteEquipment: this.db.prepare("DELETE FROM equipments WHERE id = ?"),
      countEquipmentsByZone: this.db.prepare(
        "SELECT COUNT(*) as count FROM equipments WHERE zone_id = ?",
      ),

      // DataBinding
      insertDataBinding: this.db.prepare(
        `INSERT INTO data_bindings (id, equipment_id, device_data_id, alias)
         VALUES (@id, @equipmentId, @deviceDataId, @alias)`,
      ),
      deleteDataBinding: this.db.prepare("DELETE FROM data_bindings WHERE id = ?"),
      getDataBindingById: this.db.prepare("SELECT * FROM data_bindings WHERE id = ?"),
      getDataBindingsByEquipment: this.db.prepare(
        "SELECT * FROM data_bindings WHERE equipment_id = ?",
      ),
      getDataBindingsByDeviceData: this.db.prepare(
        "SELECT * FROM data_bindings WHERE device_data_id = ?",
      ),
      getDataBindingsWithValues: this.db.prepare(
        `SELECT db.id, db.equipment_id, db.device_data_id, db.alias,
                dd.device_id, d.name as device_name, dd.key, dd.type, dd.category,
                dd.value, dd.unit, dd.last_updated
         FROM data_bindings db
         JOIN device_data dd ON db.device_data_id = dd.id
         JOIN devices d ON dd.device_id = d.id
         WHERE db.equipment_id = ?`,
      ),

      // OrderBinding
      insertOrderBinding: this.db.prepare(
        `INSERT INTO order_bindings (id, equipment_id, device_order_id, alias)
         VALUES (@id, @equipmentId, @deviceOrderId, @alias)`,
      ),
      deleteOrderBinding: this.db.prepare("DELETE FROM order_bindings WHERE id = ?"),
      getOrderBindingById: this.db.prepare("SELECT * FROM order_bindings WHERE id = ?"),
      getOrderBindingsByEquipment: this.db.prepare(
        "SELECT * FROM order_bindings WHERE equipment_id = ?",
      ),
      getOrderBindingsWithDetails: this.db.prepare(
        `SELECT ob.id, ob.equipment_id, ob.device_order_id, ob.alias,
                do2.device_id, d.name as device_name, do2.key, do2.type,
                do2.mqtt_set_topic, do2.payload_key, do2.min_value, do2.max_value,
                do2.enum_values, do2.unit
         FROM order_bindings ob
         JOIN device_orders do2 ON ob.device_order_id = do2.id
         JOIN devices d ON do2.device_id = d.id
         WHERE ob.equipment_id = ?`,
      ),
      getOrderBindingsByAlias: this.db.prepare(
        `SELECT ob.id, ob.equipment_id, ob.device_order_id, ob.alias,
                do2.device_id, d.name as device_name, do2.key, do2.type,
                do2.mqtt_set_topic, do2.payload_key, do2.min_value, do2.max_value,
                do2.enum_values, do2.unit
         FROM order_bindings ob
         JOIN device_orders do2 ON ob.device_order_id = do2.id
         JOIN devices d ON do2.device_id = d.id
         WHERE ob.equipment_id = ? AND ob.alias = ?`,
      ),

      // Validation helpers
      checkZoneExists: this.db.prepare("SELECT id FROM zones WHERE id = ?"),
      checkDeviceDataExists: this.db.prepare("SELECT id FROM device_data WHERE id = ?"),
      checkDeviceOrderExists: this.db.prepare("SELECT id FROM device_orders WHERE id = ?"),
    };
  }

  // ============================================================
  // Equipment CRUD
  // ============================================================

  create(input: CreateEquipmentInput): Equipment {
    if (!VALID_EQUIPMENT_TYPES.has(input.type)) {
      throw new EquipmentError(`Invalid equipment type: ${input.type}`, 400);
    }

    // Validate zone exists
    if (!this.stmts.checkZoneExists.get(input.zoneId)) {
      throw new EquipmentError(`Zone not found: ${input.zoneId}`, 404);
    }

    const id = randomUUID();
    this.stmts.insertEquipment.run({
      id,
      name: input.name,
      zoneId: input.zoneId,
      type: input.type,
      icon: input.icon ?? null,
      description: input.description ?? null,
      enabled: 1,
    });

    const equipment = this.getById(id)!;
    this.logger.info({ equipmentId: id, name: input.name, type: input.type }, "Equipment created");
    this.eventBus.emit({ type: "equipment.created", equipment });
    return equipment;
  }

  getById(id: string): Equipment | null {
    const row = this.stmts.getEquipmentById.get(id) as EquipmentRow | undefined;
    return row ? rowToEquipment(row) : null;
  }

  getAll(): Equipment[] {
    const rows = this.stmts.getAllEquipments.all() as EquipmentRow[];
    return rows.map(rowToEquipment);
  }

  getByZone(zoneId: string): Equipment[] {
    const rows = this.stmts.getEquipmentsByZone.all(zoneId) as EquipmentRow[];
    return rows.map(rowToEquipment);
  }

  getByIdWithDetails(id: string): EquipmentWithDetails | null {
    const equipment = this.getById(id);
    if (!equipment) return null;

    return {
      ...equipment,
      dataBindings: this.getDataBindingsWithValues(id),
      orderBindings: this.getOrderBindingsWithDetails(id),
    };
  }

  getAllWithDetails(): EquipmentWithDetails[] {
    const equipments = this.getAll();
    return equipments.map((eq) => ({
      ...eq,
      dataBindings: this.getDataBindingsWithValues(eq.id),
      orderBindings: this.getOrderBindingsWithDetails(eq.id),
    }));
  }

  update(id: string, input: UpdateEquipmentInput): Equipment | null {
    const existing = this.stmts.getEquipmentById.get(id) as EquipmentRow | undefined;
    if (!existing) return null;

    if (input.type !== undefined && !VALID_EQUIPMENT_TYPES.has(input.type)) {
      throw new EquipmentError(`Invalid equipment type: ${input.type}`, 400);
    }

    const newZoneId = input.zoneId ?? existing.zone_id;
    if (input.zoneId && !this.stmts.checkZoneExists.get(input.zoneId)) {
      throw new EquipmentError(`Zone not found: ${input.zoneId}`, 404);
    }

    this.stmts.updateEquipment.run({
      id,
      name: input.name ?? existing.name,
      zoneId: newZoneId,
      type: input.type ?? existing.type,
      icon: input.icon !== undefined ? input.icon : existing.icon,
      description: input.description !== undefined ? input.description : existing.description,
      enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
    });

    const equipment = this.getById(id)!;
    this.logger.info({ equipmentId: id, name: equipment.name }, "Equipment updated");
    this.eventBus.emit({ type: "equipment.updated", equipment });
    return equipment;
  }

  delete(id: string): void {
    const existing = this.getById(id);
    if (!existing) {
      throw new EquipmentError("Equipment not found", 404);
    }

    this.stmts.deleteEquipment.run(id);
    this.logger.info({ equipmentId: id, name: existing.name }, "Equipment deleted");
    this.eventBus.emit({ type: "equipment.removed", equipmentId: id, equipmentName: existing.name });
  }

  countByZone(zoneId: string): number {
    const row = this.stmts.countEquipmentsByZone.get(zoneId) as { count: number };
    return row.count;
  }

  // ============================================================
  // DataBinding management
  // ============================================================

  addDataBinding(equipmentId: string, deviceDataId: string, alias: string): DataBinding {
    if (!this.getById(equipmentId)) {
      throw new EquipmentError("Equipment not found", 404);
    }
    if (!this.stmts.checkDeviceDataExists.get(deviceDataId)) {
      throw new EquipmentError(`DeviceData not found: ${deviceDataId}`, 404);
    }

    const id = randomUUID();
    try {
      this.stmts.insertDataBinding.run({ id, equipmentId, deviceDataId, alias });
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        throw new EquipmentError(`Alias "${alias}" already exists on this equipment`, 409);
      }
      throw err;
    }

    this.logger.info({ equipmentId, alias, deviceDataId }, "DataBinding added");
    return { id, equipmentId, deviceDataId, alias };
  }

  removeDataBinding(equipmentId: string, bindingId: string): void {
    const binding = this.stmts.getDataBindingById.get(bindingId) as DataBindingRow | undefined;
    if (!binding || binding.equipment_id !== equipmentId) {
      throw new EquipmentError("DataBinding not found", 404);
    }

    this.stmts.deleteDataBinding.run(bindingId);
    this.logger.info({ equipmentId, bindingId }, "DataBinding removed");
  }

  getDataBindingsWithValues(equipmentId: string): DataBindingWithValue[] {
    const rows = this.stmts.getDataBindingsWithValues.all(equipmentId) as DataBindingJoinRow[];
    return rows.map(rowToDataBindingWithValue);
  }

  // ============================================================
  // OrderBinding management
  // ============================================================

  addOrderBinding(equipmentId: string, deviceOrderId: string, alias: string): OrderBinding {
    if (!this.getById(equipmentId)) {
      throw new EquipmentError("Equipment not found", 404);
    }
    if (!this.stmts.checkDeviceOrderExists.get(deviceOrderId)) {
      throw new EquipmentError(`DeviceOrder not found: ${deviceOrderId}`, 404);
    }

    const id = randomUUID();
    try {
      this.stmts.insertOrderBinding.run({ id, equipmentId, deviceOrderId, alias });
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        throw new EquipmentError(
          `OrderBinding for alias "${alias}" with this device order already exists`,
          409,
        );
      }
      throw err;
    }

    this.logger.info({ equipmentId, alias, deviceOrderId }, "OrderBinding added");
    return { id, equipmentId, deviceOrderId, alias };
  }

  removeOrderBinding(equipmentId: string, bindingId: string): void {
    const binding = this.stmts.getOrderBindingById.get(bindingId) as OrderBindingRow | undefined;
    if (!binding || binding.equipment_id !== equipmentId) {
      throw new EquipmentError("OrderBinding not found", 404);
    }

    this.stmts.deleteOrderBinding.run(bindingId);
    this.logger.info({ equipmentId, bindingId }, "OrderBinding removed");
  }

  getOrderBindingsWithDetails(equipmentId: string): OrderBindingWithDetails[] {
    const rows = this.stmts.getOrderBindingsWithDetails.all(equipmentId) as OrderBindingJoinRow[];
    return rows.map(rowToOrderBindingWithDetails);
  }

  // ============================================================
  // Order execution
  // ============================================================

  executeOrder(equipmentId: string, alias: string, value: unknown): void {
    const equipment = this.getById(equipmentId);
    if (!equipment) {
      throw new EquipmentError("Equipment not found", 404);
    }
    if (!equipment.enabled) {
      throw new EquipmentError("Equipment is disabled", 400);
    }
    if (!this.mqttConnector.isConnected()) {
      throw new EquipmentError("MQTT broker not connected", 503);
    }

    const bindings = this.stmts.getOrderBindingsByAlias.all(
      equipmentId,
      alias,
    ) as OrderBindingJoinRow[];

    if (bindings.length === 0) {
      throw new EquipmentError(`Order alias not found: ${alias}`, 404);
    }

    // Dispatch to all bound device orders
    for (const binding of bindings) {
      const payload: Record<string, unknown> = {};
      payload[binding.payload_key] = value;
      this.mqttConnector.publish(binding.mqtt_set_topic, JSON.stringify(payload));
      this.logger.debug(
        { equipmentId, alias, topic: binding.mqtt_set_topic, payload },
        "Order dispatched to MQTT",
      );
    }

    this.logger.info({ equipmentId, alias, value, targets: bindings.length }, "Equipment order executed");
    this.eventBus.emit({ type: "equipment.order.executed", equipmentId, orderAlias: alias, value });
  }

  // ============================================================
  // Reactive pipeline: device.data.updated -> equipment.data.changed
  // ============================================================

  private handleDeviceDataUpdated(dataId: string, value: unknown, previous: unknown): void {
    const bindings = this.stmts.getDataBindingsByDeviceData.all(dataId) as DataBindingRow[];

    for (const binding of bindings) {
      this.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: binding.equipment_id,
        alias: binding.alias,
        value,
        previous,
      });
    }
  }
}

// ============================================================
// Custom error
// ============================================================

export class EquipmentError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "EquipmentError";
    this.status = status;
  }
}

// ============================================================
// SQLite row types and mappers
// ============================================================

interface EquipmentRow {
  id: string;
  name: string;
  zone_id: string;
  type: string;
  icon: string | null;
  description: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface DataBindingRow {
  id: string;
  equipment_id: string;
  device_data_id: string;
  alias: string;
}

interface OrderBindingRow {
  id: string;
  equipment_id: string;
  device_order_id: string;
  alias: string;
}

interface DataBindingJoinRow {
  id: string;
  equipment_id: string;
  device_data_id: string;
  alias: string;
  device_id: string;
  device_name: string;
  key: string;
  type: string;
  category: string;
  value: string | null;
  unit: string | null;
  last_updated: string | null;
}

interface OrderBindingJoinRow {
  id: string;
  equipment_id: string;
  device_order_id: string;
  alias: string;
  device_id: string;
  device_name: string;
  key: string;
  type: string;
  mqtt_set_topic: string;
  payload_key: string;
  min_value: number | null;
  max_value: number | null;
  enum_values: string | null;
  unit: string | null;
}

function rowToEquipment(row: EquipmentRow): Equipment {
  return {
    id: row.id,
    name: row.name,
    zoneId: row.zone_id,
    type: row.type as EquipmentType,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    enabled: row.enabled === 1,
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
  };
}

function rowToDataBindingWithValue(row: DataBindingJoinRow): DataBindingWithValue {
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
    equipmentId: row.equipment_id,
    deviceDataId: row.device_data_id,
    alias: row.alias,
    deviceId: row.device_id,
    deviceName: row.device_name,
    key: row.key,
    type: row.type as DataType,
    category: row.category as DataCategory,
    value,
    unit: row.unit ?? undefined,
    lastUpdated: toISOUtc(row.last_updated),
  };
}

function rowToOrderBindingWithDetails(row: OrderBindingJoinRow): OrderBindingWithDetails {
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
    equipmentId: row.equipment_id,
    deviceOrderId: row.device_order_id,
    alias: row.alias,
    deviceId: row.device_id,
    deviceName: row.device_name,
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
