import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "../../test-utils";
import { ProductionPage } from "./ProductionPage";
import { useEnergy } from "../../store/useEnergy";
import { localDateStr } from "../../lib/local-date";
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

// The chart itself is Recharts and draws nothing in jsdom; what the page hands
// it is what these tests are about (spec 197, the forecast axis floor).
const chartProps: { floorKwh?: number }[] = [];
vi.mock("./ProductionBarChart", () => ({
  ProductionBarChart: (props: { floorKwh?: number }) => {
    chartProps.push(props);
    return null;
  },
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
      totals: {
        total_hp: 0,
        total_hc: 0,
        total_production: 0,
        total_autoconso: 0,
        total_injection: 0,
      },
    } as unknown as EnergyHistoryResponse,
    loading: false,
    period: "day",
    date: localDateStr(),
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

  // Spec 197 (FR-E6.2) — the card opens on the production, read against
  // today's forecast when there is one.
  it("reads the day's production against today's forecast", async () => {
    setup({ meters: [meter("eq-1", "Shelly Solar", true)], role: "user" });
    useEnergy.setState({
      history: {
        points: [],
        totals: {
          total_hp: 0,
          total_hc: 0,
          total_production: 50,
          total_autoconso: 50,
          total_injection: 0,
        },
      } as unknown as EnergyHistoryResponse,
    });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const one = new Date(noon);
    one.setHours(13);
    mockedForecast.mockResolvedValue({
      ...forecastResponse(),
      curve: [
        { at: noon.toISOString(), watts: 2500 },
        { at: one.toISOString(), watts: 2000 },
      ],
    });
    await renderPage();
    expect(await screen.findByText(/of 4.5 kWh expected today/)).toBeTruthy();
    expect(screen.getByText(/^0\.05\s*kWh$/)).toBeTruthy();
  });

  it("says no forecast it does not have", async () => {
    setup({ meters: [meter("eq-1", "Shelly Solar", true)], role: "user" });
    useEnergy.setState({
      history: {
        points: [],
        totals: {
          total_hp: 0,
          total_hc: 0,
          total_production: 50,
          total_autoconso: 50,
          total_injection: 0,
        },
      } as unknown as EnergyHistoryResponse,
    });
    await renderPage();
    expect(await screen.findByText(/expected production/i)).toBeTruthy();
    expect(screen.queryByText(/expected today/)).toBeNull();
    expect(screen.getByText("today")).toBeTruthy();
  });

  it("lifts today's day-view axis to the forecast's busiest hour", async () => {
    setup({ meters: [meter("eq-1", "Shelly Solar", true)], role: "user" });
    useEnergy.setState({ period: "day", date: localDateStr() });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    mockedForecast.mockResolvedValue({
      ...forecastResponse(),
      curve: [{ at: noon.toISOString(), watts: 2300 }],
    });
    await renderPage();
    await screen.findByText(/expected production/i);
    expect(chartProps.at(-1)?.floorKwh).toBeCloseTo(2.3);
  });

  it("does not read a past day against today's forecast", async () => {
    setup({ meters: [meter("eq-1", "Shelly Solar", true)], role: "user" });
    useEnergy.setState({
      period: "day",
      date: "2026-03-09",
      history: {
        points: [],
        totals: {
          total_hp: 0,
          total_hc: 0,
          total_production: 50,
          total_autoconso: 50,
          total_injection: 0,
        },
      } as unknown as EnergyHistoryResponse,
    });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    mockedForecast.mockResolvedValue({
      ...forecastResponse(),
      curve: [{ at: noon.toISOString(), watts: 2300 }],
    });
    await renderPage();
    await screen.findByText(/expected production/i);
    expect(screen.queryByText(/expected today/)).toBeNull();
    // The selector and the headline both name the day.
    expect(screen.getAllByText("March 9, 2026")).toHaveLength(2);
    expect(chartProps.at(-1)?.floorKwh).toBeUndefined();
  });
});
