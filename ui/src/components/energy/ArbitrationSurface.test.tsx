import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../../test-utils";
import { ArbitrationSurface } from "./ArbitrationSurface";
import { useArbiter } from "../../store/useArbiter";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import type { ArbiterPublicState } from "../../types";

// The mounted surface calls the arbiter store's fetch() on mount; stub the
// network call so the state we seed via setState is what renders.
vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getArbiterState: vi.fn().mockRejectedValue(new Error("no network in test")),
}));

function fullState(over: Partial<ArbiterPublicState> = {}): ArbiterPublicState {
  return {
    enabled: true,
    state: "active",
    availableSurplusW: -1091,
    productionDetected: true,
    grants: [],
    pending: [],
    suspensions: [],
    idle: [],
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

describe("ArbitrationSurface roster (#561)", () => {
  beforeEach(() => {
    useArbiter.setState({ state: null, loading: false });
  });

  it("renders a waiting pending load with its need/load/tolerated figures", () => {
    seed({
      pending: [
        {
          equipmentId: "pump",
          equipmentName: "Pompe Piscine",
          instanceId: "i-pump",
          watts: 600,
          needW: 400,
          toleratedImportW: 300,
          reasonWaiting: "insufficient-surplus:0",
          running: false,
        },
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Pompe Piscine")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("400 W")).toBeTruthy(); // need
    expect(screen.getByText("600 W")).toBeTruthy(); // load
    expect(screen.getByText("300 W")).toBeTruthy(); // tolerated
  });

  it("shows a running must-run fallback as 'No surplus', never 'Waiting' (#491)", () => {
    seed({
      pending: [
        {
          equipmentId: "pac",
          equipmentName: "PAC Piscine",
          instanceId: "i-pac",
          watts: 1800,
          needW: 1700,
          toleratedImportW: 200,
          reasonWaiting: "insufficient-surplus:0",
          running: true,
        },
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("No surplus")).toBeTruthy();
    expect(screen.queryByText("Waiting")).toBeNull();
  });

  it("renders a declared load with no claim as 'At rest' with its rating (#561)", () => {
    seed({
      idle: [
        {
          equipmentId: "pac",
          equipmentName: "PAC",
          watts: 1500,
          toleratedImportW: 0,
          runningUnmanaged: false,
        },
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("PAC")).toBeTruthy();
    expect(screen.getByText("At rest")).toBeTruthy();
    expect(screen.getByText("1500 W")).toBeTruthy(); // load
  });

  it("reads a claimless-but-running load as 'Unmanaged', not 'At rest'", () => {
    seed({
      idle: [
        {
          equipmentId: "heater",
          equipmentName: "Chauffe-eau",
          watts: 2200,
          toleratedImportW: 0,
          runningUnmanaged: true,
        },
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Unmanaged")).toBeTruthy();
    expect(screen.queryByText("At rest")).toBeNull();
  });

  it("renders granted, waiting and at-rest loads together, each with its state", () => {
    seed({
      grants: [
        {
          equipmentId: "pump",
          equipmentName: "Pompe Piscine",
          instanceId: "i-pump",
          watts: 600,
          sinceIso: "2026-08-17T08:00:00.000Z",
        },
      ],
      pending: [
        {
          equipmentId: "pacp",
          equipmentName: "PAC Piscine",
          instanceId: "i-pacp",
          watts: 1800,
          needW: 1700,
          toleratedImportW: 200,
          reasonWaiting: "insufficient-surplus:0",
          running: false,
        },
      ],
      idle: [
        { equipmentId: "pac", equipmentName: "PAC", watts: 1500, toleratedImportW: 0, runningUnmanaged: false },
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Granted")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("At rest")).toBeTruthy();
  });

  it("spells out the deficit context when the meter is importing", () => {
    seed({ availableSurplusW: -1091, idle: [
      { equipmentId: "pac", equipmentName: "PAC", watts: 1500, toleratedImportW: 0, runningUnmanaged: false },
    ] });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Importing 1.1 kW, no load can start yet.")).toBeTruthy();
  });
});
