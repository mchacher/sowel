import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { ApplianceCycleThresholds, EngineEvent } from "../shared/types.js";
import {
  APPLIANCE_CYCLE_DEFAULTS,
  ApplianceCycleTracker,
  coldCycleState,
  nextCycleState,
  validateCycleThresholds,
  type ApplianceCycleState,
} from "./appliance-cycle-tracker.js";
import { CYCLE_2026_11_11, CYCLE_2026_11_13 } from "./__fixtures__/appliance-cycles.js";

const logger = createLogger("silent").logger;
const D = APPLIANCE_CYCLE_DEFAULTS;
const EQ = "washer";

describe("nextCycleState", () => {
  it("off → ready on an idle display", () => {
    expect(nextCycleState("off", 6, D).state).toBe("ready");
  });

  it("ready → running above startW", () => {
    expect(nextCycleState("ready", 21, D).state).toBe("running");
  });

  it("off → running straight to heating", () => {
    expect(nextCycleState("off", 1900, D).state).toBe("running");
  });

  it("running below endW arms the end delay, above it cancels", () => {
    expect(nextCycleState("running", 6, D)).toMatchObject({
      state: "running",
      armEndDelay: true,
    });
    expect(nextCycleState("running", 90, D)).toMatchObject({
      state: "running",
      cancelEndDelay: true,
    });
  });

  it("finished → off at 0 W, stays finished at 5 W", () => {
    expect(nextCycleState("finished", 0, D).state).toBe("off");
    expect(nextCycleState("finished", 5, D).state).toBe("finished");
  });

  it("running → off at 0 W mid-cycle, without finished", () => {
    expect(nextCycleState("running", 0, D, false)).toMatchObject({
      state: "off",
      finishedFirst: false,
    });
  });

  it("running → finished → off when switched off during the end delay", () => {
    expect(nextCycleState("running", 0, D, true)).toMatchObject({
      state: "off",
      finishedFirst: true,
    });
  });

  it("custom thresholds: 30 W does not start a cycle with startW 50", () => {
    expect(nextCycleState("ready", 30, { startW: 50, endW: 20, endDelayS: 60 }).state).toBe(
      "ready",
    );
  });
});

describe("coldCycleState", () => {
  it("never starts as finished", () => {
    expect(coldCycleState(5, D)).toBe("ready");
    expect(coldCycleState(0, D)).toBe("off");
    expect(coldCycleState(1900, D)).toBe("running");
  });
});

describe("validateCycleThresholds", () => {
  const ok: ApplianceCycleThresholds = { startW: 15, endW: 10, endDelayS: 300 };
  it("accepts the defaults", () => {
    expect(validateCycleThresholds(ok)).toBeNull();
  });
  it.each([
    [{ ...ok, endW: 20 }, "endW"],
    [{ ...ok, endW: 0.5 }, "endW"],
    [{ ...ok, endDelayS: 10 }, "endDelayS"],
    [{ ...ok, endDelayS: 90.5 }, "endDelayS"],
    [{ ...ok, startW: 6000 }, "startW"],
  ])("refuses %o, naming %s", (t, field) => {
    expect(validateCycleThresholds(t)).toContain(field);
  });
});

