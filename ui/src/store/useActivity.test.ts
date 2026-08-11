import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ActivityItem } from "../types";

vi.mock("../api", () => ({ getActivity: vi.fn() }));

import { getActivity } from "../api";
import { useActivity } from "./useActivity";

const mockedGetActivity = vi.mocked(getActivity);

function item(id: string, zoneId: string | null): ActivityItem {
  return {
    id,
    timestamp: 1_700_000_000_000,
    category: "recipe",
    zoneId,
    message: { template: "recipe.started", params: { recipeName: "R" } },
  } as ActivityItem;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useActivity.loadForZone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedGetActivity.mockReset();
    useActivity.getState().reset();
  });
  afterEach(() => vi.useRealTimers());

  it("retries a transient failure instead of surfacing an error", async () => {
    mockedGetActivity
      .mockRejectedValueOnce(new Error("HTTP 429: Too Many Requests"))
      .mockResolvedValueOnce({ items: [item("a", "z1")] });

    const load = useActivity.getState().loadForZone("z1", []);
    await vi.advanceTimersByTimeAsync(1000);
    await load;

    expect(mockedGetActivity).toHaveBeenCalledTimes(2);
    expect(useActivity.getState().status).toBe("ready");
    expect(useActivity.getState().items).toHaveLength(1);
  });

  it("gives up after the retries are exhausted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedGetActivity.mockRejectedValue(new Error("boom"));

    const load = useActivity.getState().loadForZone("z1", []);
    await vi.advanceTimersByTimeAsync(5000);
    await load;

    expect(mockedGetActivity).toHaveBeenCalledTimes(3);
    expect(useActivity.getState().status).toBe("error");
  });

  it("ignores a superseded load that fails after a newer one succeeded", async () => {
    const slow = deferred<{ items: ActivityItem[] }>();
    const fast = deferred<{ items: ActivityItem[] }>();
    mockedGetActivity.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = useActivity.getState().loadForZone("z1", []);
    const second = useActivity.getState().loadForZone("z2", []);

    fast.resolve({ items: [item("b", "z2")] });
    await second;
    expect(useActivity.getState().status).toBe("ready");

    // The stale request for z1 fails late — it must not clobber the z2 result
    slow.reject(new Error("HTTP 429: Too Many Requests"));
    await vi.advanceTimersByTimeAsync(5000);
    await first;

    expect(useActivity.getState().status).toBe("ready");
    expect(useActivity.getState().zoneId).toBe("z2");
    expect(useActivity.getState().items.map((i) => i.id)).toEqual(["b"]);
  });
});
