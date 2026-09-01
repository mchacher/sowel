import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { EquipmentManager } from "./equipment-manager.js";
import { TimedActionManager, TimedActionError } from "./timed-action-manager.js";
import { createMigratedTestDb } from "../test-helpers/migrations.js";
import { DeviceManager } from "../devices/device-manager.js";
import { ZoneManager } from "../zones/zone-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";

const logger = createLogger("silent").logger;

interface Dispatch {
  equipmentId: string;
  alias: string;
  value: unknown;
  source?: { kind: string; channel?: string; userId?: string };
}

/**
 * A real database and a real equipment (the timed_actions row has a foreign
 * key into it), with executeOrder replaced: what this manager owes is the
 * deadline, and every test here is about when it fires and when it does not.
 */
function buildHarness() {
  const db: Database.Database = createMigratedTestDb();
  const eventBus = new EventBus(logger);
  const zoneManager = new ZoneManager(db, eventBus, logger);
  const deviceManager = new DeviceManager(db, eventBus, logger);
  const realEquipments = new EquipmentManager(
    db,
    eventBus,
    { getById: () => null, dispatchOrder: async () => {} } as never,
    deviceManager,
    logger,
  );

  const dispatches: Dispatch[] = [];
  const events: EngineEvent[] = [];
  eventBus.on((event) => events.push(event));

  let outcome: { success: boolean; error?: string } = { success: true };
  let throws: Error | null = null;

  const equipmentManager = {
    getById: (id: string) => realEquipments.getById(id),
    // FR-11 asks the real bindings: eligibility is the guard that replaced the
    // identical-value refusal, so it has to see the gate's contact.
    getByIdWithDetails: (id: string) => realEquipments.getByIdWithDetails(id),
    executeOrder: async (equipmentId: string, alias: string, value: unknown, source?: never) => {
      dispatches.push({ equipmentId, alias, value, source });
      if (throws) throw throws;
      return outcome;
    },
  } as unknown as EquipmentManager;

  const zone = zoneManager.create({ name: "Entrée" });
  const gate = realEquipments.create({ name: "Portail", type: "gate", zoneId: zone.id });

  // A sliding gate as it really is: ONE impulse order carrying no value, and a
  // reed contact reading `gate_state`. That contact is what makes the equipment
  // eligible (FR-11) and what a hand-revert would speak through (FR-4).
  const deviceId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status, integration_id, source_device_id)
     VALUES (?, 'z2m/portail', 'portail', 'Portail', 'zigbee2mqtt', 'online', 'zigbee2mqtt', 'portail')`,
  ).run(deviceId);
  const stateDataId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO device_data (id, device_id, key, type, category, value)
     VALUES (?, ?, 'state', 'string', 'gate_state', 'closed')`,
  ).run(stateDataId, deviceId);
  const commandOrderId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO device_orders (id, device_id, key, type) VALUES (?, ?, 'command', 'string')`,
  ).run(commandOrderId, deviceId);
  realEquipments.addDataBinding(gate.id, stateDataId, "state");
  realEquipments.addOrderBinding(gate.id, commandOrderId, "command");

  // The counter-example FR-11 exists for: it takes the order and reads nothing.
  const blindRelay = realEquipments.create({ name: "Relais", type: "switch", zoneId: zone.id });
  realEquipments.addOrderBinding(blindRelay.id, commandOrderId, "command");

  const manager = new TimedActionManager(db, eventBus, equipmentManager, logger);

  return {
    db,
    eventBus,
    manager,
    dispatches,
    events,
    gateId: gate.id,
    blindRelayId: blindRelay.id,
    stateDataId,
    realEquipments,
    rows: () => db.prepare("SELECT * FROM timed_actions").all() as { equipment_id: string }[],
    failDispatch: (error: string) => {
      outcome = { success: false, error };
    },
    throwDispatch: (error: Error) => {
      throws = error;
    },
    of: <T extends EngineEvent["type"]>(type: T) => events.filter((e) => e.type === type),
  };
}

const ARM = { alias: "command", value: "OPEN", revertValue: "CLOSE", durationMs: 15 * 60_000 };

describe("TimedActionManager", () => {
  let h: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    h.manager.stop();
    h.db.close();
    vi.useRealTimers();
  });

  // ── Arming ───────────────────────────────────────────────────

  describe("arming", () => {
    it("dispatches the action and persists the revert it owes", async () => {
      const armed = await h.manager.arm(h.gateId, ARM, { kind: "manual", userId: "u1" });

      expect(h.dispatches).toEqual([
        {
          equipmentId: h.gateId,
          alias: "command",
          value: "OPEN",
          source: { kind: "manual", userId: "u1" },
        },
      ]);
      expect(armed.revertValue).toBe("CLOSE");
      expect(h.rows()).toHaveLength(1);
      expect(new Date(armed.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
      expect(h.of("equipment.timed_action.armed")).toHaveLength(1);
    });

    it("persists nothing when the action could not be sent", async () => {
      // A window on an action that never happened is worse than no window: the
      // deadline would fire a revert on an equipment nobody moved.
      h.failDispatch("integration unreachable");
      await expect(h.manager.arm(h.gateId, ARM)).rejects.toThrow(/could not be sent/);
      expect(h.rows()).toHaveLength(0);
      expect(h.manager.getFor(h.gateId)).toBeNull();
    });

    it("refuses an unknown equipment and an out-of-range window", async () => {
      await expect(h.manager.arm("nope", ARM)).rejects.toThrow(TimedActionError);
      await expect(h.manager.arm(h.gateId, { ...ARM, durationMs: 500 })).rejects.toThrow(
        /Duration must be/,
      );
      await expect(h.manager.arm(h.gateId, { ...ARM, durationMs: 48 * 3_600_000 })).rejects.toThrow(
        /Duration must be/,
      );
      expect(h.dispatches).toHaveLength(0);
    });

    // FR-9b + FR-11 — what replaced the identical-value refusal.
    it("arms an impulse, whose action and revert are the same command", async () => {
      const impulse = { alias: "command", value: null, revertValue: null, durationMs: 900_000 };
      const armed = await h.manager.arm(h.gateId, impulse);

      expect(armed.expiresAt).toBeTruthy();
      expect(h.dispatches).toEqual([
        { equipmentId: h.gateId, alias: "command", value: null, source: undefined },
      ]);
      expect(h.rows()).toHaveLength(1);
    });

    it("refuses an equipment with no state reading tied to the order", async () => {
      // A blind relay: it takes the command and reports nothing back. Nothing
      // could tell the engine the user reverted by hand (FR-4), so the deadline
      // would act on an equipment that has moved since — on a sequential
      // impulse, by re-opening what was just closed.
      const blind = h.blindRelayId;

      await expect(h.manager.arm(blind, ARM)).rejects.toThrow(/state reading/);
      expect(h.dispatches).toHaveLength(0);
      expect(h.rows()).toHaveLength(0);
    });

    // FR-13 — a surface arms what the equipment's own configuration says.
    it("arms from the stored configuration, and says when there is none", async () => {
      await expect(h.manager.armConfigured(h.gateId)).rejects.toThrow(/No timed command/);

      h.realEquipments.update(h.gateId, {
        timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
      });
      const armed = await h.manager.armConfigured(h.gateId);

      expect(armed.alias).toBe("command");
      expect(h.dispatches).toHaveLength(1);
      expect(h.manager.getFor(h.gateId)?.expiresAt).toBe(armed.expiresAt);
    });

    it("rule 3 — re-arming the same action moves the deadline and sends nothing", async () => {
      vi.useFakeTimers();
      const first = await h.manager.arm(h.gateId, ARM);
      await vi.advanceTimersByTimeAsync(60_000);
      const second = await h.manager.arm(h.gateId, { ...ARM, durationMs: 30 * 60_000 });

      expect(h.dispatches).toHaveLength(1); // "open again" is "give me more time"
      expect(new Date(second.expiresAt).getTime()).toBeGreaterThan(
        new Date(first.expiresAt).getTime(),
      );
      // The window is one window: it still says when it was opened.
      expect(second.armedAt).toBe(first.armedAt);
      expect(h.of("equipment.timed_action.armed")).toHaveLength(2);
      expect(
        h
          .of("equipment.timed_action.armed")
          .map((e) => (e.type === "equipment.timed_action.armed" ? e.extended : null)),
      ).toEqual([false, true]);
    });

    it("a different action replaces the window and is dispatched", async () => {
      await h.manager.arm(h.gateId, ARM);
      await h.manager.arm(h.gateId, { ...ARM, value: "HALF" });

      expect(h.dispatches.map((d) => d.value)).toEqual(["OPEN", "HALF"]);
      expect(h.rows()).toHaveLength(1);
      expect(h.manager.getFor(h.gateId)?.value).toBe("HALF");
    });
  });

  // ── Firing ───────────────────────────────────────────────────

  describe("the deadline", () => {
    it("dispatches the revert, once, and forgets the window", async () => {
      vi.useFakeTimers();
      h.manager.start();
      await h.manager.arm(h.gateId, ARM);

      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(h.dispatches.map((d) => d.value)).toEqual(["OPEN", "CLOSE"]);
      expect(h.dispatches[1].source).toEqual({ kind: "external", channel: "timed-action" });
      expect(h.rows()).toHaveLength(0);
      expect(h.of("equipment.timed_action.reverted")).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(h.dispatches).toHaveLength(2); // nothing fires twice
    });

    it("rule 4 — a revert that could not be sent alarms instead of retrying", async () => {
      vi.useFakeTimers();
      h.manager.start();
      await h.manager.arm(h.gateId, ARM);
      h.throwDispatch(new Error("integration unreachable"));

      await vi.advanceTimersByTimeAsync(15 * 60_000);
      // No replay: the engine cannot know whether a second send would put the
      // gate back or open it again. A human decides.
      expect(h.dispatches).toHaveLength(2);
      expect(h.of("equipment.timed_action.failed")).toHaveLength(1);
      const alarms = h.of("system.alarm.raised");
      expect(alarms).toHaveLength(1);
      expect(alarms[0].type === "system.alarm.raised" && alarms[0].message).toContain("Portail");
      expect(h.rows()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(h.dispatches).toHaveLength(2);
    });

    it("revertNow() sends it early, disarm() sends nothing", async () => {
      await h.manager.arm(h.gateId, ARM);
      expect(h.manager.disarm(h.gateId, "test")).toBe(true);
      expect(h.dispatches).toHaveLength(1);
      expect(h.of("equipment.timed_action.disarmed")).toHaveLength(1);

      await h.manager.arm(h.gateId, ARM);
      expect(await h.manager.revertNow(h.gateId, "test")).toBe(true);
      expect(h.dispatches.map((d) => d.value)).toEqual(["OPEN", "OPEN", "CLOSE"]);
      expect(h.rows()).toHaveLength(0);
    });

    it("says so when there was nothing armed", async () => {
      expect(h.manager.disarm(h.gateId, "test")).toBe(false);
      expect(await h.manager.revertNow(h.gateId, "test")).toBe(false);
    });
  });

  // ── Rule 2 ───────────────────────────────────────────────────

  describe("rule 2 — a hand-revert ends the window", () => {
    it("disarms when the mirror binding reports the revert value", async () => {
      vi.useFakeTimers();
      h.manager.start();
      await h.manager.arm(h.gateId, ARM);

      h.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: h.gateId,
        alias: "command",
        value: "CLOSE",
        previous: "OPEN",
      });

      expect(h.manager.getFor(h.gateId)).toBeNull();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      // The one that matters: no revert at the deadline. On a toggling command
      // that revert would re-open a gate somebody just closed.
      expect(h.dispatches).toHaveLength(1);
    });

    it("ignores another alias, another value, and another equipment", async () => {
      vi.useFakeTimers();
      h.manager.start();
      await h.manager.arm(h.gateId, ARM);

      for (const event of [
        { alias: "position", value: "CLOSE" },
        { alias: "command", value: "OPEN" },
      ]) {
        h.eventBus.emit({
          type: "equipment.data.changed",
          equipmentId: h.gateId,
          alias: event.alias,
          value: event.value,
          previous: null,
        });
      }
      h.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: "someone-else",
        alias: "command",
        value: "CLOSE",
        previous: null,
      });

      expect(h.manager.getFor(h.gateId)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(h.dispatches).toHaveLength(2); // the deadline still fired
    });

    it("does not read the engine's own revert as a hand-revert", async () => {
      // The row is dropped before the order goes out, so the mirror reporting
      // CLOSE a moment later finds nothing to disarm and logs nothing.
      vi.useFakeTimers();
      h.manager.start();
      await h.manager.arm(h.gateId, ARM);
      await vi.advanceTimersByTimeAsync(15 * 60_000);

      h.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: h.gateId,
        alias: "command",
        value: "CLOSE",
        previous: "OPEN",
      });
      expect(h.of("equipment.timed_action.disarmed")).toHaveLength(0);
    });
  });

  // ── Rule 1 ───────────────────────────────────────────────────

  describe("rule 1 — the deadline survives a restart", () => {
    it("re-schedules a window that is still ahead, on its remainder", async () => {
      vi.useFakeTimers();
      await h.manager.arm(h.gateId, ARM);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      h.manager.stop(); // the engine goes down with the gate open

      const revived = new TimedActionManager(
        h.db,
        h.eventBus,
        h.manager["equipmentManager"],
        logger,
      );
      revived.start();
      expect(h.dispatches).toHaveLength(1); // nothing fired on the way up

      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(h.dispatches).toHaveLength(1); // still inside the window
      await vi.advanceTimersByTimeAsync(60_000 + 1);
      expect(h.dispatches.map((d) => d.value)).toEqual(["OPEN", "CLOSE"]);
      revived.stop();
    });

    it("honours a deadline that passed while the engine was down", async () => {
      vi.useFakeTimers();
      await h.manager.arm(h.gateId, ARM);
      h.manager.stop();
      await vi.advanceTimersByTimeAsync(60 * 60_000); // a long outage

      const revived = new TimedActionManager(
        h.db,
        h.eventBus,
        h.manager["equipmentManager"],
        logger,
      );
      revived.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(h.dispatches.map((d) => d.value)).toEqual(["OPEN", "CLOSE"]);
      expect(h.rows()).toHaveLength(0);
      revived.stop();
    });

    it("deleting the equipment takes its deadline with it", async () => {
      await h.manager.arm(h.gateId, ARM);
      h.db.prepare("DELETE FROM equipments WHERE id = ?").run(h.gateId);
      expect(h.rows()).toHaveLength(0); // ON DELETE CASCADE
    });

    it("drops a row whose equipment is gone, without dispatching", () => {
      // The cascade covers the ordinary path; this row is what a restore or a
      // hand-edited database can leave behind, and reverting an equipment that
      // no longer exists would throw on the way up.
      h.db.pragma("foreign_keys = OFF");
      h.db
        .prepare(
          `INSERT INTO timed_actions
             (equipment_id, alias, action_value, revert_value, expires_at, armed_at, armed_by)
           VALUES ('ghost', 'command', '"OPEN"', '"CLOSE"', ?, ?, NULL)`,
        )
        .run(Date.now() - 1000, Date.now() - 2000);
      h.db.pragma("foreign_keys = ON");

      h.manager.start();
      expect(h.dispatches).toHaveLength(0);
      expect(h.rows()).toHaveLength(0);
    });

    it("start() is idempotent and stop() takes the timers with it", async () => {
      vi.useFakeTimers();
      h.manager.start();
      h.manager.start();
      await h.manager.arm(h.gateId, ARM);
      h.manager.stop();

      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(h.dispatches).toHaveLength(1); // the window is still owed, not fired
      expect(h.rows()).toHaveLength(1); // and still remembered for the next start
    });
  });

  // ── The payload ──────────────────────────────────────────────

  describe("the equipment payload", () => {
    it("carries the deadline standing on it, and nothing when none does", async () => {
      h.realEquipments.registerTimedActionProvider((id) => h.manager.getFor(id));

      expect(h.realEquipments.getByIdWithDetails(h.gateId)?.timedAction).toBeUndefined();
      await h.manager.arm(h.gateId, ARM);

      const detailed = h.realEquipments.getByIdWithDetails(h.gateId);
      expect(detailed?.timedAction?.revertValue).toBe("CLOSE");
      expect(typeof detailed?.timedAction?.expiresAt).toBe("string");
      expect(h.realEquipments.getAllWithDetails()[0].timedAction?.alias).toBe("command");
    });

    it("survives a provider that throws", () => {
      h.realEquipments.registerTimedActionProvider(() => {
        throw new Error("boom");
      });
      expect(() => h.realEquipments.getAllWithDetails()).not.toThrow();
    });
  });
});
