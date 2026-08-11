import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { coalesceCalls } from "./coalesce-calls";

describe("coalesceCalls", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs the first call immediately", () => {
    const fn = vi.fn();
    coalesceCalls(fn, 1000)();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst into one leading and one trailing call", () => {
    const fn = vi.fn();
    const coalesced = coalesceCalls(fn, 1000);

    // 30 events in the same frame (one WebSocket batch)
    for (let i = 0; i < 30; i++) coalesced();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // No further call once the burst is drained
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not delay a call made after the window closed", () => {
    const fn = vi.fn();
    const coalesced = coalesceCalls(fn, 1000);

    coalesced();
    vi.advanceTimersByTime(1000);
    coalesced();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("caps a sustained stream at roughly one call per window", () => {
    const fn = vi.fn();
    const coalesced = coalesceCalls(fn, 1000);

    // One event every 100 ms for 5 s = 50 events
    for (let i = 0; i < 50; i++) {
      coalesced();
      vi.advanceTimersByTime(100);
    }
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
