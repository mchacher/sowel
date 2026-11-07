import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "../i18n";
import { ApiError } from "../api/client";
import * as api from "../api";
import { useDevices } from "./useDevices";
import { useZones } from "./useZones";
import { useEquipments } from "./useEquipments";
import { useModes } from "./useModes";
import { useRecipes } from "./useRecipes";
import { useCharts } from "./useCharts";
import { useZoneAggregation } from "./useZoneAggregation";
import { useDashboard } from "./useDashboard";
import { useEnergy } from "./useEnergy";
import { useSharedAccess, SHARED_ACCESS_SETTING } from "./useSharedAccess";
import type { Device } from "../types";

// Issue #1124 — a failed load used to leave an English « Failed to fetch … » (or the
// server's raw « Too Many Requests ») in the store's `error`, shown as is to a French
// user. Every store now words it through `apiErrorText`.

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    getDevices: vi.fn(),
    updateDevice: vi.fn(),
    getZones: vi.fn(),
    getEquipments: vi.fn(),
    getModes: vi.fn(),
    getRecipeInstances: vi.fn(),
    getCharts: vi.fn(),
    getZoneAggregation: vi.fn(),
    getDashboardWidgets: vi.fn(),
    getEnergyHistory: vi.fn(),
    getSettings: vi.fn(),
    getSharedAccessState: vi.fn(),
  };
});

type Mocked = ReturnType<typeof vi.fn>;
const mocked = (name: keyof typeof api) => api[name] as unknown as Mocked;

interface ListStore {
  name: string;
  apiFn: keyof typeof api;
  load: () => Promise<void>;
  error: () => string | null;
}

const listStores: ListStore[] = [
  {
    name: "useDevices",
    apiFn: "getDevices",
    load: () => useDevices.getState().fetchDevices(),
    error: () => useDevices.getState().error,
  },
  {
    name: "useZones",
    apiFn: "getZones",
    load: () => useZones.getState().fetchZones(),
    error: () => useZones.getState().error,
  },
  {
    name: "useEquipments",
    apiFn: "getEquipments",
    load: () => useEquipments.getState().fetchEquipments(),
    error: () => useEquipments.getState().error,
  },
  {
    name: "useModes",
    apiFn: "getModes",
    load: () => useModes.getState().fetchModes(),
    error: () => useModes.getState().error,
  },
  {
    name: "useRecipes",
    apiFn: "getRecipeInstances",
    load: () => useRecipes.getState().fetchInstances(),
    error: () => useRecipes.getState().error,
  },
  {
    name: "useCharts",
    apiFn: "getCharts",
    load: () => useCharts.getState().fetchCharts(),
    error: () => useCharts.getState().error,
  },
  {
    name: "useZoneAggregation",
    apiFn: "getZoneAggregation",
    load: () => useZoneAggregation.getState().fetchAggregation(),
    error: () => useZoneAggregation.getState().error,
  },
  {
    name: "useDashboard",
    apiFn: "getDashboardWidgets",
    load: () => useDashboard.getState().fetchWidgets(),
    error: () => useDashboard.getState().error,
  },
  {
    name: "useEnergy",
    apiFn: "getEnergyHistory",
    load: () => useEnergy.getState().fetchHistory(),
    error: () => useEnergy.getState().error,
  },
];

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("fr");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe.each(listStores)("$name load failure", ({ apiFn, load, error }) => {
  it("calls a 429 a busy server, in the UI language", async () => {
    mocked(apiFn).mockRejectedValueOnce(new ApiError(429, "Too Many Requests"));
    await load();
    expect(error()).toBe("Trop de demandes en peu de temps. Réessayez dans quelques secondes.");
  });

  it("calls a request that got no answer a connection failure", async () => {
    mocked(apiFn).mockRejectedValueOnce(new ApiError(0, "Failed to fetch"));
    await load();
    expect(error()).toBe("Sowel ne répond pas. Vérifiez la connexion puis réessayez.");
  });

  it("calls a 404 not found", async () => {
    mocked(apiFn).mockRejectedValueOnce(new ApiError(404, "Not Found"));
    await load();
    expect(error()).toBe("Cet élément n'existe pas ou a été supprimé.");
  });

  it("keeps the server's own message for a refused request", async () => {
    mocked(apiFn).mockRejectedValueOnce(new ApiError(400, "Invalid period"));
    await load();
    expect(error()).toBe("Invalid period");
  });

  it("falls back to a translated generic line, never an English « Failed to … »", async () => {
    mocked(apiFn).mockRejectedValueOnce("boom");
    await load();
    expect(error()).toBe("Une erreur est survenue");
  });
});

describe("useSharedAccess refresh failure", () => {
  beforeEach(() => useSharedAccess.getState().reset());

  it("words a failed settings read", async () => {
    mocked("getSettings").mockRejectedValueOnce(new ApiError(429, "Too Many Requests"));
    await useSharedAccess.getState().refresh();
    expect(useSharedAccess.getState().error).toBe(
      "Trop de demandes en peu de temps. Réessayez dans quelques secondes.",
    );
  });

  it("words a failed state read", async () => {
    mocked("getSettings").mockResolvedValueOnce({ [SHARED_ACCESS_SETTING]: "true" });
    mocked("getSharedAccessState").mockRejectedValueOnce(new ApiError(0, "Failed to fetch"));
    await useSharedAccess.getState().refresh();
    expect(useSharedAccess.getState().error).toBe("Sowel ne répond pas. Vérifiez la connexion puis réessayez.");
  });
});

describe("useDevices.updateDeviceName failure", () => {
  it("reverts the name and rethrows the original error, status included", async () => {
    const device = { id: "d1", name: "Old" } as Device;
    useDevices.setState({ devices: { d1: device } });
    const failure = new ApiError(429, "Too Many Requests");
    mocked("updateDevice").mockRejectedValueOnce(failure);

    await expect(useDevices.getState().updateDeviceName("d1", "New")).rejects.toBe(failure);
    expect(useDevices.getState().devices.d1.name).toBe("Old");
  });
});