describe("ApplianceCycleTracker", () => {
  let bus: EventBus;
  let events: { value: unknown; previous: unknown }[];
  let thresholds: ApplianceCycleThresholds | null;
  let tracker: ApplianceCycleTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus(logger);
    events = [];
    thresholds = null;
    bus.on((e: EngineEvent) => {
      if (e.type === "equipment.data.changed" && e.alias === "state") {
        events.push({ value: e.value, previous: e.previous });
      }
    });
    tracker = new ApplianceCycleTracker({
      eventBus: bus,
      logger,
      getThresholds: () => thresholds,
      now: () => Date.now(),
    });
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  /** Feed [seconds, watts] samples, advancing the clock between them. */
  function replay(samples: ReadonlyArray<readonly [number, number]>, tailS = 600): void {
    let at = 0;
    for (const [t, w] of samples) {
      vi.advanceTimersByTime((t - at) * 1000);
      at = t;
      tracker.onPower(EQ, w);
    }
    vi.advanceTimersByTime(tailS * 1000);
  }

  const states = (): ApplianceCycleState[] => events.map((e) => e.value as ApplianceCycleState);

  it("the first sample is a cold start, not a transition", () => {
    tracker.onPower(EQ, 6);
    expect(events).toEqual([]);
    expect(tracker.getState(EQ, null)).toBe("ready");
  });

  it("getState cold-starts from the power passed, and null without one", () => {
    expect(tracker.getState(EQ, null)).toBeNull();
    expect(tracker.getState(EQ, 1900)).toBe("running");
  });

  it("a dip shorter than the delay keeps the cycle running, no event", () => {
    tracker.onPower(EQ, 6);
    tracker.onPower(EQ, 90);
    events.length = 0;
    tracker.onPower(EQ, 6);
    vi.advanceTimersByTime(299_000);
    tracker.onPower(EQ, 90);
    vi.advanceTimersByTime(600_000);
    expect(events).toEqual([]);
    expect(tracker.getState(EQ, null)).toBe("running");
  });

  it("ends the cycle after the delay even when the plug stops reporting", () => {
    tracker.onPower(EQ, 6);
    tracker.onPower(EQ, 90);
    tracker.onPower(EQ, 5);
    vi.advanceTimersByTime(299_000);
    expect(tracker.getState(EQ, null)).toBe("running");
    vi.advanceTimersByTime(1_000);
    expect(events.at(-1)).toEqual({ value: "finished", previous: "running" });
    expect(states().filter((s) => s === "finished")).toHaveLength(1);
  });

  it("finished stays finished at 5 W, then off at 0 W", () => {
    tracker.onPower(EQ, 6);
    tracker.onPower(EQ, 90);
    tracker.onPower(EQ, 5);
    vi.advanceTimersByTime(300_000);
    tracker.onPower(EQ, 5);
    tracker.onPower(EQ, 0);
    expect(states()).toEqual(["running", "finished", "off"]);
  });

  it("replays the 2026-11-13 cycle: one run, announced, then off", () => {
    replay(CYCLE_2026_11_13);
    expect(states()).toEqual(["running", "finished", "off"]);
  });

  it("replays the 2026-11-11 cycle: the 100 s dip does not split it", () => {
    replay(CYCLE_2026_11_11);
    expect(states().filter((s) => s === "running")).toHaveLength(1);
    expect(states()).toContain("finished");
    expect(states().at(-1)).toBe("off");
  });

  it("new thresholds apply at once to the current power", () => {
    tracker.onPower(EQ, 6);
    tracker.onPower(EQ, 90);
    tracker.onPower(EQ, 12);
    thresholds = { startW: 30, endW: 15, endDelayS: 60 };
    tracker.reevaluate(EQ, 12);
    vi.advanceTimersByTime(60_000);
    expect(events.at(-1)?.value).toBe("finished");
  });

  it("a cold start in the tail of a cycle still ends it", () => {
    thresholds = { startW: 3, endW: 2, endDelayS: 60 };
    tracker.onPower(EQ, 4); // running (> startW)
    tracker.onPower(EQ, 1.5); // tail
    vi.advanceTimersByTime(60_000);
    expect(states()).toEqual(["finished"]);
  });

  it("forget drops the state and its timer", () => {
    tracker.onPower(EQ, 6);
    tracker.onPower(EQ, 90);
    tracker.onPower(EQ, 5);
    tracker.forget(EQ);
    vi.advanceTimersByTime(600_000);
    expect(states()).toEqual(["running"]);
    expect(tracker.getState(EQ, null)).toBeNull();
  });

  it("destroy clears an armed timer: no late event", () => {
    tracker.onPower(EQ, 6);
    tracker.onPower(EQ, 90);
    tracker.onPower(EQ, 5);
    tracker.destroy();
    vi.advanceTimersByTime(600_000);
    expect(states()).toEqual(["running"]);
  });
});
