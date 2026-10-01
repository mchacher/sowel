import { describe, it, expect, vi, afterEach } from "vitest";
import { GuessingBudget } from "./guessing.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("the anti-guessing budget (R6)", () => {
  it("answers the first ten failures at once, then holds 1, 2, 4, 8 s, never past 10 s", () => {
    const budget = new GuessingBudget();
    const delays = Array.from({ length: 16 }, (_, i) => budget.delayFor(i + 1));
    expect(delays.slice(0, 10)).toEqual(Array(10).fill(0));
    expect(delays.slice(10, 14)).toEqual([1000, 2000, 4000, 8000]);
    expect(delays.slice(14)).toEqual([10_000, 10_000]);
  });

  it("holds the eleventh failure one second", async () => {
    vi.useFakeTimers();
    let now = 0;
    const budget = new GuessingBudget({ now: () => now });
    for (let i = 0; i < 10; i++) await budget.fail();
    let settled = false;
    const p = budget.fail().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
    now += 1;
  });

  it("alerts the owner once past 25 failures in the window, and clears when it empties", async () => {
    vi.useFakeTimers();
    let now = 0;
    const onAlert = vi.fn();
    const onAlertCleared = vi.fn();
    const budget = new GuessingBudget({ now: () => now, onAlert, onAlertCleared, maxHeld: 1000 });
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 30; i++) pending.push(budget.fail());
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.all(pending);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledWith(26);
    now += 11 * 60_000;
    expect(budget.count()).toBe(0);
    expect(onAlertCleared).toHaveBeenCalledTimes(1);
  });

  it("holds at most 32 answers at once; past that, a failure is answered at once with too_many", async () => {
    vi.useFakeTimers();
    const budget = new GuessingBudget({ now: () => 0 });
    const outcomes: Promise<string>[] = [];
    for (let i = 0; i < 100; i++) outcomes.push(budget.fail());
    // Ten free, then 32 held; the other 58 answered right away.
    await vi.advanceTimersByTimeAsync(0);
    expect(budget.held()).toBe(32);
    budget.releaseAll();
    const settled = await Promise.all(outcomes);
    expect(settled.filter((o) => o === "too_many")).toHaveLength(58);
    expect(settled.filter((o) => o === "held")).toHaveLength(42);
  });
});
