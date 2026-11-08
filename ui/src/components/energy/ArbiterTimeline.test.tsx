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

describe("#960 — the legend carries 'pilotage manuel'", () => {
  it("advertises the suspended state when the window shows it", async () => {
    const data = timelineData();
    data.loads[0].quarters[3] = "suspended";
    data.loads[0].quarters[4] = "unmanaged";
    mockTimeline.mockResolvedValue(data);
    render(<ArbiterTimeline />);
    await act(async () => {});
    expect(screen.getByText("Manual control")).toBeTruthy();
    expect(screen.getByText("Running (unmanaged)")).toBeTruthy();
  });
});

describe("spec 197 — the history reads as durations (FR-E5.5, E5.6)", () => {
  beforeEach(() => {
    mockTimeline.mockReset();
    useArbiter.setState({ state: null, loading: false, timelineRev: 0 });
  });

  it("lists only the states the window shows, plus « At rest »", async () => {
    const data = timelineData();
    data.loads[0].quarters.fill("pending", 10, 14);
    mockTimeline.mockResolvedValue(data);
    const { container } = render(<ArbiterTimeline />);
    await act(async () => {});
    const legend = [...container.querySelectorAll("[data-legend]")].map((el) =>
      el.getAttribute("data-legend"),
    );
    expect(legend).toEqual(["pending", "idle"]);
  });

  it("draws equal neighbours as one run, and keeps one target per quarter", async () => {
    const data = timelineData();
    data.loads[0].quarters.fill("granted", 8, 16);
    mockTimeline.mockResolvedValue(data);
    const { container } = render(<ArbiterTimeline />);
    await act(async () => {});
    const runs = [...container.querySelectorAll("[data-run]")].map((el) =>
      el.getAttribute("data-run"),
    );
    expect(runs).toEqual(["idle", "granted", "idle"]);
    expect(container.querySelectorAll("button[data-q]")).toHaveLength(24);
  });
});

describe("spec 197 — keyboard and focus (FR-E5.7)", () => {
  beforeEach(() => {
    mockTimeline.mockReset();
    useArbiter.setState({ state: null, loading: false, timelineRev: 0 });
  });

  it("makes each lane one tab stop and moves between quarters with the arrows", async () => {
    const data = timelineData("Chauffe-eau");
    data.loads[0].quarters[22] = "pending";
    mockTimeline.mockResolvedValue(data);
    const { container } = render(<ArbiterTimeline />);
    await act(async () => {});

    const lane = screen.getByRole("group", { name: "Chauffe-eau" });
    const stops = [...lane.querySelectorAll("button")].filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute("data-q")).toBe("23"); // the current quarter

    stops[0].focus();
    await act(async () => {
      stops[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("data-q")).toBe("22");
    expect(focused.tabIndex).toBe(0);
    expect(focused.getAttribute("aria-label")).toMatch(/^Chauffe-eau, \d{1,2}:30, waiting$/);
    // Focus shows the same readout as the mouse.
    expect(container.querySelector("[data-testid='arbiter-crosshair']")).toBeTruthy();
    expect(focused.className).toContain("focus-visible:outline");
  });
});

describe("spec 197 — the curve ends on the live reading (FR-E5.2, DV-03)", () => {
  beforeEach(() => {
    mockTimeline.mockReset();
  });

  it("draws the live end point on the live window only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T05:58:00.000Z"));
    useArbiter.setState({
      state: { availableSurplusW: -4800 } as never,
      loading: false,
      timelineRev: 0,
    });
    mockTimeline.mockResolvedValue(timelineData());
    const { container, getAllByRole } = render(<ArbiterTimeline />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.querySelector("[data-testid='arbiter-live-dot']")).toBeTruthy();
    expect(screen.getByText("4.8 kW")).toBeTruthy();
    // The scale reaches the live import, which no sample did.
    expect(screen.getByText(/kW import$/).textContent).toMatch(/^4\.\d\skW import$/);

    await act(async () => {
      getAllByRole("button")[0].click(); // page back
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.querySelector("[data-testid='arbiter-live-dot']")).toBeNull();
    vi.useRealTimers();
  });
});

// #1129 — on a phone « Chauffe-eau » broke at its hyphen: the name gave way to
// the decision text. The name now holds its line and the decision truncates
// (measured in Chromium at 360 and 390 px).
describe("#1129 — a journal row keeps the load's name on one line", () => {
  it("does not let the name wrap, and lets the decision give way", async () => {
    mockTimeline.mockResolvedValue({
      ...timelineData("Chauffe-eau"),
      journal: [
        {
          atIso: "2026-08-15T05:30:00.000Z",
          kind: "revoked",
          equipmentName: "Chauffe-eau",
          reason: "surplus-deficit",
        },
      ],
    });
    render(<ArbiterTimeline />);
    await act(async () => {});
    const name = screen
      .getAllByText("Chauffe-eau")
      .find((el) => el.tagName === "SPAN" && el.className.includes("font-semibold"))!;
    expect(name.className).toMatch(/(^|\s)whitespace-nowrap(\s|$)/);
    expect(name.className).toMatch(/(^|\s)flex-none(\s|$)/);
    expect((name.nextElementSibling as HTMLElement).className).toMatch(/(^|\s)min-w-0(\s|$)/);
  });
});
