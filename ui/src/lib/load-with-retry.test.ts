import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadWithRetry } from "./load-with-retry";

const always = () => true;

describe("loadWithRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the value without retrying when the load succeeds", async () => {
    const load = vi.fn().mockResolvedValue("data");

    const outcome = await loadWithRetry(load, { retryDelaysMs: [700, 2500], isCurrent: always });

    expect(outcome).toEqual({ status: "ok", value: "data" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and succeeds", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 429: Too Many Requests"))
      .mockResolvedValueOnce("data");

    const pending = loadWithRetry(load, { retryDelaysMs: [700, 2500], isCurrent: always });
    await vi.advanceTimersByTimeAsync(700);

    expect(await pending).toEqual({ status: "ok", value: "data" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fails once the retries are exhausted", async () => {
    const error = new Error("boom");
    const load = vi.fn().mockRejectedValue(error);

    const pending = loadWithRetry(load, { retryDelaysMs: [700, 2500], isCurrent: always });
    await vi.advanceTimersByTimeAsync(3200);

    expect(await pending).toEqual({ status: "failed", error });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("reports a late success as superseded", async () => {
    let current = true;
    const load = vi.fn().mockResolvedValue("stale");

    const pending = loadWithRetry(load, { retryDelaysMs: [700], isCurrent: () => current });
    current = false;

    expect(await pending).toEqual({ status: "superseded" });
  });

  it("stops retrying — and stays silent — once superseded", async () => {
    let current = true;
    const load = vi.fn().mockRejectedValue(new Error("boom"));

    const pending = loadWithRetry(load, { retryDelaysMs: [700, 2500], isCurrent: () => current });
    current = false;
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toEqual({ status: "superseded" });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
