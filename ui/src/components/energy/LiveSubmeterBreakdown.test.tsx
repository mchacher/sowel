/**
 * Issue #744 — the consumption breakdown must not present a stale reading as a
 * live one.
 *
 * These render the whole Live page, because the defect is exactly a mismatch
 * between two of its parts: the whole is rebuilt from the grid and solar meters
 * on every message, while each part carried whatever its own plug last said.
 * Testing the helper alone would not show that.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, within } from "../../test-utils";
import { BUDGET_FLOOR_MS } from "../../../../src/shared/reading-freshness";
import { MemoryRouter } from "react-router-dom";
import { LiveEnergyPage } from "./LiveEnergyPage";
import { useEquipments } from "../../store/useEquipments";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../hooks/useWsSubscription", () => ({ useWsSubscription: () => {} }));

const NOW = Date.parse("2026-08-14T12:00:00Z");

function meter(
  id: string,
  type: EquipmentWithDetails["type"],
  power: number,
  ageMs = 20_000,
  /**
   * The budget the engine resolved from this source's cadence (spec 175).
   * Defaults to the floor, i.e. a meter that streams: these fixtures are about
   * what the page does with an aged reading, not about how the age is judged.
   */
  freshnessBudgetMs: number = BUDGET_FLOOR_MS,
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
        lastUpdated: new Date(NOW - ageMs).toISOString(),
        freshnessBudgetMs,
        // The backend applies the 2-minute power window only to metering
        // equipment types, so a water_heater's power binding reports fresh
        // however old it is. That is the flag the card must not rely on.
        stale: false,
      },
    ],
    orderBindings: [],
  } as unknown as EquipmentWithDetails;
}

function seed(equipments: EquipmentWithDetails[]): void {
  useEquipments.setState({ equipments, fetchEquipments: async () => {} } as never);
}

/** The legend row for a submeter, as the reader sees it. */
function row(name: string): HTMLElement {
  const label = screen.getByText(name);
  const el = label.closest("div.grid");
  if (!el) throw new Error(`no legend row for ${name}`);
  return el as HTMLElement;
}

describe("Live consumption breakdown — stale parts (#744)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    seed([]);
  });
  afterEach(() => vi.useRealTimers());

  it("shows a stale submeter as unknown rather than as its last number", () => {
    // Measured on production during export: the water heater was drawing 560 W
    // and the card said 0 W, because its clamp had last reported 16 minutes
    // earlier. A stale 0 W reads as "this appliance is off", which is why
    // nobody questioned it.
    seed([
      meter("Grid", "main_energy_meter", -1077),
      meter("Solar", "energy_production_meter", 2710),
      meter("Piscine", "energy_meter", 1233, 40_000),
      meter("Chauffe-eau", "water_heater", 0, 16 * 60 * 1000),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    const stale = row("Chauffe-eau");
    expect(within(stale).getByText("—")).toBeTruthy();
    expect(within(stale).getByText(/reading outdated/)).toBeTruthy();
    expect(stale.textContent).not.toMatch(/\b0 W\b/);

    // The fresh one is untouched.
    expect(within(row("Piscine")).getByText(/1\.2/)).toBeTruthy();
  });

  it("shows no share at all for the stale part that used to print 776%", () => {
    // The reported screenshot: a 35 W house against a 275 W pool reading left
    // over from before the pump stopped.
    seed([
      meter("Grid", "main_energy_meter", -2675),
      meter("Solar", "energy_production_meter", 2710),
      meter("Piscine", "energy_meter", 275, 30 * 60 * 1000),
    ]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(container.textContent).not.toMatch(/776\s*%/);
    expect(within(row("Piscine")).getByText(/reading outdated/)).toBeTruthy();
    expect(within(row("Piscine")).queryByText(/%/)).toBeNull();
  });

  it("never renders a part at more than 100% when the parts genuinely overshoot", () => {
    // Every reading here is FRESH, so the clamp is what is under test rather
    // than the freshness rule. Two 900 W loads in a 100 W house is what a
    // clamp error or two meters read microseconds apart can produce.
    seed([
      meter("Grid", "main_energy_meter", 100),
      meter("Piscine", "energy_meter", 900),
      meter("PAC", "energy_meter", 900),
    ]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(within(row("Piscine")).getByText("100%")).toBeTruthy();
    for (const m of container.textContent?.matchAll(/(\d+)\s*%/g) ?? []) {
      expect(Number(m[1])).toBeLessThanOrEqual(100);
    }
  });

  it("keeps the donut inside one circle when the parts overshoot", () => {
    // A fresh overshoot is still possible (two meters read microseconds apart,
    // clamp error), and the arcs must not wrap over themselves when it happens.
    seed([
      meter("Grid", "main_energy_meter", 100),
      meter("Piscine", "energy_meter", 900),
      meter("PAC", "energy_meter", 900),
    ]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    const circles = [...container.querySelectorAll("circle[stroke-dasharray]")];
    expect(circles.length).toBeGreaterThan(0);
    // RADIUS in LiveSubmeterBreakdown.tsx. Getting this wrong by even a few
    // units turns the assertion into a tolerance for the overrun it exists to
    // catch.
    const circumference = 2 * Math.PI * 72;
    const drawn = circles.reduce((acc, c) => {
      const [len] = (c.getAttribute("stroke-dasharray") ?? "0 0").split(" ");
      return acc + Number(len);
    }, 0);
    // Sum of the painted arc lengths never exceeds the ring itself.
    expect(drawn).toBeLessThanOrEqual(circumference + 0.01);
  });

  it("ages a row out on the wall clock, with no equipment event", () => {
    // Before the tick, a row only aged out when something else re-rendered the
    // page. A home whose only sources poll every 300 s would recompute at the
    // poll, with the reading 0 s old, and the rule would never apply at all.
    seed([
      meter("Grid", "main_energy_meter", 1000),
      meter("Piscine", "energy_meter", 900, 30_000),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(within(row("Piscine")).queryByText(/reading outdated/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3 * 60 * 1000);
    });

    expect(within(row("Piscine")).getByText(/reading outdated/)).toBeTruthy();
  });

  it("says where a stale load's watts went", () => {
    // The row contributes nothing, but its consumption is still in the house
    // total, so it lands in the residual. Both facts are true and nothing on
    // screen used to connect them.
    seed([
      meter("Grid", "main_energy_meter", 1000),
      meter("Chauffe-eau", "water_heater", 560, 20 * 60 * 1000),
    ]);
    const { container } = render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(container.textContent).toMatch(/is not counted, so its consumption shows up in Other/);
  });

  it("agrees with its own centre label", () => {
    // The centre rounds to the nearest 5 W while the shares used to divide by
    // the unrounded total, so the two figures on screen contradicted each other.
    seed([
      meter("Grid", "main_energy_meter", 33.5),
      meter("PAC", "energy_meter", 10),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    // The flow diagram above shows the same house figure, so scope to the card.
    const card = screen.getByText("Consumption breakdown").closest(".bg-surface");
    if (!card) throw new Error("breakdown card not found");
    expect(within(card as HTMLElement).getByText("35")).toBeTruthy(); // donut centre
    expect(within(row("PAC")).getByText("29%")).toBeTruthy(); // 10 of 35
  });
});
