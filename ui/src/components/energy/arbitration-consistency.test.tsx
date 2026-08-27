import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, screen, within } from "../../test-utils";
import { ArbitrationSurface } from "./ArbitrationSurface";
import { useArbiter } from "../../store/useArbiter";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import * as api from "../../api";
import type {
  ArbiterLoadState,
  ArbiterPublicState,
  ArbiterTimeline as ArbiterTimelineData,
} from "../../types";

/**
 * Spec 165 — the point of the spec, asserted end to end: the roster pill and
 * the ribbon must say the same word for the same load at the same instant.
 * Before, each half resolved its own state (the browser flattened four arrays,
 * the engine replayed the journal), which is how spec 164's `granted-idle`
 * came to exist on the ribbon alone (#732).
 */
vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getArbiterState: vi.fn().mockRejectedValue(new Error("no network in test")),
  getArbiterTimeline: vi.fn(),
}));

const mockTimeline = api.getArbiterTimeline as unknown as ReturnType<typeof vi.fn>;

function seed(state: ArbiterLoadState): void {
  const publicState: ArbiterPublicState = {
    enabled: true,
    state: "active",
    availableSurplusW: 1200,
    productionDetected: true,
    loads: [
      {
        equipmentId: "heater",
        equipmentName: "Chauffe-eau",
        state,
        watts: 2200,
        needW: null,
        toleratedImportW: null,
        sinceIso: "2026-08-27T08:00:00.000Z",
      },
    ],
    dormant: false,
    grants: [],
    pending: [],
    suspensions: [],
    idle: [],
    priority: ["heater"],
    journal: [],
    surplusSeries: [],
  };
  useArbiter.setState({ state: publicState, loading: false });
  useEquipments.setState({ equipments: [] });
  useZones.setState({ tree: [] });

  const timeline: ArbiterTimelineData = {
    windowStartIso: "2026-08-27T02:00:00.000Z",
    windowEndIso: "2026-08-27T08:00:00.000Z",
    stepMin: 15,
    // The ribbon's CURRENT cell is the last one: same load, same instant.
    loads: [{ equipmentId: "heater", name: "Chauffe-eau", quarters: [state] }],
    surplus: [],
    journal: [],
  };
  mockTimeline.mockResolvedValue(timeline);
}

/** The word the ribbon puts on its current cell (its "hh:mm · state" title). */
function ribbonCellLabel(): string {
  const titles = [...document.querySelectorAll("[title]")]
    .map((el) => el.getAttribute("title") ?? "")
    .filter((t) => t.includes("·"));
  expect(titles, "the ribbon rendered no cell").not.toHaveLength(0);
  return titles[titles.length - 1].split("·").pop()?.trim() ?? "";
}

describe("spec 165 — the two halves of the surface agree", () => {
  beforeEach(() => {
    useArbiter.setState({ state: null, loading: false, timelineRev: 0 });
    mockTimeline.mockReset();
  });

  const CASES: ArbiterLoadState[] = ["granted", "granted-idle", "pending", "unmanaged", "idle"];

  for (const state of CASES) {
    it(`says the same word in the pill and on the ribbon for "${state}"`, async () => {
      seed(state);
      await act(async () => {
        render(<ArbitrationSurface />);
      });

      const pill = within(screen.getAllByRole("row")[1]).getByText(/\w/, {
        selector: "span.rounded-full",
      });
      expect(pill.textContent?.trim()).toBeTruthy();
      expect(ribbonCellLabel()).toBe(pill.textContent?.trim());
    });
  }
});
