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
    accuracy: { samples: 0, maeW: null, points: [], measured: [] },
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
