/**
 * Characterization test for the Live energy diagram (spec 157).
 *
 * Written BEFORE the FlowDiagram extraction and kept afterwards: it pins the
 * rendering this page had in v1.53.0 so the refactor can be proven not to move
 * a single path, colour or label. The page had no test of its own, and it is
 * the one production surface the extraction puts at risk.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "../../test-utils";
import { BUDGET_FLOOR_MS } from "../../../../src/shared/reading-freshness";
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
    seed([meter("grid", "main_energy_meter", 1000), meter("pv", "energy_production_meter", 0)]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(strokesFor(container, PATH_GRID_TO_HOUSE)).toContain("var(--color-energy-grid)");
    expect(strokesFor(container, PATH_SOLAR_TO_HOUSE)).toEqual(["var(--color-border)"]);
    expect(strokesFor(container, PATH_SOLAR_TO_GRID)).toEqual(["var(--color-border)"]);
  });

  it("lights the export loop and greys the grid when exporting", () => {
    // Producing 2000 W, exporting 1500 W → house 500 W.
    seed([meter("grid", "main_energy_meter", -1500), meter("pv", "energy_production_meter", 2000)]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(strokesFor(container, PATH_SOLAR_TO_GRID)).toContain("var(--color-solar-auto)");
    expect(strokesFor(container, PATH_SOLAR_TO_HOUSE)).toContain("var(--color-solar-auto)");
    // The grid leg carries nothing on export, so it stays skeleton-only.
    expect(strokesFor(container, PATH_GRID_TO_HOUSE)).toEqual(["var(--color-border)"]);
  });
});

describe("Live energy diagram — nodes and status", () => {
  it("labels the three nodes and formats the house total", () => {
    seed([meter("grid", "main_energy_meter", 1000), meter("pv", "energy_production_meter", 800)]);
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

  // Spec 197 (FR-E1) — the balance line replaces the status tag.
  it("states the import in words, with one large figure, and no status tag", () => {
    // The review's morning: 4.9 kW from the grid, 180 W of sun, 5 kW drawn.
    seed([meter("grid", "main_energy_meter", 4900), meter("pv", "energy_production_meter", 180)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const headline = screen.getByTestId("flow-headline");
    expect(headline.textContent).toContain("Grid import");
    expect(within(headline).getByText("4.9").parentElement?.className).toContain("text-value");
    expect(headline.textContent).toMatch(/The sun covers 4% of the 5(\.1)?\skW consumed/);
    for (const old of ["Solar-assisted", "Grid-assisted", "Solar surplus", "Grid only"]) {
      expect(screen.queryByText(old)).toBeNull();
    }
  });

  it("states the export, and says the house runs on the sun", () => {
    seed([meter("grid", "main_energy_meter", -1500), meter("pv", "energy_production_meter", 2000)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const headline = screen.getByTestId("flow-headline");
    expect(headline.textContent).toContain("Grid export");
    expect(within(headline).getByText("1.5")).toBeTruthy();
    expect(headline.textContent).toMatch(/The house consumes 500\sW, all of it from the sun/);
  });

  it("says import or export under the grid node, and nothing in balance", () => {
    seed([meter("grid", "main_energy_meter", 1000), meter("pv", "energy_production_meter", 800)]);
    const { unmount } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getByText("import")).toBeTruthy();
    expect(screen.queryByText("↑")).toBeNull();
    unmount();
    seed([meter("grid", "main_energy_meter", -400), meter("pv", "energy_production_meter", 800)]);
    const second = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getByText("export")).toBeTruthy();
    second.unmount();
    seed([meter("grid", "main_energy_meter", 2), meter("pv", "energy_production_meter", 800)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.queryByText("import")).toBeNull();
    expect(screen.queryByText("export")).toBeNull();
    expect(screen.getByTestId("flow-headline").textContent).toContain("Self-powered");
  });

  it("describes the whole flow to a screen reader in one sentence", () => {
    seed([meter("grid", "main_energy_meter", 4900), meter("pv", "energy_production_meter", 180)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(
      screen.getByRole("img", {
        name: /^Consumption 5(\.1)?\skW: 96% from the grid, importing 4\.9\skW; 4% from solar, producing 180\sW\.$/,
      }),
    ).toBeTruthy();
  });

  it("falls back to the consumption alone without a production source", () => {
    seed([meter("grid", "main_energy_meter", 1200)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const headline = screen.getByTestId("flow-headline");
    expect(headline.textContent).toContain("Consumption");
    expect(headline.querySelector("p")).toBeNull();
  });

  it("draws the routes by power tier", () => {
    // 4.9 kW from the grid, 180 W of sun: the widest and the thinnest route.
    seed([meter("grid", "main_energy_meter", 4900), meter("pv", "energy_production_meter", 180)]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const tierOf = (d: string) =>
      container.querySelector(`path[data-tier][d="${d}"]`)?.getAttribute("data-tier");
    expect(tierOf(PATH_GRID_TO_HOUSE)).toBe("3");
    expect(tierOf(PATH_SOLAR_TO_HOUSE)).toBe("1");
  });

  it("shows the share of consumption on each supplying leg", () => {
    // 1000 W grid + 1000 W solar → 50 / 50.
    seed([meter("grid", "main_energy_meter", 1000), meter("pv", "energy_production_meter", 1000)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getAllByText("50%").length).toBe(2);
  });

  it("falls back to the empty state with no sources at all", () => {
    seed([]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getByText("No sources detected")).toBeTruthy();
  });
});

// Spec 197 (FR-E1.1) — what the sentence under the figure says, rendered.
describe("Live energy headline — sentence", () => {
  const NOW = Date.parse("2026-11-08T08:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  /** A meter whose reading is `ageMs` old, judged as a streaming source. */
  const dated = (
    id: string,
    type: EquipmentWithDetails["type"],
    power: number,
    ageMs = 5_000,
  ): EquipmentWithDetails =>
    ({
      ...meter(id, type, power),
      dataBindings: [
        {
          id: `${id}-p`,
          alias: "power",
          category: "power",
          type: "number",
          value: power,
          lastUpdated: new Date(NOW - ageMs).toISOString(),
          freshnessBudgetMs: BUDGET_FLOOR_MS,
          stale: false,
        },
      ],
    }) as unknown as EquipmentWithDetails;

  it("says « No solar production » when the panels give nothing", () => {
    seed([dated("grid", "main_energy_meter", 1500), dated("pv", "energy_production_meter", 0)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const headline = screen.getByTestId("flow-headline");
    expect(headline.textContent).toContain("Grid import");
    expect(headline.textContent).toContain("No solar production");
  });

  it("ends the sentence with the age of a late grid reading, in the warning ink", () => {
    seed([
      dated("grid", "main_energy_meter", 1500, 12 * 60_000),
      dated("pv", "energy_production_meter", 300),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const age = within(screen.getByTestId("flow-headline")).getByText(/read 12\smin ago/);
    expect(age.className).toContain("text-warning-ink");
    expect(age.textContent).toMatch(/^ · /);
    // The figure stays.
    expect(within(screen.getByTestId("flow-headline")).getByText("1.5")).toBeTruthy();
  });

  it("adds no age while every reading is current", () => {
    seed([dated("grid", "main_energy_meter", 1500), dated("pv", "energy_production_meter", 300)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getByTestId("flow-headline").textContent).not.toMatch(/ago/);
  });
});

// Spec 197 (FR-E3.1) — from `lg`, flow and breakdown share one row; below it,
// the stacking of before: flow, phases, breakdown.
describe("Live energy page — layout", () => {
  it("lets the flow card take the row when there is nothing for the right column", () => {
    seed([meter("grid", "main_energy_meter", 1000), meter("pv", "energy_production_meter", 400)]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const row = screen.getByText("Live flows").closest(".card")!.parentElement as HTMLElement;
    const aside = row.querySelector("[data-live-aside]") as HTMLElement;
    expect(aside.childElementCount).toBe(0);
    expect(row.className).toContain("lg:has-[>[data-live-aside]:empty]:grid-cols-1");
  });

  it("lights no route for a flow under 5 W", () => {
    seed([meter("grid", "main_energy_meter", 3), meter("pv", "energy_production_meter", 900)]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(strokesFor(container, PATH_GRID_TO_HOUSE)).toEqual(["var(--color-border)"]);
    expect(screen.getAllByTestId("flow-end-cap").map((c) => c.dataset.edge)).toEqual([
      "rightToFocal",
    ]);
  });

  it("puts the flow and the breakdown side by side from lg, the phases under the breakdown", () => {
    seed([
      {
        ...meter("grid", "main_energy_meter", 1000),
        dataBindings: [
          { id: "p", alias: "power", category: "power", value: 1000 },
          { id: "l1", alias: "power_l1", category: "power", value: 400 },
          { id: "l2", alias: "power_l2", category: "power", value: 600 },
        ],
      } as unknown as EquipmentWithDetails,
      meter("Piscine", "energy_meter", 400),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const card = (title: string) => screen.getByText(title).closest(".card") as HTMLElement;
    const flow = card("Live flows");
    const breakdown = card("Consumption breakdown");
    const phases = card("Phase breakdown");
    const row = flow.parentElement as HTMLElement;
    expect(row.className).toContain("lg:grid-cols-[7fr_5fr]");
    // The right column holds the breakdown, then the phases.
    expect(breakdown.parentElement).toBe(phases.parentElement);
    expect(breakdown.parentElement?.className).toMatch(/(^|\s)contents(\s|$)/);
    expect(
      breakdown.compareDocumentPosition(phases) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Below lg: flow, phases, breakdown.
    const order = (el: HTMLElement) => Number(/(?:^|\s)order-(\d)/.exec(el.className)?.[1]);
    expect([order(flow), order(phases), order(breakdown)]).toEqual([1, 2, 3]);
  });
});
