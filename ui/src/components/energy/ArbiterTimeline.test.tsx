import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "../../test-utils";
import { ArbiterTimeline } from "./ArbiterTimeline";
import { useArbiter } from "../../store/useArbiter";
import * as api from "../../api";
import type { ArbiterQuarterState, ArbiterTimeline as ArbiterTimelineData } from "../../types";

// Issue #514 — the curve used to fetch once on mount and stay frozen while the
// live badge moved on. It must now refetch on the live window whenever the
// arbiter emits activity (useArbiter.timelineRev), throttled, and stay static
// while paging through history.
vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getArbiterTimeline: vi.fn(),
}));

const mockTimeline = api.getArbiterTimeline as unknown as ReturnType<typeof vi.fn>;

function timelineData(loadName = "Pompe"): ArbiterTimelineData {
  return {
    windowStartIso: "2026-08-15T00:00:00.000Z",
    windowEndIso: "2026-08-15T06:00:00.000Z",
    stepMin: 15,
    loads: [
      {
        equipmentId: "pump",
        name: loadName,
        quarters: new Array<ArbiterQuarterState>(24).fill("idle"),
      },
    ],
    surplus: [{ atIso: "2026-08-15T05:55:00.000Z", availableW: 500 }],
    journal: [],
  };
}

/** A promise whose resolution we control, to hold a refetch in flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Emulate a debounced arbiter refresh landing (WS burst → one timelineRev bump). */
function emitArbiterActivity(): void {
  useArbiter.setState((s) => ({ timelineRev: s.timelineRev + 1 }));
}

describe("ArbiterTimeline live refresh (#514)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTimeline.mockReset();
    mockTimeline.mockResolvedValue(timelineData());
    useArbiter.setState({ state: null, loading: false, timelineRev: 0 });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  async function tick(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("refetches the live window when the arbiter emits activity, after the throttle window", async () => {
    render(<ArbiterTimeline />);
    await tick(0); // flush the mount fetch
    expect(mockTimeline).toHaveBeenCalledTimes(1);

    await act(async () => emitArbiterActivity());

    // Throttled: no refetch before the window elapses.
    await tick(19_000);
    expect(mockTimeline).toHaveBeenCalledTimes(1);

    // After the throttle window, exactly one live refetch on the live page.
    await tick(2_000);
    expect(mockTimeline).toHaveBeenCalledTimes(2);
    expect(mockTimeline).toHaveBeenLastCalledWith(6, 0, 15);
  });

  it("collapses a burst of arbiter events into a single refetch", async () => {
    render(<ArbiterTimeline />);
    await tick(0);
    expect(mockTimeline).toHaveBeenCalledTimes(1);

    // Five bumps a second apart — all inside one throttle window.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => emitArbiterActivity());
      await tick(1_000);
    }
    await tick(20_000);

    // Mount + a single collapsed refetch, not one per event.
    expect(mockTimeline).toHaveBeenCalledTimes(2);
  });

  it("does not refetch on arbiter activity while paging through history", async () => {
    const { getAllByRole } = render(<ArbiterTimeline />);
    await tick(0);
    expect(mockTimeline).toHaveBeenCalledTimes(1);

    // Page one window back (ChevronLeft is the first button) → authoritative
    // refetch at offset 1.
    await act(async () => {
      getAllByRole("button")[0].click();
    });
    await tick(0);
    expect(mockTimeline).toHaveBeenCalledTimes(2);
    expect(mockTimeline).toHaveBeenLastCalledWith(6, 1, 15);

    // Arbiter activity must NOT refresh a historical page.
    await act(async () => emitArbiterActivity());
    await tick(30_000);
    expect(mockTimeline).toHaveBeenCalledTimes(2);
  });

  it("does not clobber a historical page when a live refetch resolves after paging (#514 #1)", async () => {
    const liveFetch = deferred<ArbiterTimelineData>();
    let call = 0;
    mockTimeline.mockReset();
    mockTimeline.mockImplementation((_h: number, offset: number) => {
      call += 1;
      if (offset === 1) return Promise.resolve(timelineData("HISTORY")); // page-back load
      if (call === 1) return Promise.resolve(timelineData("MOUNT")); // mount
      return liveFetch.promise; // the live refetch — held in flight
    });

    const { getAllByRole } = render(<ArbiterTimeline />);
    await tick(0);
    expect(screen.getByText("MOUNT")).toBeTruthy();

    // Kick a live refetch and let its timer fire (offset 0, now pending).
    await act(async () => emitArbiterActivity());
    await tick(20_000);

    // Page back to history before the live refetch resolves.
    await act(async () => {
      getAllByRole("button")[0].click();
    });
    await tick(0);
    expect(screen.getByText("HISTORY")).toBeTruthy();

    // The in-flight live (offset 0) response now resolves — it must be dropped,
    // not painted over the historical window the user is looking at.
    await act(async () => {
      liveFetch.resolve(timelineData("LIVE"));
      await Promise.resolve();
    });
    expect(screen.getByText("HISTORY")).toBeTruthy();
    expect(screen.queryByText("LIVE")).toBeNull();
  });
});
