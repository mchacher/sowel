import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "../test-utils";
import { SETPOINT_ERROR_MS, useSetpointCommit } from "./useSetpointCommit";

// Spec 196, slice 8a — one order after the last tap, nothing lost, nothing
// snapping back while the device is silent.

const DELAY = 600;

function setup(initial: number | null, onCommit = vi.fn().mockResolvedValue(undefined), settleMs?: number) {
  const hook = renderHook(
    ({ value }: { value: number | null }) => useSetpointCommit({ value, onCommit, debounceMs: DELAY, settleMs }),
    { initialProps: { value: initial } },
  );
  return { ...hook, onCommit };
}

/** Let the commit's promise chain settle under fake timers. */
async function flushPromises() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe("useSetpointCommit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one order with the last value after four quick taps", async () => {
    const { result, onCommit } = setup(20);
    for (const v of [20.5, 21, 21.5, 22]) {
      act(() => result.current.request(v));
      act(() => vi.advanceTimersByTime(DELAY - 100));
    }
    expect(result.current.shown).toBe(22);
    expect(result.current.pending).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    await flushPromises();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(22);
  });

  it("loses no tap made while an order is in flight", async () => {
    let release!: () => void;
    const onCommit = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const { result } = setup(20, onCommit);
    act(() => result.current.request(20.5));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    expect(onCommit).toHaveBeenCalledWith(20.5);

    // Two more taps while the first order is still out.
    act(() => result.current.request(21));
    act(() => result.current.request(21.5));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(result.current.shown).toBe(21.5);

    release();
    await flushPromises();
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith(21.5);
  });

  it("sends the pending value when it unmounts during the delay", async () => {
    const { result, unmount, onCommit } = setup(20);
    act(() => result.current.request(20.5));
    act(() => result.current.request(21));
    unmount();
    await flushPromises();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(21);
    // And the timer does not send it a second time.
    vi.advanceTimersByTime(DELAY * 2);
    await flushPromises();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("sends nothing on unmount when nothing is waiting", async () => {
    const { unmount, onCommit } = setup(20);
    unmount();
    await flushPromises();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("reverts to the device's value and raises an error when the order fails", async () => {
    const { result } = setup(20, vi.fn().mockRejectedValue(new Error("429")));
    act(() => result.current.request(20.5));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    expect(result.current.shown).toBe(20);
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe(true);
    act(() => vi.advanceTimersByTime(SETPOINT_ERROR_MS));
    expect(result.current.error).toBe(false);
  });

  it("holds the requested value while a cloud device is silent, then takes its report", async () => {
    const { result, rerender } = setup(20);
    act(() => result.current.request(21));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    // Seconds later the device has not polled yet: no snap back to 20.
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.shown).toBe(21);
    expect(result.current.pending).toBe(true);
    // Its report confirms the value.
    rerender({ value: 21 });
    expect(result.current.shown).toBe(21);
    expect(result.current.pending).toBe(false);
  });

  it("shows what the device reports when it took another value", async () => {
    const { result, rerender } = setup(20);
    act(() => result.current.request(25));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    rerender({ value: 24 });
    expect(result.current.shown).toBe(24);
    expect(result.current.pending).toBe(false);
  });

  it("falls back to the device's value after the settle timeout", async () => {
    const { result } = setup(20, undefined, 90_000);
    act(() => result.current.request(21));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    act(() => vi.advanceTimersByTime(90_000));
    expect(result.current.shown).toBe(20);
    expect(result.current.pending).toBe(false);
  });

  it("sends nothing when the taps come back to the device's value", async () => {
    const { result, onCommit } = setup(20);
    act(() => result.current.request(20.5));
    act(() => result.current.request(20));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it("sends nothing on unmount when the waiting value is back to the device's", async () => {
    const { result, unmount, onCommit } = setup(20);
    act(() => result.current.request(20.5));
    act(() => result.current.request(20));
    unmount();
    await flushPromises();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("with a tolerance (a zone's average), holds the value until a report reaches it", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }: { value: number | null }) =>
        useSetpointCommit({ value, onCommit, debounceMs: DELAY, settleTolerance: 0.25 }),
      { initialProps: { value: 20 as number | null } },
    );
    act(() => result.current.request(22));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    // One thermostat of two reported: the average is half way, the value stays.
    rerender({ value: 21 });
    expect(result.current.shown).toBe(22);
    expect(result.current.pending).toBe(true);
    // The second one: the average reaches it.
    rerender({ value: 22 });
    expect(result.current.shown).toBe(22);
    expect(result.current.pending).toBe(false);
  });

  it("with a tolerance, still lets go at the timeout", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }: { value: number | null }) =>
        useSetpointCommit({ value, onCommit, debounceMs: DELAY, settleMs: 90_000, settleTolerance: 0.25 }),
      { initialProps: { value: 20 as number | null } },
    );
    act(() => result.current.request(22));
    act(() => vi.advanceTimersByTime(DELAY));
    await flushPromises();
    rerender({ value: 21 });
    act(() => vi.advanceTimersByTime(90_000));
    expect(result.current.shown).toBe(21);
    expect(result.current.pending).toBe(false);
  });
});
