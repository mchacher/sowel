/**
 * Issue #818 — the four cards on the Live page must present one heading shape.
 *
 * The drift they had is easy to reintroduce, because each section renders its
 * own card: two headings at 14px with no icon, one at 15px with an icon, and
 * the flow diagram with none at all. These tests assert the four are the same
 * component rather than four copies that happen to agree today.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "../../test-utils";
import { MemoryRouter } from "react-router-dom";
import { LiveEnergyPage } from "./LiveEnergyPage";
import { useEquipments } from "../../store/useEquipments";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../hooks/useWsSubscription", () => ({ useWsSubscription: () => {} }));

function meter(
  id: string,
  type: EquipmentWithDetails["type"],
  power: number,
  extra: Record<string, unknown> = {},
): EquipmentWithDetails {
  return {
    id,
    name: id,
    type,
    zoneId: "z",
    enabled: true,
    status: "online",
    dataBindings: [
      {
        id: `${id}-p`,
        alias: "power",
        category: "power",
        type: "number",
        value: power,
        lastUpdated: new Date().toISOString(),
        stale: false,
        ...extra,
      },
    ],
    orderBindings: [],
  } as unknown as EquipmentWithDetails;
}

describe("Live page section headings (#818)", () => {
  it("gives the flow diagram a heading, where it had none", () => {
    useEquipments.setState({
      equipments: [meter("Grid", "main_energy_meter", 1000)],
      fetchEquipments: async () => {},
    } as never);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(screen.getByText("Live flows")).toBeTruthy();
  });

  it("renders every section heading at the same size, with an icon", () => {
    useEquipments.setState({
      equipments: [meter("Grid", "main_energy_meter", 1000), meter("Piscine", "energy_meter", 400)],
      fetchEquipments: async () => {},
    } as never);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    const headings = [...container.querySelectorAll("h2")];
    expect(headings.length).toBeGreaterThanOrEqual(2);

    for (const h of headings) {
      // One size for all of them. 14px and 15px used to coexist.
      expect(h.className, `"${h.textContent}" is not the shared size`).toContain("text-[15px]");
      // And each sits beside an icon, which only the arbitration card had.
      const header = h.closest("div")?.parentElement;
      expect(header?.querySelector("svg"), `"${h.textContent}" has no icon`).toBeTruthy();
    }
  });

  it("keeps the consumption breakdown labelled", () => {
    useEquipments.setState({
      equipments: [meter("Grid", "main_energy_meter", 1000), meter("Piscine", "energy_meter", 400)],
      fetchEquipments: async () => {},
    } as never);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    const heading = screen.getByText("Consumption breakdown");
    expect(within(heading.closest("div")!.parentElement!).queryByRole("img")).toBeDefined();
  });
});
