import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../../test-utils";
import { PvHealthPanel } from "./PvHealthPanel";
import * as api from "../../api";
import type { PvHealthResponse } from "../../api";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getPvHealth: vi.fn(),
}));

const mockedGet = vi.mocked(api.getPvHealth);

/** A healthy, populated response the individual tests override. */
function response(over: Partial<PvHealthResponse> = {}): PvHealthResponse {
  const days = Array.from({ length: 40 }, (_, i) => ({
    day: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
    ratio: 3.8,
    hours: 6,
  }));
  return {
    active: true,
    days,
    normal: 3.8,
    latest: days[days.length - 1],
    alert: null,
    detection: { minDetectableLoss: 0.1, calendarDays: 6, qualifyingDays: 8, windowDays: 14 },
    ...over,
  };
}

async function renderPanel(data: PvHealthResponse) {
  mockedGet.mockResolvedValue(data);
  const view = render(<PvHealthPanel equipmentId="eq-pv" />);
  // The panel loads asynchronously; let the resolved promise flush.
  await new Promise((r) => setTimeout(r, 0));
  return view;
}

describe("PvHealthPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing at all without a declared array (FR6)", async () => {
    // The card used to show "waiting for clear midday hours" here — a promise
    // that can never come true, since nothing is collected without a
    // declaration.
    const { container } = await renderPanel(response({ active: false }));
    expect(container.firstChild).toBeNull();
  });

  it("says it is waiting while nothing has qualified yet", async () => {
    await renderPanel(response({ days: [], normal: null, latest: null, detection: null }));
    expect(await screen.findByText(/clear midday hours/i)).toBeTruthy();
  });

  it("says it has nothing recent to judge on when no day qualified in the window", async () => {
    // History exists, the fortnight was overcast: the card must not present a
    // weeks-old figure as current.
    await renderPanel(response({ detection: null }));
    expect(await screen.findByText(/nothing recent to judge on/i)).toBeTruthy();
  });

  it("shows the alert with its start date when one stands", async () => {
    await renderPanel(response({ alert: { since: "2026-08-22", deficit: 0.25 } }));
    expect(await screen.findByText(/25\s?%/)).toBeTruthy();
  });

  it("states the sensitivity honestly, never a per-panel figure", async () => {
    await renderPanel(response());
    expect(await screen.findByText(/8 clear days out of the last 14/i)).toBeTruthy();
    // The card names a size, never a panel: per-panel figures needed a panel
    // count nothing declares.
    expect(screen.getByText(/never which panel/i)).toBeTruthy();
  });

  it("renders the last clear day with its date, not as an undated figure", async () => {
    await renderPanel(
      response({ latest: { day: "2026-08-20", ratio: 3.6, hours: 6 } }),
    );
    // 3.6 / 3.8 ≈ 5 % below its usual level, dated.
    expect(await screen.findByText(/5\s?%/)).toBeTruthy();
  });

  it("renders nothing when the request ultimately fails", async () => {
    mockedGet.mockRejectedValue(new Error("network"));
    const { container } = render(<PvHealthPanel equipmentId="eq-pv" />);
    // Two retries at 1s/3s are configured; in tests the mock rejects instantly,
    // so allow the retry loop to exhaust.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });
});
