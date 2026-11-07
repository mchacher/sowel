import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { act, render, screen, userEvent, waitFor } from "../test-utils";
import { EquipmentDetailPage } from "./EquipmentDetailPage";
import { useEquipments } from "../store/useEquipments";
import * as api from "../api";
import { ApiError } from "../api/client";
import type { EquipmentWithDetails } from "../types";

// Spec 196, slice 2b. The page used to re-fetch GET /equipments/:id on every reading
// the equipment pushed, and to replace a loaded page with « Équipement introuvable »
// (plus the server's raw « Too Many Requests ») whenever one of those refreshes failed.

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  getEquipment: vi.fn(),
  getHistoryBindings: vi.fn(async () => []),
}));

const mockedGet = vi.mocked(api.getEquipment);

const sensor: EquipmentWithDetails = {
  id: "eq-1",
  name: "Capteur salon",
  type: "sensor",
  zoneId: "z-1",
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "online",
  dataBindings: [],
  orderBindings: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/equipments/eq-1"]}>
      <Routes>
        <Route path="/equipments/:id" element={<EquipmentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EquipmentDetailPage errors", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    useEquipments.setState({ equipments: [] });
  });

  it("keeps the page and shows a notice when a refresh is rate-limited", async () => {
    useEquipments.setState({ equipments: [sensor] });
    mockedGet.mockRejectedValue(new ApiError(429, "Too Many Requests"));
    renderPage();

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Capteur salon");
    expect(screen.getByText("Server busy")).toBeTruthy();
    expect(screen.queryByText("Equipment not found")).toBeNull();
    expect(screen.queryByText("Too Many Requests")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("says the server is busy, not « not found », when the first load is rate-limited", async () => {
    mockedGet.mockRejectedValueOnce(new ApiError(429, "Too Many Requests"));
    renderPage();

    expect(await screen.findByText("Server busy")).toBeTruthy();
    expect(screen.queryByText("Equipment not found")).toBeNull();

    mockedGet.mockResolvedValueOnce(sensor);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Capteur salon");
  });

  it("says « not found » for a 404, with no retry", async () => {
    mockedGet.mockRejectedValueOnce(new ApiError(404, "Equipment not found"));
    renderPage();

    expect(await screen.findByText("Equipment not found")).toBeTruthy();
    expect(screen.getByText("This equipment does not exist or was deleted.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("reads new values from the store instead of re-fetching on each one", async () => {
    useEquipments.setState({ equipments: [sensor] });
    mockedGet.mockResolvedValue(sensor);
    renderPage();
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    act(() => {
      for (let i = 0; i < 5; i++) {
        useEquipments.getState().handleEquipmentDataChanged("eq-1", "energy_day", i);
      }
    });
    await act(async () => {});
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("asks the server again when the equipment leaves the store", async () => {
    useEquipments.setState({ equipments: [sensor] });
    mockedGet.mockResolvedValueOnce(sensor);
    renderPage();
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    mockedGet.mockRejectedValueOnce(new ApiError(404, "Equipment not found"));
    act(() => useEquipments.setState({ equipments: [] }));
    expect(await screen.findByText("Equipment not found")).toBeTruthy();
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});
