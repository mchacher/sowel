import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { act, render, screen, userEvent, waitFor } from "../test-utils";
import { EquipmentDetailPage } from "./EquipmentDetailPage";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { useAuth } from "../store/useAuth";
import { equipmentLinkState } from "../lib/equipment-origin";
import * as api from "../api";
import { ApiError } from "../api/client";
import type { EquipmentWithDetails, ZoneWithChildren } from "../types";

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

const other: EquipmentWithDetails = { ...sensor, id: "eq-2", name: "Capteur cuisine" };

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go
    </button>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/equipments/eq-1"]}>
      <GoTo to="/equipments/eq-2" />
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

  it("shows the store's equipment with no notice when the first fetch is rate-limited", async () => {
    useEquipments.setState({ equipments: [sensor] });
    mockedGet.mockRejectedValue(new ApiError(429, "Too Many Requests"));
    renderPage();

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Capteur salon");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Server busy")).toBeNull();
    expect(screen.queryByText("Equipment not found")).toBeNull();
    expect(screen.queryByText("Too Many Requests")).toBeNull();
  });

  it("keeps a fetched copy and shows a notice when a later fetch is rate-limited", async () => {
    // Fetched, not in the store; the store then holds it and loses it again (deleted
    // elsewhere?), and the check that follows is rate-limited.
    mockedGet.mockResolvedValueOnce(sensor);
    renderPage();
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    act(() => useEquipments.setState({ equipments: [sensor] }));

    mockedGet.mockRejectedValueOnce(new ApiError(429, "Too Many Requests"));
    act(() => useEquipments.setState({ equipments: [] }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Capteur salon");
    expect(screen.getByText("Server busy")).toBeTruthy();
    expect(screen.queryByText("Equipment not found")).toBeNull();
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

  it("notices the second equipment leaving the store after moving A → B", async () => {
    useEquipments.setState({ equipments: [sensor, other] });
    mockedGet.mockImplementation(async (id: string) => (id === "eq-1" ? sensor : other));
    renderPage();
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(mockedGet).toHaveBeenLastCalledWith("eq-2");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Capteur cuisine");

    mockedGet.mockRejectedValueOnce(new ApiError(404, "Equipment not found"));
    act(() => useEquipments.setState({ equipments: [sensor] }));
    expect(await screen.findByText("Equipment not found")).toBeTruthy();
    expect(mockedGet).toHaveBeenCalledTimes(3);
    expect(mockedGet).toHaveBeenLastCalledWith("eq-2");
  });
});

// Spec 196, slice 9 — use first, then configure; back to where the page came from.

const shutter: EquipmentWithDetails = { ...sensor, id: "eq-s", name: "Volet salon", type: "shutter" };

function renderAt(entry: { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/equipments/:id" element={<EquipmentDetailPage />} />
        <Route path="/home/:zoneId" element={<p>room page</p>} />
        <Route path="/equipments" element={<p>equipment list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EquipmentDetailPage navigation and order", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    useEquipments.setState({ equipments: [sensor, shutter] });
    mockedGet.mockImplementation(async (id: string) => (id === "eq-s" ? shutter : sensor));
    useZones.setState({
      tree: [{ id: "z-1", name: "Salon", parentId: null, children: [] } as unknown as ZoneWithChildren],
      fetchZones: async () => {},
    });
    useAuth.setState({ user: null });
  });

  it("goes back to the room, named, when the page was opened with no origin", async () => {
    renderAt({ pathname: "/equipments/eq-1" });
    const back = await screen.findByRole("link", { name: "Back to Salon" });
    expect(back.getAttribute("href")).toBe("/home/z-1");
    expect(screen.getByText(/Sensor · Salon/)).toBeTruthy();
  });

  it("goes back in history to the origin a link gave, under its name", async () => {
    renderAt({ pathname: "/equipments/eq-1", state: equipmentLinkState("Living mode", "/modes/m-1") });
    expect(await screen.findByRole("button", { name: "Back to Living mode" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Back to Salon" })).toBeNull();
  });

  it("keeps « Back to equipments » for a page opened from the equipment list", async () => {
    renderAt({ pathname: "/equipments/eq-1", state: equipmentLinkState("Equipments", "/equipments") });
    expect(await screen.findByRole("button", { name: "Back to equipments" })).toBeTruthy();
  });

  it("puts the settings in collapsed rows of the Configuration card, delete at its foot", async () => {
    useAuth.setState({ user: { id: "u", username: "admin", role: "admin" } as never });
    renderAt({ pathname: "/equipments/eq-s" });
    await screen.findByRole("heading", { level: 1 });

    const configuration = screen.getByRole("heading", { name: "Configuration" });
    const controls = screen.getByRole("heading", { name: "Controls" });
    // Usage above configuration.
    expect(controls.compareDocumentPosition(configuration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const invert = screen.getByRole("button", { name: /Invert open\/close direction/ });
    expect(invert.getAttribute("aria-expanded")).toBe("false");
    expect(invert.textContent).toContain("Disabled");
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(invert);
    expect(screen.getByRole("checkbox")).toBeTruthy();

    // Delete left the header for the foot of the card.
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    const del = screen.getByRole("button", { name: "Delete equipment" });
    expect(configuration.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
