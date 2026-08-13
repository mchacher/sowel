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

// #491: a pending claim whose load a recipe runs as a must-run fallback
// (running: true) must read as "running (no surplus)", never "waiting for
// surplus" — while a genuinely idle pending claim (running: false) still shows
// the waiting reason.
function pendingEntry(over: Partial<ArbiterPublicState["pending"][number]> = {}): ArbiterPublicState["pending"][number] {
  return {
    equipmentId: "pump",
    equipmentName: "Pompe Piscine",
    instanceId: "i-pump",
    watts: 600,
    needW: 300,
    toleratedImportW: 0,
    reasonWaiting: "insufficient-surplus:0",
    running: false,
    ...over,
  };
}

function seedState(pending: ArbiterPublicState["pending"]): void {
  const state: ArbiterPublicState = {
    enabled: true,
    state: "active",
    availableSurplusW: -1091,
    productionDetected: true,
    grants: [],
    pending,
    suspensions: [],
    journal: [],
    surplusSeries: [],
  };
  useArbiter.setState({ state, loading: false });
  useEquipments.setState({ equipments: [] });
  useZones.setState({ tree: [] });
}

describe("ArbitrationSurface pending rows (#491)", () => {
  beforeEach(() => {
    useArbiter.setState({ state: null, loading: false });
  });

  it("shows a running must-run fallback as 'running (no surplus)', not 'waiting'", () => {
    seedState([pendingEntry({ equipmentId: "pac", equipmentName: "PAC", watts: 2000, needW: 2000, running: true })]);
    render(<ArbitrationSurface />);

    expect(screen.getByText("running (no surplus)")).toBeTruthy();
    expect(screen.getByText("running on grid; will switch to surplus when available")).toBeTruthy();
    // It must NOT be presented as waiting for surplus.
    expect(screen.queryByText(/waiting for surplus/)).toBeNull();
  });

  it("keeps an idle pending claim showing the waiting reason", () => {
    seedState([pendingEntry({ running: false })]);
    render(<ArbitrationSurface />);

    expect(screen.getByText(/waiting for surplus \(needs 300 W\)/)).toBeTruthy();
    expect(screen.queryByText("running (no surplus)")).toBeNull();
  });

  it("renders each pending load with its own label when both states coexist", () => {
    seedState([
      pendingEntry({ equipmentId: "pac", equipmentName: "PAC", watts: 2000, needW: 2000, running: true }),
      pendingEntry({ running: false }),
    ]);
    render(<ArbitrationSurface />);

    expect(screen.getByText("running (no surplus)")).toBeTruthy();
    expect(screen.getByText(/waiting for surplus \(needs 300 W\)/)).toBeTruthy();
  });
});
