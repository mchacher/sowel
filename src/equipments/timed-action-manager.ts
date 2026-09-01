import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { OrderSource, TimedAction } from "../shared/types.js";
import type { EquipmentManager } from "./equipment-manager.js";
import { valuesMatch } from "./order-confirmation-tracker.js";
import { isTimedCommandEligible } from "../shared/timed-command.js";

// ============================================================
// Spec 174 — a timed action on an actuable equipment
//
// "Act now, revert after N minutes" had no expression in the engine, so every
// instance of it was a recipe holding its own clock: motion-light,
// state-trigger-light, delivery-gate. Three copies, three sets of cancellation
// rules, and the rules already disagreed.
//
// This manager owns the DEADLINE, and nothing else. The action itself is
// dispatched through `executeOrder` like any other order, so it inherits
// inversion (spec 154), value resolution (spec 150), delivery confirmation and
// its replay (spec 141) — none of which is re-implemented here. What is added
// is the one thing missing: something that remembers, across a restart, that
// the gate in the yard is open.
//
// The four rules the issue asked to be decided rather than discovered:
//
//   1. PERSISTED. The revert is a row, not a setTimeout. A deadline that
//      passed while the engine was down fires on the way back up — that outage
//      is the case the whole feature exists for.
//   2. A HAND-REVERT DISARMS. The mirror binding reporting the revert value
//      while a deadline stands means the user already did it. Firing later
//      would undo their own hand, and on a toggling command it would do worse:
//      re-open the gate they just closed.
//   3. A SECOND ARM REPLACES. "Open again", from somebody looking at a gate
//      that is already open, means "give me more time" — not "open twice". The
//      same action on an already-armed equipment moves the deadline and sends
//      nothing.
//   4. A FAILED DISPATCH ALARMS AND DISARMS. The engine cannot know whether
//      replaying a command is safe: a dedicated CLOSE is a no-op, a sequential
//      impulse re-opens what it just closed. Until an integration can declare
//      which it is, the honest move is to put a human in the loop rather than
//      guess. (Spec 141 still replays the orders it can confirm — that path is
//      unchanged and is not a blind retry.)
// ============================================================

/** Shortest window worth persisting; below it, this is just an order. */
export const MIN_DURATION_MS = 10_000;
/** Longest window. A day is the limit of "temporary" for an opening. */
export const MAX_DURATION_MS = 24 * 3_600_000;

/** OrderSource channel identifying the reverts this manager dispatches. */
export const TIMED_ACTION_CHANNEL = "timed-action";

const ALARM_SOURCE = "timed-action";

interface TimedActionRow {
  equipment_id: string;
  alias: string;
  action_value: string;
  revert_value: string;
  expires_at: number;
  armed_at: number;
  armed_by: string | null;
}

export interface ArmTimedActionInput {
  /** Order alias carrying both the action and the revert. */
  alias: string;
  /** Value dispatched now. */
  value: unknown;
  /** Value dispatched at the deadline. */
  revertValue: unknown;
  durationMs: number;
}

export class TimedActionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "TimedActionError";
  }
}

export class TimedActionManager {
  private readonly db: Database.Database;
  private readonly eventBus: EventBus;
  private readonly equipmentManager: EquipmentManager;
  private readonly logger: Logger;

  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly unsubscribes: (() => void)[] = [];
  private readonly stmts;
  private started = false;

