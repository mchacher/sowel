import { describe, it, expect } from "vitest";
import { ReadingCadenceTracker, SAMPLE_COUNT, MIN_SAMPLES } from "./reading-cadence.js";

// Spec 175 — the estimator behind the per-source freshness budget. Everything
// here is about what it answers BEFORE it knows enough, and about the outage
// case, which is the reason the statistic is a median.

describe("ReadingCadenceTracker (spec 175)", () => {
  const at = (s: number) => 1_700_000_000_000 + s * 1000;

  it("reports the interval of a steady source", () => {
    const t = new ReadingCadenceTracker();
    for (let i = 0; i <= 5; i++) t.record("dd1", at(i));

    expect(t.observedIntervalMs("dd1")).toBe(1000);
  });

  it("answers nothing before it has enough intervals", () => {
    const t = new ReadingCadenceTracker();
    // Three arrivals is two intervals, one short of MIN_SAMPLES.
    t.record("dd1", at(0));
    t.record("dd1", at(1));
    t.record("dd1", at(2));

    expect(MIN_SAMPLES).toBe(3);
    expect(t.observedIntervalMs("dd1")).toBeNull();

    t.record("dd1", at(3));
    expect(t.observedIntervalMs("dd1")).toBe(1000);
  });

  it("answers nothing for a row it has never seen", () => {
    expect(new ReadingCadenceTracker().observedIntervalMs("unknown")).toBeNull();
  });

  it("is not moved by an irregular gap among one-second samples", () => {
    // The reason this is a median. A mean over these eleven arrivals would
    // report about four seconds for a source that reports every second.
    const t = new ReadingCadenceTracker();
    for (let i = 0; i <= 9; i++) t.record("dd1", at(i));
    t.record("dd1", at(9 + 30));

    expect(t.observedIntervalMs("dd1")).toBe(1000);
  });

  it("starts a fresh series after a silence longer than any budget", () => {
    // Six hours is not irregularity, it is a discontinuity: yesterday's ten
    // one-second samples say nothing about what this source is doing now, and
    // after a database restore they may not even belong to it. The estimator
    // answers "no information" until it has watched again.
    const t = new ReadingCadenceTracker();
    for (let i = 0; i <= 9; i++) t.record("dd1", at(i));
    t.record("dd1", at(9 + 6 * 3600));

    expect(t.observedIntervalMs("dd1")).toBeNull();

    // And it relearns from the arrivals that follow, at whatever the source is
    // doing now: three intervals, which for a 1 Hz source is three seconds.
    const base = 9 + 6 * 3600;
    for (let i = 1; i <= 3; i++) t.record("dd1", at(base + i));
    expect(t.observedIntervalMs("dd1")).toBe(1000);
  });

  it("follows a source that genuinely changes cadence", () => {
    // Not the outage case: the new cadence holds, so once it is the majority
    // of the ring the median has to follow it.
    const t = new ReadingCadenceTracker();
    for (let i = 0; i <= 5; i++) t.record("dd1", at(i));
    let clock = at(5);
    for (let i = 0; i < 8; i++) {
      clock += 300_000;
      t.record("dd1", clock);
    }

    expect(t.observedIntervalMs("dd1")).toBe(300_000);
  });

  it("keeps at most SAMPLE_COUNT intervals", () => {
    const t = new ReadingCadenceTracker();
    let clock = at(0);
    t.record("dd1", clock);
    for (let i = 0; i < SAMPLE_COUNT + 5; i++) {
      clock += 2000;
      t.record("dd1", clock);
    }
    // Every kept interval is 2 s, so the median is 2 s whatever the ring holds;
    // the eviction is proven by the old 1 s samples no longer being there.
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      clock += 1000;
      t.record("dd1", clock);
    }

    expect(t.observedIntervalMs("dd1")).toBe(1000);
  });

  it("ignores a non-monotonic arrival rather than storing a negative interval", () => {
    const t = new ReadingCadenceTracker();
    t.record("dd1", at(10));
    t.record("dd1", at(5)); // clock step backwards
    t.record("dd1", at(11));
    t.record("dd1", at(12));
    t.record("dd1", at(13));

    // The backwards step contributed nothing; the intervals that follow it are
    // the ones measured. Never a negative or zero cadence.
    const observed = t.observedIntervalMs("dd1");
    expect(observed).not.toBeNull();
    expect(observed!).toBeGreaterThan(0);
  });

  it("keeps rows independent", () => {
    const t = new ReadingCadenceTracker();
    for (let i = 0; i <= 5; i++) t.record("fast", at(i));
    for (let i = 0; i <= 5; i++) t.record("slow", at(i * 300));

    expect(t.observedIntervalMs("fast")).toBe(1000);
    expect(t.observedIntervalMs("slow")).toBe(300_000);
  });

  it("forgets a row entirely", () => {
    const t = new ReadingCadenceTracker();
    for (let i = 0; i <= 5; i++) t.record("dd1", at(i));
    t.forget("dd1");

    expect(t.observedIntervalMs("dd1")).toBeNull();
    expect(t.size()).toBe(0);
  });
});
