/**
 * Appliance cycle tracker (spec 213) — the run state of an `appliance` read on
 * its measured power, for a machine no integration reports a state for (a
 * washing machine behind a metering plug).
 *
 * off ──P ≥ 1 W──▶ ready ──P > startW──▶ running ──P < endW for endDelayS──▶ finished
 *  ▲                                        │                                  │
 *  └──────────────────── P < 1 W, from any state ◀─────────────────────────────┘
 *
 * `finished` is kept apart from `ready` so that "the cycle is over" fires once,
 * at the end, and not when the machine is switched on to be loaded. The end
 * delay is a timer started on the first sample below `endW`: a plug that stops
 * reporting while the power is flat still ends the cycle.
 *
 * A washing machine switches itself off 3 to 5 min after its cycle, sometimes
 * before the end delay runs out (160 s on a recorded cycle). Switched off while
 * the end delay runs, the machine therefore goes through `finished` on its way
 * to `off`, so every completed cycle is announced. Switched off mid-cycle (no
 * delay running), it goes straight to `off`.
 *
 * Nothing is persisted. After a restart the state is rebuilt from the current
 * power and never comes back as `finished`: the end of a cycle that straddles a
 * restart can be missed, never announced twice.
 */

import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { ApplianceCycleThresholds } from "../shared/types.js";

export type ApplianceCycleState = "off" | "ready" | "running" | "finished";

export const APPLIANCE_CYCLE_STATES: readonly ApplianceCycleState[] = [
  "off",
  "ready",
  "running",
  "finished",
];

export const APPLIANCE_CYCLE_DEFAULTS: ApplianceCycleThresholds = {
  startW: 15,
  endW: 10,
  endDelayS: 300,
};

/**
 * Id prefix of the virtual `state` binding. Unlike the gate and cover virtual
 * bindings, this one is historized and listed by the history API.
 */
export const APPLIANCE_STATE_BINDING_PREFIX = "virtual:appliance_state:";

/** Below this the machine is switched off (a plug reads 0 W, an idle display ~6 W). */
export const APPLIANCE_OFF_W = 1;

export interface CycleStep {
  state: ApplianceCycleState;
  /** Pass through `finished` before `state` (switched off during the end delay). */
  finishedFirst: boolean;
  /** Start the end delay (running, first sample below `endW`). */
  armEndDelay: boolean;
  /** Drop a running end delay (the power came back, or the state left `running`). */
  cancelEndDelay: boolean;
}

/**
 * The FR2 table: where one power sample takes a state. Pure — the end delay
 * itself (`running → finished`) is the caller's timer; `endDelayRunning` says
 * whether it is armed.
 */
export function nextCycleState(
  state: ApplianceCycleState,
  power: number,
  thresholds: ApplianceCycleThresholds,
  endDelayRunning = false,
): CycleStep {
  const step = (
    next: ApplianceCycleState,
    armEndDelay: boolean,
    cancelEndDelay: boolean,
    finishedFirst = false,
  ): CycleStep => ({ state: next, finishedFirst, armEndDelay, cancelEndDelay });

  if (power < APPLIANCE_OFF_W) {
    return step("off", false, true, state === "running" && endDelayRunning);
  }
  if (state === "running") {
    return power < thresholds.endW ? step("running", true, false) : step("running", false, true);
  }
  if (power > thresholds.startW) return step("running", false, true);
  return step(state === "off" ? "ready" : state, false, false);
}

/** The state a power reading implies with no history (boot, first sample). */
export function coldCycleState(
  power: number,
  thresholds: ApplianceCycleThresholds,
): ApplianceCycleState {
  if (power < APPLIANCE_OFF_W) return "off";
  if (power > thresholds.startW) return "running";
  return "ready";
}

/** Thresholds with the defaults filled in for an absent configuration. */
export function resolveCycleThresholds(
  configured: ApplianceCycleThresholds | null | undefined,
): ApplianceCycleThresholds {
  return configured ?? APPLIANCE_CYCLE_DEFAULTS;
}

/**
 * Why a threshold set is refused, or `null` when it is valid (FR3.2):
 * `OFF_W < endW ≤ startW ≤ 5000`, `30 ≤ endDelayS ≤ 3600`, an integer delay.
 */
