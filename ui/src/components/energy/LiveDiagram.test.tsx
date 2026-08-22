/**
 * Characterization test for the Live energy diagram (spec 157).
 *
 * Written BEFORE the FlowDiagram extraction and kept afterwards: it pins the
 * rendering this page had in v1.53.0 so the refactor can be proven not to move
 * a single path, colour or label. The page had no test of its own, and it is
 * the one production surface the extraction puts at risk.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { MemoryRouter } from "react-router-dom";
import { LiveEnergyPage } from "./LiveEnergyPage";
import { useEquipments } from "../../store/useEquipments";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../hooks/useWsSubscription", () => ({ useWsSubscription: () => {} }));

// The three Manhattan routes, verbatim from the v1.53.0 implementation.
const PATH_GRID_TO_HOUSE = "M 60 180 V 75 Q 60 65 70 65 H 270";
const PATH_SOLAR_TO_HOUSE = "M 480 180 V 75 Q 480 65 470 65 H 270";
const PATH_SOLAR_TO_GRID = "M 480 180 V 255 Q 480 270 470 270 H 70 Q 60 270 60 255 V 180";

function meter(
  id: string,
  type: EquipmentWithDetails["type"],
  power: number,
): EquipmentWithDetails {
  return {
    id,
    name: id,
    type,
    zoneId: "z",
    enabled: true,
    status: "online",
    dataBindings: [{ id: `${id}-p`, alias: "power", category: "power", value: power }],
    orderBindings: [],
  } as unknown as EquipmentWithDetails;
}

function seed(equipments: EquipmentWithDetails[]): void {
  useEquipments.setState({
    equipments,
    fetchEquipments: async () => {},
  } as never);
}

/** All <path d> values currently painted, with their stroke. */
function paths(container: HTMLElement): { d: string; stroke: string }[] {
  return [...container.querySelectorAll("path")].map((p) => ({
    d: p.getAttribute("d") ?? "",
    stroke: p.getAttribute("stroke") ?? "",
  }));
}

const strokesFor = (container: HTMLElement, d: string) =>
  paths(container)
    .filter((p) => p.d === d && p.stroke !== "none")
    .map((p) => p.stroke);

describe("Live energy diagram — geometry", () => {
  beforeEach(() => seed([]));

  it("always paints the three skeleton routes, whatever the flows", () => {
    seed([meter("grid", "main_energy_meter", 0)]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    for (const d of [PATH_GRID_TO_HOUSE, PATH_SOLAR_TO_HOUSE, PATH_SOLAR_TO_GRID]) {
      expect(strokesFor(container, d)).toContain("var(--color-border)");
    }
  });

  it("overlays only the routes actually carrying energy", () => {
    // Importing 1000 W, producing nothing: grid→house lit, the other two bare.
    seed([
      meter("grid", "main_energy_meter", 1000),
      meter("pv", "energy_production_meter", 0),
    ]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(strokesFor(container, PATH_GRID_TO_HOUSE)).toContain("var(--color-energy-grid)");
    expect(strokesFor(container, PATH_SOLAR_TO_HOUSE)).toEqual(["var(--color-border)"]);
    expect(strokesFor(container, PATH_SOLAR_TO_GRID)).toEqual(["var(--color-border)"]);
  });

  it("lights the export loop and greys the grid when exporting", () => {
    // Producing 2000 W, exporting 1500 W → house 500 W.
    seed([
      meter("grid", "main_energy_meter", -1500),
      meter("pv", "energy_production_meter", 2000),
    ]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(strokesFor(container, PATH_SOLAR_TO_GRID)).toContain("var(--color-solar-auto)");
    expect(strokesFor(container, PATH_SOLAR_TO_HOUSE)).toContain("var(--color-solar-auto)");
    // The grid leg carries nothing on export, so it stays skeleton-only.
    expect(strokesFor(container, PATH_GRID_TO_HOUSE)).toEqual(["var(--color-border)"]);
  });
});

describe("Live energy diagram — nodes and status", () => {
  it("labels the three nodes and formats the house total", () => {
    seed([
      meter("grid", "main_energy_meter", 1000),
      meter("pv", "energy_production_meter", 800),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getByText("Consumption")).toBeTruthy();
    expect(screen.getByText("Grid")).toBeTruthy();
    expect(screen.getByText("Production")).toBeTruthy();
    // 1000 + 800 = 1800 W → kW with one decimal.
    expect(screen.getByText("1.8")).toBeTruthy();
  });

  it("rounds sub-kilowatt values to the nearest 5 W", () => {
    seed([meter("grid", "main_energy_meter", 183)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getAllByText("185").length).toBeGreaterThan(0);
  });

  it("names the qualitative status", () => {
    seed([
      meter("grid", "main_energy_meter", -1500),
      meter("pv", "energy_production_meter", 2000),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getByText("Solar surplus")).toBeTruthy();
  });

  it("shows the share of consumption on each supplying leg", () => {
    // 1000 W grid + 1000 W solar → 50 / 50.
    seed([
      meter("grid", "main_energy_meter", 1000),
      meter("pv", "energy_production_meter", 1000),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getAllByText("50%").length).toBe(2);
  });

  it("falls back to the empty state with no sources at all", () => {
    seed([]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getByText("No sources detected")).toBeTruthy();
  });
});
