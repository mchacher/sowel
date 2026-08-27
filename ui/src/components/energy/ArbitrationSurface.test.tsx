import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../../test-utils";
import { ArbitrationSurface } from "./ArbitrationSurface";
import { useArbiter } from "../../store/useArbiter";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import type { ArbiterLoadInfo, ArbiterPublicState } from "../../types";

// The mounted surface calls the arbiter store's fetch() on mount; stub the
// network call so the state we seed via setState is what renders.
vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getArbiterState: vi.fn().mockRejectedValue(new Error("no network in test")),
}));

/** Spec 165 — the roster renders `loads` verbatim; every case is one row. */
function load(over: Partial<ArbiterLoadInfo> & { equipmentId: string }): ArbiterLoadInfo {
  return {
    equipmentName: over.equipmentId,
    state: "idle",
    watts: null,
    needW: null,
    toleratedImportW: null,
    ...over,
  };
}

function fullState(over: Partial<ArbiterPublicState> = {}): ArbiterPublicState {
  return {
    enabled: true,
    state: "active",
    availableSurplusW: -1091,
    productionDetected: true,
    loads: [],
    dormant: false,
    grants: [],
    pending: [],
    suspensions: [],
    idle: [],
    priority: [],
    journal: [],
    surplusSeries: [],
    ...over,
  };
}

function seed(over: Partial<ArbiterPublicState>): void {
  useArbiter.setState({ state: fullState(over), loading: false });
  useEquipments.setState({ equipments: [] });
  useZones.setState({ tree: [] });
}

describe("ArbitrationSurface roster (#561, spec 165)", () => {
  beforeEach(() => {
    useArbiter.setState({ state: null, loading: false });
  });

  it("renders a waiting load with its need/load/tolerated figures", () => {
    seed({
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe Piscine",
          state: "pending",
          watts: 600,
          needW: 400,
          toleratedImportW: 300,
          reasonWaiting: "insufficient-surplus:0",
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Pompe Piscine")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("400 W")).toBeTruthy(); // need
    expect(screen.getByText("600 W")).toBeTruthy(); // load
    expect(screen.getByText("300 W")).toBeTruthy(); // tolerated
  });

  it("shows a running must-run fallback as unmanaged, never waiting (#491)", () => {
    seed({
      loads: [
        load({
          equipmentId: "pac",
          equipmentName: "PAC Piscine",
          state: "unmanaged",
          watts: 1800,
          toleratedImportW: 200,
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Running (unmanaged)")).toBeTruthy();
    expect(screen.queryByText("Waiting")).toBeNull();
  });

  it("renders a declared load with no claim as 'At rest' with its rating (#561)", () => {
    seed({ loads: [load({ equipmentId: "pac", equipmentName: "PAC", watts: 1500 })] });
    render(<ArbitrationSurface />);

    expect(screen.getByText("PAC")).toBeTruthy();
    expect(screen.getByText("At rest")).toBeTruthy();
    expect(screen.getByText("1500 W")).toBeTruthy();
  });

  it("shows a granted load consuming nothing as 'Granted (not consuming)' (spec 164/165)", () => {
    seed({
      loads: [
        load({
          equipmentId: "heater",
          equipmentName: "Chauffe-eau",
          state: "granted-idle",
          watts: 2200,
          sinceIso: "2026-08-27T08:00:00.000Z",
        }),
      ],
    });
    render(<ArbitrationSurface />);

    // The gap issue #732 left open: the ribbon knew, the roster did not.
    expect(screen.getByText("Granted (not consuming)")).toBeTruthy();
    expect(screen.queryByText("Granted")).toBeNull();
  });

  it("renders a suspended load with no figures", () => {
    seed({
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          state: "suspended",
          watts: 600,
          toleratedImportW: 300,
          untilIso: "2026-08-27T09:00:00.000Z",
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Suspended")).toBeTruthy();
    expect(screen.queryByText("600 W")).toBeNull();
    expect(screen.queryByText("300 W")).toBeNull();
  });

  it("reads a waiting claim as at rest while dormant, and hides its need (#577)", () => {
    seed({
      dormant: true,
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          state: "pending",
          watts: 600,
          needW: 400,
          toleratedImportW: 300,
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("At rest")).toBeTruthy();
    expect(screen.queryByText("Waiting")).toBeNull();
    expect(screen.queryByText("400 W")).toBeNull(); // the need makes no sense at night
  });

  it("renders granted, waiting and at-rest loads together, in the order given", () => {
    seed({
      loads: [
        load({ equipmentId: "pac", equipmentName: "PAC", watts: 1500 }),
        load({ equipmentId: "heater", equipmentName: "Chauffe-eau", watts: 2000 }),
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          state: "granted",
          watts: 600,
          sinceIso: "2026-08-27T08:00:00.000Z",
        }),
        load({
          equipmentId: "pacp",
          equipmentName: "PAC Piscine",
          state: "pending",
          watts: 1800,
          needW: 1700,
          toleratedImportW: 200,
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Granted")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getAllByText("At rest")).toHaveLength(2);

    // #616 — priority order comes from the read model; the surface must not
    // regroup by state.
    const names = screen
      .getAllByRole("row")
      .slice(1) // drop the header row
      .map((row) => row.querySelector("td")?.textContent);
    expect(names).toEqual(["PAC", "Chauffe-eau", "Pompe", "PAC Piscine"]);
  });

  it("spells out the deficit context when the meter is importing", () => {
    seed({
      availableSurplusW: -1091,
      loads: [load({ equipmentId: "pac", equipmentName: "PAC", watts: 1500 })],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Importing 1.1 kW, no load can start yet.")).toBeTruthy();
  });
});