  constructor(
    db: Database.Database,
    eventBus: EventBus,
    equipmentManager: EquipmentManager,
    logger: Logger,
  ) {
    this.db = db;
    this.eventBus = eventBus;
    this.equipmentManager = equipmentManager;
    this.logger = logger.child({ module: "timed-action" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      upsert: this.db.prepare(
        `INSERT INTO timed_actions
           (equipment_id, alias, action_value, revert_value, expires_at, armed_at, armed_by)
         VALUES (@equipmentId, @alias, @actionValue, @revertValue, @expiresAt, @armedAt, @armedBy)
         ON CONFLICT(equipment_id) DO UPDATE SET
           alias = excluded.alias,
           action_value = excluded.action_value,
           revert_value = excluded.revert_value,
           expires_at = excluded.expires_at,
           armed_at = excluded.armed_at,
           armed_by = excluded.armed_by`,
      ),
      getOne: this.db.prepare(`SELECT * FROM timed_actions WHERE equipment_id = ?`),
      getAll: this.db.prepare(`SELECT * FROM timed_actions ORDER BY expires_at ASC`),
      remove: this.db.prepare(`DELETE FROM timed_actions WHERE equipment_id = ?`),
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────

  /**
   * Rehydrate the deadlines the previous run left behind, then watch for the
   * hand-reverts that end them early.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const rows = this.stmts.getAll.all() as TimedActionRow[];
    const now = Date.now();
    for (const row of rows) {
      if (!this.equipmentManager.getById(row.equipment_id)) {
        // The equipment went away while the engine was down and the cascade
        // did not run (a restore, a manual edit). Nothing to revert.
        this.stmts.remove.run(row.equipment_id);
        continue;
      }
      if (row.expires_at <= now) {
        this.logger.warn(
          { equipmentId: row.equipment_id, expiredBy: now - row.expires_at },
          "Timed action expired while the engine was down — reverting now",
        );
        void this.fire(row, "expired while the engine was down");
        continue;
      }
      this.schedule(row);
      this.logger.info(
        { equipmentId: row.equipment_id, remainingMs: row.expires_at - now },
        "Timed action picked back up",
      );
    }

    this.unsubscribes.push(
      this.eventBus.onType("equipment.data.changed", (event) => {
        this.onDataChanged(event.equipmentId, event.alias, event.value);
      }),
      this.eventBus.onType("equipment.removed", (event) => {
        this.clearTimer(event.equipmentId);
      }),
    );
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.started = false;
  }

  // ── Reading ──────────────────────────────────────────────────

  /** The deadline standing on an equipment, for the API and the UI. */
  getFor(equipmentId: string): TimedAction | null {
    const row = this.stmts.getOne.get(equipmentId) as TimedActionRow | undefined;
    return row ? this.toView(row) : null;
  }

  private toView(row: TimedActionRow): TimedAction {
    return {
      alias: row.alias,
      value: JSON.parse(row.action_value) as unknown,
      revertValue: JSON.parse(row.revert_value) as unknown,
      expiresAt: new Date(row.expires_at).toISOString(),
      armedAt: new Date(row.armed_at).toISOString(),
      ...(row.armed_by !== null ? { armedBy: row.armed_by } : {}),
    };
  }

  // ── Arming ───────────────────────────────────────────────────

  /**
   * Act now, and owe a revert at the deadline.
   *
   * Rule 3: re-arming the same action on the same equipment moves the deadline
   * and sends nothing. Anything else — a different alias, a different value —
   * is a new intent and is dispatched.
   */
  /**
   * FR-13 — what the equipment's own configuration arms.
   *
   * A surface holding an equipment does not have to restate the three values
   * its configuration already carries; a caller that knows better still passes
   * them explicitly to `arm`.
   */
  async armConfigured(equipmentId: string, source?: OrderSource): Promise<TimedAction> {
    const equipment = this.equipmentManager.getById(equipmentId);
    if (!equipment) throw new TimedActionError("Equipment not found", 404);
    const configured = equipment.timedCommand;
    if (!configured) {
      // Told apart from "cannot be armed" on purpose: one is a configuration a
      // user can go and write, the other is an equipment that will never do it.
      throw new TimedActionError("No timed command configured on this equipment", 409);
    }
    return this.arm(
      equipmentId,
      {
        alias: configured.alias,
        value: configured.value,
        revertValue: configured.revertValue,
        durationMs: configured.durationMs,
      },
      source,
    );
  }

  async arm(
    equipmentId: string,
    input: ArmTimedActionInput,
    source?: OrderSource,
  ): Promise<TimedAction> {
    const equipment = this.equipmentManager.getById(equipmentId);
    if (!equipment) throw new TimedActionError("Equipment not found", 404);
    if (input.durationMs < MIN_DURATION_MS || input.durationMs > MAX_DURATION_MS) {
      throw new TimedActionError(
        `Duration must be between ${MIN_DURATION_MS / 1000}s and ${MAX_DURATION_MS / 3_600_000}h`,
      );
    }
    // FR-9b. The first draft refused an action and a revert carrying the same
    // value, reasoning that the deadline would send what is already there. True
    // of a dedicated ON/OFF pair, false of the hardware this feature exists for:
    // a sliding gate on a sequential impulse is opened and closed by the SAME
    // command, carrying no value at all. The refusal excluded the primary use
    // case, so what stands in its place is FR-11 — the equipment must carry the
    // order, and a state reading tied to it. Without that reading nothing can
    // tell the engine the user already reverted by hand (FR-4), so the deadline
    // would run to its end and act on an equipment that has moved since.
    const details = this.equipmentManager.getByIdWithDetails(equipmentId);
    if (!details || !isTimedCommandEligible(details, input.alias)) {
      throw new TimedActionError(
        `${equipment.name} cannot carry a timed "${input.alias}": it needs that order and a state reading tied to it`,
      );
    }

    const existing = this.stmts.getOne.get(equipmentId) as TimedActionRow | undefined;
    const extending =
      existing !== undefined &&
      existing.alias === input.alias &&
      valuesMatch(JSON.parse(existing.action_value), input.value);

    if (!extending) {
      // executeOrder throws on an unknown alias or a disabled equipment, which
      // is what should happen: nothing is persisted for an order that cannot go.
      const result = await this.equipmentManager.executeOrder(
        equipmentId,
        input.alias,
        input.value,
        source,
      );
      if (!result.success) {
        throw new TimedActionError(
          `The action could not be sent: ${result.error ?? "dispatch failed"}`,
          502,
        );
      }
    }

    const now = Date.now();
    const row: TimedActionRow = {
      equipment_id: equipmentId,
      alias: input.alias,
      action_value: JSON.stringify(input.value ?? null),
      revert_value: JSON.stringify(input.revertValue ?? null),
      expires_at: now + input.durationMs,
      armed_at: extending && existing ? existing.armed_at : now,
      armed_by: source?.kind === "manual" ? source.userId : null,
    };
    this.stmts.upsert.run({
      equipmentId: row.equipment_id,
      alias: row.alias,
      actionValue: row.action_value,
      revertValue: row.revert_value,
      expiresAt: row.expires_at,
      armedAt: row.armed_at,
      armedBy: row.armed_by,
    });
    this.schedule(row);

    this.logger.info(
      {
        equipmentId,
        alias: input.alias,
        durationMs: input.durationMs,
        extended: extending,
      },
      extending ? "Timed action extended" : "Timed action armed",
    );
    this.eventBus.emit({
      type: "equipment.timed_action.armed",
      equipmentId,
      equipmentName: equipment.name,
      orderAlias: input.alias,
      value: input.value,
      revertValue: input.revertValue,
      expiresAt: row.expires_at,
      extended: extending,
      ...(source !== undefined ? { source } : {}),
    });

    return this.toView(row);
  }

  // ── Disarming ────────────────────────────────────────────────

  /** Drop the deadline without sending anything. */
  disarm(equipmentId: string, reason: string): boolean {
    const row = this.stmts.getOne.get(equipmentId) as TimedActionRow | undefined;
    if (!row) return false;
    this.clearTimer(equipmentId);
    this.stmts.remove.run(equipmentId);
    this.logger.info({ equipmentId, reason }, "Timed action disarmed");
    this.eventBus.emit({
      type: "equipment.timed_action.disarmed",
      equipmentId,
      equipmentName: this.equipmentManager.getById(equipmentId)?.name ?? equipmentId,
      orderAlias: row.alias,
      reason,
    });
    return true;
  }

  /** Send the revert now and drop the deadline — the "I changed my mind" path. */
  async revertNow(equipmentId: string, reason: string): Promise<boolean> {
    const row = this.stmts.getOne.get(equipmentId) as TimedActionRow | undefined;
    if (!row) return false;
    await this.fire(row, reason);
    return true;
  }

  // ── Firing ───────────────────────────────────────────────────

  private schedule(row: TimedActionRow): void {
    this.clearTimer(row.equipment_id);
    const delay = Math.max(0, row.expires_at - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(row.equipment_id);
      void this.fire(row, "window elapsed");
    }, delay);
    timer.unref?.();
    this.timers.set(row.equipment_id, timer);
  }

  private clearTimer(equipmentId: string): void {
    const timer = this.timers.get(equipmentId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(equipmentId);
    }
  }

  /**
   * Dispatch the revert the engine owes.
   *
   * The row is dropped BEFORE the order goes out: the mirror binding is about
   * to report the revert value, and a row still standing would read that as a
   * hand-revert (rule 2) and log a disarm for something the engine did itself.
   */
  private async fire(row: TimedActionRow, reason: string): Promise<void> {
    const equipmentId = row.equipment_id;
    this.clearTimer(equipmentId);
    this.stmts.remove.run(equipmentId);

    const name = this.equipmentManager.getById(equipmentId)?.name ?? equipmentId;
    const revertValue = JSON.parse(row.revert_value) as unknown;
    const source: OrderSource = { kind: "external", channel: TIMED_ACTION_CHANNEL };

    try {
      const result = await this.equipmentManager.executeOrder(
        equipmentId,
        row.alias,
        revertValue,
        source,
      );
      if (!result.success) throw new Error(result.error ?? "dispatch failed");
      this.logger.info({ equipmentId, alias: row.alias, reason }, "Timed action reverted");
      this.eventBus.emit({
        type: "equipment.timed_action.reverted",
        equipmentId,
        equipmentName: name,
        orderAlias: row.alias,
        revertValue,
        reason,
      });
    } catch (err) {
      // Rule 4. The revert did not go out, and the engine has no way to know
      // whether sending it again would put the equipment back or act on it a
      // second time. Alarm, and stop: a human decides.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err, equipmentId, alias: row.alias }, "Timed action revert failed");
      this.eventBus.emit({
        type: "equipment.timed_action.failed",
        equipmentId,
        equipmentName: name,
        orderAlias: row.alias,
        revertValue,
        error: message,
      });
      this.eventBus.emit({
        type: "system.alarm.raised",
        alarmId: `timed-action-failed:${equipmentId}:${row.alias}`,
        level: "warning",
        source: ALARM_SOURCE,
        message: `Timed action could not revert ${name} (${row.alias}): ${message}`,
      });
    }
  }

  // ── Rule 2: somebody got there first ─────────────────────────

  private onDataChanged(equipmentId: string, alias: string, value: unknown): void {
    const row = this.stmts.getOne.get(equipmentId) as TimedActionRow | undefined;
    if (!row) return;
    // The mirror binding is the one that carries the order's own alias — the
    // same rule spec 141 confirms orders with. An equipment whose command has
    // no mirror (a gate's sequential impulse) simply never takes this path:
    // its state reading cannot say which of the two things the command did.
    if (alias !== row.alias) return;
    if (!valuesMatch(JSON.parse(row.revert_value), value)) return;
    this.disarm(equipmentId, "reverted by hand before the deadline");
  }
}
