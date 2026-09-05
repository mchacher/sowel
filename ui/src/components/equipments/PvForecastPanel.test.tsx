import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "../../test-utils";
import { PvForecastPanel } from "./PvForecastPanel";
import { useAuth } from "../../store/useAuth";
import * as api from "../../api";
import type { PvForecastResponse } from "../../types";
import type { User } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getPvForecast: vi.fn(),
}));

const mockedGet = vi.mocked(api.getPvForecast);

function response(over: Partial<PvForecastResponse> = {}): PvForecastResponse {
  return {
    active: true,
    declaredPeakWc: 4000,
    planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: 4000 }],
    curve: [],
    issuedAt: null,
    weatherAvailable: true,
    accuracy: {
      samples: 0,
      maeW: null,
      dailyMaeWh: null,
      dailyMaePct: null,
      dailyDays: 0,
      today: null,
      points: [],
      measured: [],
    },
    model: null,
    ...over,
  };
}

function setRole(role: "admin" | "user"): void {
  useAuth.setState({
    user: { id: "u1", username: "t", role, preferences: {} } as unknown as User,
  });
}

async function renderPanel(data: PvForecastResponse) {
  mockedGet.mockResolvedValue(data);
  const view = render(
    <MemoryRouter>
      <PvForecastPanel equipmentId="eq-pv" />
    </MemoryRouter>,
  );
  await new Promise((r) => setTimeout(r, 0));
  return view;
}

describe("PvForecastPanel (monitoring only, spec 163)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRole("user");
  });

  it("renders nothing at all for an undeclared array", async () => {
    // The declaration form used to render here; it now lives in
    // Settings -> Energy, and the hosting page owns the empty state.
    const { container } = await renderPanel(response({ active: false }));
    expect(container.firstChild).toBeNull();
  });

  it("renders the monitoring card with the declared peak power", async () => {
    await renderPanel(response());
    expect(await screen.findByText(/expected production/i)).toBeTruthy();
    expect(screen.getByText(/4000 Wc declared/i)).toBeTruthy();
  });

  it("links the declared figure to Settings -> Energy for admins", async () => {
    setRole("admin");
    await renderPanel(response());
    const link = (await screen.findByText(/4000 Wc declared/i)).closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("/settings?tab=energy");
  });

  it("keeps the declared figure plain text for non-admins", async () => {
    await renderPanel(response());
    const figure = await screen.findByText(/4000 Wc declared/i);
    expect(figure.closest("a")).toBeNull();
  });

  it("no longer carries the backfill action or the declaration form", async () => {
    setRole("admin");
    await renderPanel(response());
    expect(screen.queryByText(/relearn from my history/i)).toBeNull();
    expect(screen.queryByText(/peak power/i)).toBeNull();
  });
});

// ============================================================
// Daily energy accuracy and the short windows (#907)
// ============================================================

describe("PvForecastPanel accuracy (#907)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRole("user");
  });

  const scored = (over: Partial<PvForecastResponse["accuracy"]> = {}) =>
    response({
      curve: [{ at: new Date().toISOString(), watts: 1200 }],
      accuracy: {
        samples: 168,
        maeW: 73,
        dailyMaeWh: 1150,
        dailyMaePct: 5.6,
        dailyDays: 9,
        today: null,
        points: [],
        measured: [],
        ...over,
      },
    });

  it("states the error on the daily energy, not the hourly power average", async () => {
    await renderPanel(scored());
    // 73 W was the figure that read as implausibly good next to a 3.4 kW peak:
    // 44% of its window was night, where both sides are zero.
    expect(screen.getByText(/± 1.15 kWh \(5.6%\)/)).toBeTruthy();
    expect(screen.queryByText(/73 W/)).toBeNull();
  });

  it("counts complete days, not hours", async () => {
    await renderPanel(scored());
    expect(screen.getByText(/over 9 complete days/)).toBeTruthy();
  });

  it("shows the running day compared over the hours that have happened", async () => {
    await renderPanel(
      scored({
        today: { day: "2026-09-05", forecastWh: 19_400, actualWh: 18_900, hours: 13 },
      }),
    );
    expect(
      screen.getByText(/19.4 kWh forecast yesterday, 18.9 kWh measured over 13 h/),
    ).toBeTruthy();
    expect(screen.getByText("-3%")).toBeTruthy();
  });

  it("hides the running-day line overnight, when neither side has anything yet", async () => {
    // Gated on production, not on hours: paired hours exist from the first
    // hour after midnight, and the line used to sit at 0.0 / 0.0 all night.
    await renderPanel(
      scored({ today: { day: "2026-09-05", forecastWh: 0, actualWh: 0, hours: 3 } }),
    );
    expect(screen.queryByText(/forecast yesterday/)).toBeNull();
  });

  it("says nothing rather than zero while no day has finished", async () => {
    await renderPanel(scored({ dailyMaeWh: null, dailyMaePct: null, dailyDays: 0 }));
    expect(screen.getByText(/Available once a full day/)).toBeTruthy();
  });

  it("offers a one-day and a three-day window, and opens on three", async () => {
    await renderPanel(scored());
    for (const label of ["1 d", "3 d", "7 d", "30 d", "90 d"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // The zoom the panel opens on: a week of hourly points is a picket fence.
    expect(mockedGet).toHaveBeenCalledWith("eq-pv", 3);
  });

  it("re-queries when the window changes", async () => {
    const { container } = await renderPanel(scored());
    const oneDay = [...container.querySelectorAll("button")].find((b) => b.textContent === "1 d");
    oneDay?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedGet).toHaveBeenCalledWith("eq-pv", 1);
  });
});
