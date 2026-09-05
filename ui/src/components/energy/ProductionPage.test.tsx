import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "../../test-utils";
import { ProductionPage } from "./ProductionPage";
import { useEnergy } from "../../store/useEnergy";
import { useEquipments } from "../../store/useEquipments";
import { useAuth } from "../../store/useAuth";
import * as api from "../../api";
import type { EnergyHistoryResponse, EquipmentWithDetails, User } from "../../types";
import type { PvForecastResponse } from "../../types";
import type { PvHealthResponse } from "../../api";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getPvForecast: vi.fn(),
  getPvHealth: vi.fn(),
}));

const mockedForecast = vi.mocked(api.getPvForecast);
const mockedHealth = vi.mocked(api.getPvHealth);

function meter(id: string, name: string, declared: boolean): EquipmentWithDetails {
  return {
    id,
    name,
    type: "energy_production_meter",
    solarProfile: declared
      ? { planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: 4000 }] }
      : undefined,
    dataBindings: [],
    orderBindings: [],
    status: "online",
  } as unknown as EquipmentWithDetails;
}

function forecastResponse(): PvForecastResponse {
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
  };
}

function setup(opts: { meters: EquipmentWithDetails[]; role: "admin" | "user" }): void {
  useEnergy.setState({
    history: {
      points: [],
      totals: { total_hp: 0, total_hc: 0, total_production: 0, total_autoconso: 0, total_injection: 0 },
    } as unknown as EnergyHistoryResponse,
    loading: false,
    hasProduction: true,
    fetchHistory: async () => {},
  });
  useEquipments.setState({
    equipments: opts.meters,
    fetchEquipments: async () => {},
  });
  useAuth.setState({
    user: { id: "u1", username: "t", role: opts.role, preferences: {} } as unknown as User,
  });
}

async function renderPage() {
  const view = render(
    <MemoryRouter initialEntries={["/energy/production"]}>
      <ProductionPage />
    </MemoryRouter>,
  );
  await new Promise((r) => setTimeout(r, 0));
  return view;
}

describe("ProductionPage (spec 163)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedForecast.mockResolvedValue(forecastResponse());
    // Health inactive: the health panel renders nothing, which keeps these
    // tests about page composition, not panel internals.
    mockedHealth.mockResolvedValue({
      active: false,
      days: [],
      normal: null,
      latest: null,
      alert: null,
      detection: null,
    } as unknown as PvHealthResponse);
  });

  it("renders the monitoring block for the declared meter, untitled when alone", async () => {
    setup({ meters: [meter("eq-1", "Shelly Solar", true)], role: "user" });
    await renderPage();
    expect(await screen.findByText(/expected production/i)).toBeTruthy();
    // Three days, not seven: the window the panel opens on since #907.
    expect(mockedForecast).toHaveBeenCalledWith("eq-1", 3);
    // A single meter needs no name heading; the panel titles say what it is.
    expect(screen.queryByText("Shelly Solar")).toBeNull();
  });

  it("titles each block with the meter name when several are declared", async () => {
    setup({
      meters: [meter("eq-1", "Roof array", true), meter("eq-2", "Garage array", true)],
      role: "user",
    });
    await renderPage();
    expect(await screen.findByText("Roof array")).toBeTruthy();
    expect(screen.getByText("Garage array")).toBeTruthy();
    expect(mockedForecast).toHaveBeenCalledWith("eq-1", 3);
    expect(mockedForecast).toHaveBeenCalledWith("eq-2", 3);
  });

  it("skips undeclared meters but still names the block among several", async () => {
    setup({
      meters: [meter("eq-1", "Roof array", true), meter("eq-2", "Garage array", false)],
      role: "user",
    });
    await renderPage();
    expect(await screen.findByText(/expected production/i)).toBeTruthy();
    expect(mockedForecast).not.toHaveBeenCalledWith("eq-2", 7);
    // FR1: several meters exist, so the one monitored block says which meter
    // it is about; the undeclared meter contributes no block at all.
    expect(screen.getByText("Roof array")).toBeTruthy();
    expect(screen.queryByText("Garage array")).toBeNull();
  });

  it("points an admin to settings when a meter exists but nothing is declared", async () => {
    setup({ meters: [meter("eq-1", "Shelly Solar", false)], role: "admin" });
    await renderPage();
    const hint = await screen.findByText(/declare your photovoltaic installation/i);
    expect(hint.closest("a")?.getAttribute("href")).toBe("/settings?tab=energy");
  });

  it("shows no hint to a viewer, who cannot declare anything", async () => {
    setup({ meters: [meter("eq-1", "Shelly Solar", false)], role: "user" });
    await renderPage();
    expect(screen.queryByText(/declare your photovoltaic installation/i)).toBeNull();
  });

  it("shows no hint either when there is no production meter at all", async () => {
    setup({ meters: [], role: "admin" });
    await renderPage();
    expect(screen.queryByText(/declare your photovoltaic installation/i)).toBeNull();
  });
});
