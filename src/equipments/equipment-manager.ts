import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { IntegrationRegistry } from "../integrations/integration-registry.js";
import type { DeviceManager } from "../devices/device-manager.js";
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
  "light_onoff",
  "light_dimmable",
  "light_color",
  "shutter",
  "switch",
  "sensor",
  "button",
  "thermostat",
  "weather",
  "gate",
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
  private integrationRegistry: IntegrationRegistry;
  private deviceManager: DeviceManager;
  private stmts: ReturnType<typeof this.prepareStatements>;
  private unsubscribe: (() => void) | null = null;

  /** Gate equipments with a pending command — state is "unknown" until next sensor update */
  private pendingToggles = new Set<string>();

  constructor(
    db: Database.Database,
    eventBus: EventBus,
    integrationRegistry: IntegrationRegistry,
    deviceManager: DeviceManager,
    logger: Logger,
  ) {
    this.db = db;
    this.eventBus = eventBus;
    this.integrationRegistry = integrationRegistry;
    this.deviceManager = deviceManager;
    this.logger = logger.child({ module: "equipment-manager" });
    this.stmts = this.prepareStatements();

    // Listen for device data changes to propagate to equipment bindings
    this.unsubscribe = this.eventBus.on((event) => {
      if (event.type === "device.data.updated") {
        try {
          this.handleDeviceDataUpdated(event.dataId, event.value, event.previous);
        } catch (err) {
          this.logger.error({ err }, "Error handling device.data.updated for equipment bindings");
        }
      }
    });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
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
        `SELECT db.id, db.equipment_id, db.device_data_id, db.alias, db.historize,
                dd.device_id, d.name as device_name, dd.key, dd.type, dd.category,
                dd.value, dd.unit, dd.last_updated
         FROM data_bindings db
         JOIN device_data dd ON db.device_data_id = dd.id
         JOIN devices d ON dd.device_id = d.id
         WHERE db.equipment_id = ?`,
      ),
      setHistorize: this.db.prepare("UPDATE data_bindings SET historize = ? WHERE id = ?"),

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
                do2.dispatch_config, do2.min_value, do2.max_value,
                do2.enum_values, do2.unit
         FROM order_bindings ob
         JOIN device_orders do2 ON ob.device_order_id = do2.id
         JOIN devices d ON do2.device_id = d.id
         WHERE ob.equipment_id = ?`,
      ),
      getOrderBindingsByAlias: this.db.prepare(
        `SELECT ob.id, ob.equipment_id, ob.device_order_id, ob.alias,
                do2.device_id, d.name as device_name, do2.key, do2.type,
                do2.dispatch_config, do2.min_value, do2.max_value,
                do2.enum_values, do2.unit
         FROM order_bindings ob
         JOIN device_orders do2 ON ob.device_order_id = do2.id
         JOIN devices d ON do2.device_id = d.id
         WHERE ob.equipment_id = ? AND ob.alias = ?`,
      ),

      // Raw data bindings with device_data values (for gate state derivation — no recursion)
      getRawDataBindingsForEquipment: this.db.prepare(
        `SELECT db.alias, dd.key, dd.category, dd.value
         FROM data_bindings db
         JOIN device_data dd ON db.device_data_id = dd.id
         WHERE db.equipment_id = ?`,
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

  /**
   * Create equipment and auto-bind all data/orders from the given devices.
   * Data keys get a binding with alias = key name.
   * Order keys get a binding with alias = "command" (gate) or key name (other types).
   */
  createWithAutoBindings(
    input: CreateEquipmentInput & { deviceIds: string[] },
  ): EquipmentWithDetails {
    const equipment = this.create(input);

    for (const deviceId of input.deviceIds) {
      const device = this.deviceManager.getByIdWithDetails(deviceId);
      if (!device) {
        this.logger.warn({ deviceId }, "Device not found for auto-binding");
        continue;
      }

      // Bind all device data (sensors/state)
      for (const data of device.data) {
        try {
          this.addDataBinding(equipment.id, data.id, data.key);
        } catch {
          // Skip if alias conflict (same key from multiple devices)
        }
      }

      // Bind all device orders (commands)
      for (const order of device.orders) {
        const alias = input.type === "gate" ? "command" : order.key;
        try {
          this.addOrderBinding(equipment.id, order.id, alias);
        } catch {
          // Skip if already bound
        }
      }
    }

    return this.getByIdWithDetails(equipment.id)!;
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
    this.eventBus.emit({
      type: "equipment.removed",
      equipmentId: id,
      equipmentName: existing.name,
      zoneId: existing.zoneId,
    });
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
    const bindings = rows.map(rowToDataBindingWithValue);

    // Inject virtual gate state binding
    const equipment = this.getById(equipmentId);
    if (equipment?.type === "gate") {
      const state = this.deriveGateState(equipmentId);
      bindings.unshift(this.buildGateStateBinding(equipmentId, state));
    }

    return bindings;
  }

  /** Set the historize flag on a data binding. NULL = category default, 1 = force ON, 0 = force OFF. */
  setHistorize(bindingId: string, historize: number | null): void {
    this.stmts.setHistorize.run(historize, bindingId);
    this.logger.info({ bindingId, historize }, "DataBinding historize flag updated");
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

    const bindings = this.stmts.getOrderBindingsByAlias.all(
      equipmentId,
      alias,
    ) as OrderBindingJoinRow[];

    if (bindings.length === 0) {
      throw new EquipmentError(`Order alias not found: ${alias}`, 404);
    }

    // Resolve value: if null/undefined/empty, use the first enum value from the order binding
    let resolvedValue = value;
    if (resolvedValue === null || resolvedValue === undefined || resolvedValue === "") {
      const firstBinding = bindings[0];
      if (firstBinding.enum_values) {
        try {
          const enumVals = JSON.parse(firstBinding.enum_values);
          if (Array.isArray(enumVals) && enumVals.length > 0) {
            resolvedValue = enumVals[0];
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    // Dispatch to all bound device orders via their integration plugins
    for (const binding of bindings) {
      const device = this.deviceManager.getById(binding.device_id);
      if (!device) {
        this.logger.warn({ deviceId: binding.device_id }, "Device not found for order dispatch");
        continue;
      }

      const integration = this.integrationRegistry.getById(device.integrationId);
      if (!integration) {
        throw new EquipmentError(`Integration not found: ${device.integrationId}`, 503);
      }

      if (integration.getStatus() !== "connected") {
        throw new EquipmentError(`Integration ${device.integrationId} not connected`, 503);
      }

      let dispatchConfig: Record<string, unknown> = {};
      if (binding.dispatch_config) {
        try {
          dispatchConfig = JSON.parse(binding.dispatch_config);
        } catch {
          dispatchConfig = {};
        }
      }

      integration.executeOrder(device, dispatchConfig, resolvedValue).catch((err) => {
        this.logger.error(
          { err, equipmentId, alias, deviceId: device.id },
          "Integration order dispatch failed",
        );
      });

      this.logger.debug(
        { equipmentId, alias, integrationId: device.integrationId, deviceId: device.id },
        "Order dispatched to integration",
      );
    }

    this.logger.info(
      { equipmentId, alias, value: resolvedValue, targets: bindings.length },
      "Equipment order executed",
    );
    this.eventBus.emit({
      type: "equipment.order.executed",
      equipmentId,
      orderAlias: alias,
      value: resolvedValue,
    });

    // Gate command: mark state as "unknown" until next sensor update
    if (equipment.type === "gate" && alias === "command") {
      this.pendingToggles.add(equipmentId);
      this.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId,
        alias: "state",
        value: "unknown",
        previous: undefined,
      });
      this.logger.debug({ equipmentId }, "Gate command — state set to unknown");
    }
  }

  // ============================================================
  // Zone-level order execution
  // ============================================================

  /** Valid zone order keys and their mapping to equipment types + order alias + value. */
  private static readonly ZONE_ORDERS: Record<
    string,
    { types: string[]; alias: string; value: unknown }
  > = {
    allLightsOn: {
      types: ["light_onoff", "light_dimmable", "light_color"],
      alias: "state",
      value: "ON",
    },
    allLightsOff: {
      types: ["light_onoff", "light_dimmable", "light_color"],
      alias: "state",
      value: "OFF",
    },
    allShuttersOpen: { types: ["shutter"], alias: "position", value: 100 },
    allShuttersClose: { types: ["shutter"], alias: "position", value: 0 },
  };

  static readonly VALID_ZONE_ORDER_KEYS = Object.keys(EquipmentManager.ZONE_ORDERS);

  /**
   * Execute a zone-level order on all matching equipments across the given zone IDs.
   * Returns a summary of executed and errored orders.
   */
  executeZoneOrder(zoneIds: string[], orderKey: string): { executed: number; errors: number } {
    const mapping = EquipmentManager.ZONE_ORDERS[orderKey];
    if (!mapping) {
      throw new EquipmentError(`Invalid zone order key: ${orderKey}`, 400);
    }

    let executed = 0;
    let errors = 0;

    for (const zoneId of zoneIds) {
      const equipments = this.getByZone(zoneId);
      for (const eq of equipments) {
        if (!eq.enabled) continue;
        if (!mapping.types.includes(eq.type)) continue;

        try {
          this.executeOrder(eq.id, mapping.alias, mapping.value);
          executed++;
        } catch (err) {
          errors++;
          this.logger.warn(
            { err, equipmentId: eq.id, orderKey },
            "Zone order failed for equipment",
          );
        }
      }
    }

    this.logger.info(
      { orderKey, zoneCount: zoneIds.length, executed, errors },
      "Zone order executed",
    );
    return { executed, errors };
  }

  // ============================================================
  // Gate state derivation (virtual data binding)
  // ============================================================

  /**
   * Derive abstract gate state from raw device bindings.
   * - LoRa: RS keys (reed switches) — RS=1/true → closed, RS=0/false → open
   * - Zigbee: contact_door category — true → closed, false → open
   * - Pending toggle → "unknown"
   */
  private deriveGateState(equipmentId: string): "open" | "closed" | "unknown" {
    if (this.pendingToggles.has(equipmentId)) return "unknown";

    const rows = this.stmts.getRawDataBindingsForEquipment.all(equipmentId) as {
      alias: string;
      key: string;
      category: string;
      value: string | null;
    }[];

    // Strategy 1: LoRa reed switches (key starts with RS)
    const rsRows = rows.filter((r) => r.key.startsWith("RS"));
    if (rsRows.length > 0) {
      for (const r of rsRows) {
        let v: unknown = null;
        if (r.value !== null) {
          try {
            v = JSON.parse(r.value);
          } catch {
            v = r.value;
          }
        }
        if (v === "unknown") return "unknown";
        // RS=0/false → open (no contact)
        if (v === 0 || v === false) return "open";
      }
      return "closed";
    }

    // Strategy 2: Zigbee contact sensor
    const contactRows = rows.filter((r) => r.category === "contact_door");
    if (contactRows.length > 0) {
      for (const r of contactRows) {
        let v: unknown = null;
        if (r.value !== null) {
          try {
            v = JSON.parse(r.value);
          } catch {
            v = r.value;
          }
        }
        if (v === true) return "closed";
        if (v === false) return "open";
      }
    }

    return "unknown";
  }

  /** Build a virtual DataBindingWithValue for gate state. */
  private buildGateStateBinding(
    equipmentId: string,
    state: "open" | "closed" | "unknown",
  ): DataBindingWithValue {
    return {
      id: `virtual:gate_state:${equipmentId}`,
      equipmentId,
      deviceDataId: "",
      alias: "state",
      deviceId: "",
      deviceName: "",
      key: "gate_state",
      type: "enum" as DataType,
      category: "gate_state" as DataCategory,
      value: state,
      unit: undefined,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ============================================================
  // Reactive pipeline: device.data.updated -> equipment.data.changed
  // ============================================================

  private handleDeviceDataUpdated(dataId: string, value: unknown, previous: unknown): void {
    const bindings = this.stmts.getDataBindingsByDeviceData.all(dataId) as DataBindingRow[];

    for (const binding of bindings) {
      const equipment = this.getById(binding.equipment_id);

      // Clear pending toggle — sensor confirmed new state
      if (this.pendingToggles.has(binding.equipment_id)) {
        this.pendingToggles.delete(binding.equipment_id);
        this.logger.debug(
          { equipmentId: binding.equipment_id },
          "Gate toggle resolved — sensor update received",
        );
      }

      // Emit raw binding change
      this.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: binding.equipment_id,
        alias: binding.alias,
        value,
        previous,
      });

      // For gates, also emit derived abstract state
      if (equipment?.type === "gate") {
        const derivedState = this.deriveGateState(binding.equipment_id);
        this.eventBus.emit({
          type: "equipment.data.changed",
          equipmentId: binding.equipment_id,
          alias: "state",
          value: derivedState,
          previous: undefined,
        });
      }
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
  historize: number | null;
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
  dispatch_config: string;
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
    historize: row.historize ?? undefined,
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
    equipmentId: row.equipment_id,
    deviceOrderId: row.device_order_id,
    alias: row.alias,
    deviceId: row.device_id,
    deviceName: row.device_name,
    key: row.key,
    type: row.type as DataType,
    dispatchConfig,
    min: row.min_value ?? undefined,
    max: row.max_value ?? undefined,
    enumValues,
    unit: row.unit ?? undefined,
  };
}
