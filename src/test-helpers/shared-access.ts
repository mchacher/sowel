import Database from "better-sqlite3";
import { createMigratedTestDb } from "./migrations.js";
import { EquipmentManager } from "../equipments/equipment-manager.js";
import { DeviceManager } from "../devices/device-manager.js";
import { ZoneManager } from "../zones/zone-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { SharedAccessManager, SETTING_ENABLED } from "../shared-access/shared-access-manager.js";
import type { EngineEvent, OrderSource } from "../shared/types.js";

export const silentLogger = createLogger("silent").logger;

export interface Dispatch {
  equipmentId: string;
  alias: string;
  value: unknown;
  source?: OrderSource;
}

/**
 * Spec 181 — a real database and real equipments (the gate links are foreign
 * keys into them), with `executeOrder` replaced: what shared access owes is the
 * decision and the dispatch, and every test reads what reached the gate.
 *
 *   entree — an impulse gate: one `command` order, no value
 *   garage — a gate whose `command` has values open / close / stop
 *   volet  — a shutter, which is not a gate
 */
export interface SharedAccessHarness {
  db: Database.Database;
  eventBus: EventBus;
  equipments: EquipmentManager;
  manager: SharedAccessManager;
  settings: Map<string, string>;
  dispatches: Dispatch[];
  events: EngineEvent[];
  clock: { now: number };
  gates: { entree: string; garage: string; volet: string; portillon: string };
  setOutcome: (o: { success: boolean; error?: string }) => void;
  setThrows: (e: Error | null) => void;
  /** The next dispatch waits until the returned function is called. */
  holdNextDispatch: () => () => void;
  /** A date and hour on the house's clock, to epoch ms. */
  at: (y: number, m: number, d: number, h?: number, min?: number) => number;
}

export function buildSharedAccessHarness(
  opts: { enabled?: boolean; start?: number } = {},
): SharedAccessHarness {
  const db: Database.Database = createMigratedTestDb();
  const eventBus = new EventBus(silentLogger);
  const zoneManager = new ZoneManager(db, eventBus, silentLogger);
  const deviceManager = new DeviceManager(db, eventBus, silentLogger);
  const equipments = new EquipmentManager(
    db,
    eventBus,
    { getById: () => null, dispatchOrder: async () => {} } as never,
    deviceManager,
    silentLogger,
  );

  const zone = zoneManager.create({ name: "Cour" });

  function device(name: string, enumValues: string[] | null) {
    const deviceId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status, integration_id, source_device_id)
       VALUES (?, ?, ?, ?, 'zigbee2mqtt', 'online', 'zigbee2mqtt', ?)`,
    ).run(deviceId, `z2m/${name}`, name, name, name);
    const orderId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO device_orders (id, device_id, key, type, enum_values) VALUES (?, ?, 'command', ?, ?)`,
    ).run(
      orderId,
      deviceId,
      enumValues ? "enum" : "string",
      enumValues ? JSON.stringify(enumValues) : null,
    );
    return orderId;
  }

  const entree = equipments.create({ name: "Portail d'entrée", type: "gate", zoneId: zone.id });
  equipments.addOrderBinding(entree.id, device("entree", null), "command");
  const garage = equipments.create({ name: "Garage", type: "gate", zoneId: zone.id });
  equipments.addOrderBinding(garage.id, device("garage", ["open", "close", "stop"]), "command");
  const volet = equipments.create({ name: "Volet salon", type: "shutter", zoneId: zone.id });
  // A gate whose command declares a single value, as a LoRa or Somfy impulse
  // does (`["pulse"]`): its button sends no value, so neither does an access.
  const portillon = equipments.create({ name: "Portillon", type: "gate", zoneId: zone.id });
  equipments.addOrderBinding(portillon.id, device("portillon", ["pulse"]), "command");

  const settings = new Map<string, string>();
  if (opts.enabled !== false) settings.set(SETTING_ENABLED, "true");
  settings.set("sharedAccess.publicBaseUrl", "https://acces.example.org");
  const settingsManager = {
    get: (k: string) => settings.get(k),
    set: (k: string, v: string) => void settings.set(k, v),
  };

  const dispatches: Dispatch[] = [];
  let outcome: { success: boolean; error?: string } = { success: true };
  let throws: Error | null = null;
  let hold: Promise<void> | null = null;
  const equipmentManager = {
    getAll: () => equipments.getAll(),
    getById: (id: string) => equipments.getById(id),
    getOrderBindingsWithDetails: (id: string) => equipments.getOrderBindingsWithDetails(id),
    executeOrder: async (
      equipmentId: string,
      alias: string,
      value: unknown,
      source?: OrderSource,
    ) => {
      if (hold) {
        const waiting = hold;
        hold = null;
        await waiting;
      }
      dispatches.push({ equipmentId, alias, value, source });
      if (throws) throw throws;
      return outcome;
    },
  };

  const clock = { now: opts.start ?? new Date(2026, 9, 3, 12, 0).getTime() };
  const events: EngineEvent[] = [];
  eventBus.on((e) => events.push(e));

  const manager = new SharedAccessManager({
    db,
    eventBus,
    equipmentManager: equipmentManager as never,
    settingsManager,
    logger: silentLogger,
    now: () => clock.now,
  });

  return {
    db,
    eventBus,
    equipments,
    manager,
    settings,
    dispatches,
    events,
    clock,
    gates: { entree: entree.id, garage: garage.id, volet: volet.id, portillon: portillon.id },
    setOutcome: (o: { success: boolean; error?: string }) => {
      outcome = o;
    },
    setThrows: (e: Error | null) => {
      throws = e;
    },
    holdNextDispatch: () => {
      let release!: () => void;
      hold = new Promise<void>((r) => (release = r));
      return release;
    },
    at: (y: number, m: number, d: number, h = 0, min = 0) =>
      new Date(y, m - 1, d, h, min).getTime(),
  };
}
