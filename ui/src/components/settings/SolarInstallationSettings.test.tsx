import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { SolarInstallationSettings } from "./SolarInstallationSettings";
import { useEquipments } from "../../store/useEquipments";
import * as api from "../../api";
import type { PvForecastResponse } from "../../types";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getPvForecast: vi.fn(),
  backfillPvForecast: vi.fn(),
}));

const mockedGet = vi.mocked(api.getPvForecast);
const mockedBackfill = vi.mocked(api.backfillPvForecast);

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

function response(over: Partial<PvForecastResponse> = {}): PvForecastResponse {
  return {
    active: true,
    declaredPeakWc: 4000,
    planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: 4000 }],
    curve: [],
    issuedAt: null,
    weatherAvailable: true,
    since: "2026-08-05",
    accuracy: { samples: 0, maeW: null, points: [], measured: [] },
    model: null,
    ...over,
  };
}

function setMeters(meters: EquipmentWithDetails[]): void {
  useEquipments.setState({
    equipments: meters,
    // The component fires a defensive refetch on mount; the store is already
    // seeded, so it must not overwrite it from the network.
    fetchEquipments: async () => {},
  });
}

async function renderSection() {
  const view = render(<SolarInstallationSettings />);
  await new Promise((r) => setTimeout(r, 0));
  return view;
}

describe("SolarInstallationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue(response());
  });

  it("says a production meter is needed first when none exists", async () => {
    setMeters([]);
    await renderSection();
    expect(await screen.findByText(/no production meter equipment yet/i)).toBeTruthy();
    expect(screen.queryByText(/peak power/i)).toBeNull();
  });

  it("shows the declaration form without a selector for a single meter", async () => {
    setMeters([meter("eq-1", "Shelly Solar", true)]);
    await renderSection();
    expect(await screen.findByText(/peak power/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(mockedGet).toHaveBeenCalledWith("eq-1");
  });

  it("defaults to the declared meter and switches profiles via the selector", async () => {
    setMeters([meter("eq-a", "Garage array", false), meter("eq-b", "Roof array", true)]);
    await renderSection();
    // Default is the declared one, not the first in the list.
    expect(mockedGet).toHaveBeenCalledWith("eq-b");

    await userEvent.selectOptions(await screen.findByRole("combobox"), "eq-a");
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedGet).toHaveBeenCalledWith("eq-a");
  });

  it("runs the backfill and reports the fitted hours", async () => {
    setMeters([meter("eq-1", "Shelly Solar", true)]);
    mockedBackfill.mockResolvedValue({
      hoursPaired: 120,
      model: { gain: 3.8, samples: 120, fittedAt: "2026-08-26T00:00:00Z" },
    });
    await renderSection();

    await userEvent.click(await screen.findByText(/relearn from my history/i));
    expect(mockedBackfill).toHaveBeenCalledWith("eq-1");
    expect(await screen.findByText(/fitted on 120 hours/i)).toBeTruthy();
  });

  it("hides the backfill action while nothing is declared", async () => {
    setMeters([meter("eq-1", "Shelly Solar", false)]);
    mockedGet.mockResolvedValue(response({ active: false, planes: [], since: undefined }));
    await renderSection();
    expect(await screen.findByText(/peak power/i)).toBeTruthy();
    expect(screen.queryByText(/relearn from my history/i)).toBeNull();
  });

  it("drops a stale response that lands after switching meters", async () => {
    // Meter A's profile resolving late must not fill the form already keyed
    // to meter B: the next save would write A's declaration onto B.
    setMeters([meter("eq-a", "Roof array", true), meter("eq-b", "Garage array", true)]);
    let resolveA: ((v: PvForecastResponse) => void) | undefined;
    mockedGet.mockImplementation((id: string) =>
      id === "eq-a"
        ? new Promise<PvForecastResponse>((r) => {
            resolveA = r;
          })
        : Promise.resolve(response()),
    );
    await renderSection();

    // Switch to eq-b while eq-a's request is still in flight; eq-b resolves
    // immediately and shows the active form with its backfill action.
    await userEvent.selectOptions(await screen.findByRole("combobox"), "eq-b");
    expect(await screen.findByText(/relearn from my history/i)).toBeTruthy();

    // Now the stale eq-a response arrives, claiming an undeclared array.
    resolveA?.(response({ active: false, planes: [], since: undefined }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText(/relearn from my history/i)).toBeTruthy();
  });

  it("offers a retry instead of an empty form when the profile fetch fails", async () => {
    // Rendering the form from a failed fetch would offer an empty draft whose
    // save wipes the stored declaration.
    setMeters([meter("eq-1", "Shelly Solar", true)]);
    mockedGet.mockRejectedValue(new Error("network"));
    await renderSection();
    expect(await screen.findByText(/could not load/i)).toBeTruthy();
    expect(screen.queryByText(/peak power/i)).toBeNull();
  });
});
