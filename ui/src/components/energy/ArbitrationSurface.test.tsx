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
    shortfallW: null,
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
    engageMarginW: 100,
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
    // #807 - thousands are separated by a thin space in the DOM; testing-library
    // normalizes it back to a plain one, which is what the matcher sees.
    expect(screen.getByText("1 500 W")).toBeTruthy();
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
    // #807 - the phone pill says just "Granted" (the full label is 150 px and
    // breaks the row); the dimmed dot carries the distinction there. Above
    // 640 px only the full label shows.
    expect(screen.getByText("Granted").className).toContain("sm:hidden");
    expect(screen.getByText("Granted (not consuming)").className).toContain("hidden sm:inline");
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
    // #807 - the need is what it takes to start the load, so it survives the
    // night; what the night removes is the waiting, and the gap says so.
    expect(screen.getByText("400 W")).toBeTruthy();
    expect(screen.getByText("not requested")).toBeTruthy();
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
      // #807 - the cell now opens with the priority rank; drop it.
      .map((row) => row.querySelector("td")?.textContent?.replace(/^[0-9]+/, ""));
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

describe("ArbitrationSurface need and gap columns (#807)", () => {
  beforeEach(() => {
    useArbiter.setState({ state: null, loading: false });
  });

  it("shows the need on every row that has watts, not only on a waiting one", () => {
    seed({
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          state: "granted",
          watts: 600,
          needW: 300,
        }),
        load({ equipmentId: "pac", equipmentName: "PAC", watts: 691, needW: 791 }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("300 W")).toBeTruthy(); // granted
    expect(screen.getByText("791 W")).toBeTruthy(); // at rest
  });

  it("renders a negative need as 0 W, never as a negative figure", () => {
    // A load tolerating more grid import than it draws starts with no surplus
    // at all. The engine keeps the figure truthful; the column rounds it up.
    seed({
      loads: [
        load({
          equipmentId: "pac",
          equipmentName: "PAC",
          watts: 691,
          needW: -209,
          toleratedImportW: 1000,
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("0 W")).toBeTruthy();
    expect(screen.queryByText("-209 W")).toBeNull();
  });

  it("renders a zero tolerance as 0 W, so the row arithmetic stays checkable", () => {
    seed({
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          watts: 600,
          needW: 700,
          toleratedImportW: 0,
        }),
      ],
    });
    render(<ArbitrationSurface />);

    // 600 + 100 margin - 0 = 700: a dash here would make that unverifiable.
    expect(screen.getByText("0 W")).toBeTruthy();
    expect(screen.getByText("700 W")).toBeTruthy();
  });

  it("separates thousands with a thin space", () => {
    seed({
      loads: [
        load({ equipmentId: "pacp", equipmentName: "PAC Piscine", watts: 1800, needW: 1850 }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("1 850 W")).toBeTruthy();
    expect(screen.queryByText("1850 W")).toBeNull();
  });

  it("gives every state a word in the gap column rather than a dash", () => {
    seed({
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          state: "granted",
          watts: 600,
          needW: 700,
        }),
        load({
          equipmentId: "heater",
          equipmentName: "Chauffe-eau",
          state: "granted-idle",
          watts: 624,
          needW: 574,
        }),
        load({ equipmentId: "pac", equipmentName: "PAC", watts: 691, needW: 0 }),
        load({
          equipmentId: "boiler",
          equipmentName: "Ballon",
          state: "unmanaged",
          watts: 800,
          needW: 900,
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getAllByText("covered")).toHaveLength(2); // granted + granted-idle
    expect(screen.getByText("not requested")).toBeTruthy(); // at rest
    expect(screen.getByText("outside arbitration")).toBeTruthy(); // unmanaged
  });

  it("shows the missing watts of a waiting claim, and why it waits", () => {
    seed({
      loads: [
        load({
          equipmentId: "pacp",
          equipmentName: "PAC Piscine",
          state: "pending",
          watts: 1800,
          needW: 1850,
          shortfallW: 650,
          toleratedImportW: 50,
          reasonWaiting: "insufficient-surplus:1200",
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("650 W")).toBeTruthy();
    expect(screen.getByText("waiting for surplus")).toBeTruthy();
  });

  it("names the blocking reason when the surplus is there but the claim is not granted", () => {
    seed({
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          state: "pending",
          watts: 600,
          needW: 700,
          shortfallW: 0,
          reasonWaiting: "min-off-cooldown",
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("cooling down")).toBeTruthy();
    // Nothing is missing, so no gap figure and no "waiting for surplus" line.
    expect(screen.queryByText("0 W")).toBeNull();
    expect(screen.queryByText("waiting for surplus")).toBeNull();
  });

  it("falls back to the confirming window for an unrecognised waiting reason", () => {
    seed({
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          state: "pending",
          watts: 600,
          needW: 700,
          shortfallW: 0,
          reasonWaiting: "insufficient-surplus:5000",
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("confirming")).toBeTruthy();
  });

  it("names the load about to switch, and what it is short by", () => {
    seed({
      availableSurplusW: 1200,
      loads: [
        load({
          equipmentId: "pump",
          equipmentName: "Pompe",
          state: "granted",
          watts: 600,
          needW: 400,
        }),
        load({
          equipmentId: "pacp",
          equipmentName: "PAC Piscine",
          state: "pending",
          watts: 1800,
          needW: 1850,
          shortfallW: 650,
        }),
      ],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Next to switch")).toBeTruthy();
    // Once in its roster row, once in the panel.
    expect(screen.getAllByText("PAC Piscine")).toHaveLength(2);
    expect(screen.getByText("Starts at 1 850 W, short by 650 W")).toBeTruthy();
  });

  it("states the arithmetic with the configured margin", () => {
    seed({
      engageMarginW: 250,
      loads: [load({ equipmentId: "pump", equipmentName: "Pompe", watts: 600, needW: 850 })],
    });
    render(<ArbitrationSurface />);

    expect(screen.getByText("Need = load + 250 W margin - tolerance")).toBeTruthy();
  });

  it("drops the columns by tier so a phone never scrolls sideways", () => {
    seed({
      loads: [load({ equipmentId: "pump", equipmentName: "Pompe", watts: 600, needW: 700 })],
    });
    render(<ArbitrationSurface />);

    const header = (label: string) =>
      screen.getAllByRole("columnheader").find((th) => th.textContent === label);
    // Below 640 px: equipment, state and gap only — the three that answer
    // "who has the surplus, and what blocks the next one".
    expect(header("Equipment")?.className).not.toContain("hidden");
    expect(header("State")?.className).not.toContain("hidden");
    expect(header("Gap")?.className).not.toContain("hidden");
    expect(header("Need")?.className).toContain("hidden sm:table-cell");
    expect(header("Load")?.className).toContain("hidden lg:table-cell");
    expect(header("Tolerates")?.className).toContain("hidden lg:table-cell");
  });

  it("hides the context panel at night, where the dormant line already explains", () => {
    seed({
      dormant: true,
      availableSurplusW: 0,
      loads: [load({ equipmentId: "pump", equipmentName: "Pompe", watts: 600, needW: 700 })],
    });
    render(<ArbitrationSurface />);

    expect(screen.queryByText("Available surplus")).toBeNull();
    expect(screen.getAllByText("not requested")).toHaveLength(1);
  });
});