export function validateCycleThresholds(t: ApplianceCycleThresholds): string | null {
  const finite = [t.startW, t.endW, t.endDelayS].every(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  if (!finite) return "applianceCycle: startW, endW and endDelayS must be numbers";
  if (t.endW <= APPLIANCE_OFF_W) return `applianceCycle.endW must be above ${APPLIANCE_OFF_W} W`;
  if (t.endW > t.startW) return "applianceCycle.endW must not exceed startW";
  if (t.startW > 5000) return "applianceCycle.startW must not exceed 5000 W";
  if (!Number.isInteger(t.endDelayS) || t.endDelayS < 30 || t.endDelayS > 3600) {
    return "applianceCycle.endDelayS must be a whole number of seconds between 30 and 3600";
  }
  return null;
}

interface TrackedAppliance {
  state: ApplianceCycleState;
  /** Epoch ms of the last transition (cold start included). */
  since: number;
  /** Epoch ms the current cycle started, for the end log. */
  runningSince: number | null;
  endTimer: ReturnType<typeof setTimeout> | null;
}

export interface ApplianceCycleTrackerDeps {
  eventBus: EventBus;
  logger: Logger;
  /** The equipment's configured thresholds; defaults applied by the tracker. */
  getThresholds: (equipmentId: string) => ApplianceCycleThresholds | null | undefined;
  now?: () => number;
}

export class ApplianceCycleTracker {
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly getThresholds: ApplianceCycleTrackerDeps["getThresholds"];
  private readonly now: () => number;
  private readonly tracked = new Map<string, TrackedAppliance>();

  constructor(deps: ApplianceCycleTrackerDeps) {
    this.eventBus = deps.eventBus;
    this.logger = deps.logger.child({ module: "appliance-cycle-tracker" });
    this.getThresholds = deps.getThresholds;
    this.now = deps.now ?? Date.now;
  }

  /**
   * The current state, starting from `power` when the equipment is not tracked
   * yet. `null` when there is no power reading to start from.
   */
  getState(equipmentId: string, power: number | null): ApplianceCycleState | null {
    const t = this.tracked.get(equipmentId);
    if (t) return t.state;
    if (power === null) return null;
    return this.coldStart(equipmentId, power).state;
  }

  /** Epoch ms of the last transition, or `null` when not tracked. */
  getSince(equipmentId: string): number | null {
    return this.tracked.get(equipmentId)?.since ?? null;
  }

  /** A new power sample. Never throws. */
  onPower(equipmentId: string, power: number): void {
    try {
      const t = this.tracked.get(equipmentId);
      if (!t) {
        // First sample: the cold state is the starting point, not a transition.
        this.coldStart(equipmentId, power);
        return;
      }
      this.apply(equipmentId, t, power);
    } catch (err) {
      this.logger.error({ err, equipmentId }, "Appliance cycle evaluation failed");
    }
  }

  /** The thresholds changed: apply them to the current power at once (FR3.5). */
  reevaluate(equipmentId: string, power: number | null): void {
    if (power === null) return;
    const t = this.tracked.get(equipmentId);
    if (!t) return;
    try {
      this.clearTimer(t);
      this.apply(equipmentId, t, power);
    } catch (err) {
      this.logger.error({ err, equipmentId }, "Appliance cycle re-evaluation failed");
    }
  }

  /** Stop tracking (type change, power unbound, a bound state, removal). */
  forget(equipmentId: string): void {
    const t = this.tracked.get(equipmentId);
    if (!t) return;
    this.clearTimer(t);
    this.tracked.delete(equipmentId);
  }

  destroy(): void {
    for (const t of this.tracked.values()) this.clearTimer(t);
    this.tracked.clear();
  }

  private coldStart(equipmentId: string, power: number): TrackedAppliance {
    const thresholds = resolveCycleThresholds(this.getThresholds(equipmentId));
    const state = coldCycleState(power, thresholds);
    const now = this.now();
    const t: TrackedAppliance = {
      state,
      since: now,
      runningSince: state === "running" ? now : null,
      endTimer: null,
    };
    this.tracked.set(equipmentId, t);
    // A cold start inside the tail of a cycle still has to end it.
    if (state === "running" && power < thresholds.endW) this.armTimer(equipmentId, t, thresholds);
    return t;
  }

  private apply(equipmentId: string, t: TrackedAppliance, power: number): void {
    const thresholds = resolveCycleThresholds(this.getThresholds(equipmentId));
    const step = nextCycleState(t.state, power, thresholds, t.endTimer !== null);
    if (step.cancelEndDelay) this.clearTimer(t);
    if (step.armEndDelay && !t.endTimer) this.armTimer(equipmentId, t, thresholds);
    if (step.finishedFirst) this.transition(equipmentId, t, "finished");
    if (step.state !== t.state) this.transition(equipmentId, t, step.state);
  }

  private armTimer(
    equipmentId: string,
    t: TrackedAppliance,
    thresholds: ApplianceCycleThresholds,
  ): void {
    t.endTimer = setTimeout(() => {
      t.endTimer = null;
      try {
        if (t.state === "running" && this.tracked.get(equipmentId) === t) {
          this.transition(equipmentId, t, "finished");
        }
      } catch (err) {
        this.logger.error({ err, equipmentId }, "Appliance cycle end failed");
      }
    }, thresholds.endDelayS * 1000);
    t.endTimer.unref?.();
  }

  private clearTimer(t: TrackedAppliance): void {
    if (t.endTimer) {
      clearTimeout(t.endTimer);
      t.endTimer = null;
    }
  }

  private transition(equipmentId: string, t: TrackedAppliance, next: ApplianceCycleState): void {
    const previous = t.state;
    const now = this.now();
    if (next === "finished" && t.runningSince !== null) {
      this.logger.info(
        { equipmentId, cycleMinutes: Math.round((now - t.runningSince) / 60_000) },
        "Appliance cycle finished",
      );
    } else {
      this.logger.debug({ equipmentId, from: previous, to: next }, "Appliance cycle state changed");
    }
    t.state = next;
    t.since = now;
    t.runningSince = next === "running" ? now : null;
    this.eventBus.emit({
      type: "equipment.data.changed",
      equipmentId,
      alias: "state",
      value: next,
      previous,
    });
  }
}
