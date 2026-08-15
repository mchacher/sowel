import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { ChartTooltip } from "./ChartTooltip";
import type { TooltipSeries } from "./tooltip-format";

// Matches the Recharts-injected payload shape ChartTooltip consumes.
type Entry = { name?: string; value?: number | string | number[]; payload?: Record<string, number> };

const TS = Date.UTC(2026, 6, 21, 2, 0); // fixed timestamp for the header

const temp: TooltipSeries = {
  id: "eq1:temp",
  alias: "temp",
  category: "temperature",
  deviceName: "Thermo",
  sameCategoryCount: 1,
  equipmentName: "Thermostat",
  zoneName: "Salon",
  color: "#123456",
};

const state: TooltipSeries = {
  id: "eq2:state",
  alias: "state",
  category: "light_state",
  deviceName: "Relay",
  sameCategoryCount: 1,
  equipmentName: "Chauffe-eau",
  zoneName: "",
  color: "#abcdef",
};

// A realistic Recharts payload for a mixed chart with the envelope band on:
// the mean Line (name = series id), the band Area (name = "id:band", value is a
// [lo, hi] tuple), and a state Line.
const payload: Entry[] = [
  { name: "eq1:temp", value: 20.5, payload: { time: TS, "eq1:temp:min": 19, "eq1:temp:max": 22 } },
  { name: "eq1:temp:band", value: [19, 22], payload: { time: TS } },
  { name: "eq2:state", value: 1, payload: { time: TS } },
];

describe("ChartTooltip (#498, point 4)", () => {
  it("renders one row per real series and skips the envelope band entry", () => {
    render(<ChartTooltip active payload={payload} series={[temp, state]} />);
    // Two data series → exactly two rows; the ":band" tuple entry is dropped.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // The band tuple must never surface as text.
    expect(screen.queryByText(/19\s*,\s*22/)).toBeNull();
  });

  it("formats the measurement value with unit and band inline", () => {
    render(<ChartTooltip active payload={payload} series={[temp, state]} />);
    expect(screen.getByText(/20\.5\s*°C\s*\(19 \/ 22\)/)).toBeTruthy();
    expect(screen.getByText(/Salon \/ Thermostat/)).toBeTruthy();
  });

  it("renders nothing when inactive or empty", () => {
    const { container: c1 } = render(<ChartTooltip active={false} payload={payload} series={[temp]} />);
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(<ChartTooltip active payload={[]} series={[temp]} />);
    expect(c2.firstChild).toBeNull();
  });

  it("drops rows whose value is not finite", () => {
    const p: Entry[] = [{ name: "eq1:temp", value: undefined, payload: { time: TS } }];
    const { container } = render(<ChartTooltip active payload={p} series={[temp]} />);
    // No finite value → no rows → whole card returns null.
    expect(container.firstChild).toBeNull();
  });
});
