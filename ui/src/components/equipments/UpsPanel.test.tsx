import { describe, it, expect } from "vitest";
import { render, screen, within } from "../../test-utils";
import { UpsPanel } from "./UpsPanel";
import { ribbonWidth } from "../flow/flow-geometry";
import type { DataBindingWithValue } from "../../types";

/** Build the binding set an APC behind the NUT plugin actually produces. */
function bindings(over: Record<string, unknown> = {}): DataBindingWithValue[] {
  const base: Record<string, { v: unknown; cat: string; unit?: string }> = {
    status: { v: "online", cat: "ups_status" },
    battery: { v: 100, cat: "battery", unit: "%" },
    battery_runtime: { v: 3584, cat: "battery_runtime", unit: "s" },
    load: { v: 4, cat: "ups_load", unit: "%" },
    input_voltage: { v: 237, cat: "voltage", unit: "V" },
    battery_voltage: { v: 13.6, cat: "voltage", unit: "V" },
    estimated_power: { v: 21, cat: "generic", unit: "W" },
    nominal_power: { v: 520, cat: "generic", unit: "W" },
    input_voltage_nominal: { v: 230, cat: "generic", unit: "V" },
    transfer_low: { v: 145, cat: "generic", unit: "V" },
    transfer_high: { v: 295, cat: "generic", unit: "V" },
    battery_charge_low: { v: 10, cat: "generic", unit: "%" },
    battery_runtime_low: { v: 120, cat: "generic", unit: "s" },
    charging: { v: false, cat: "generic" },
    serial: { v: "XX0000X00000", cat: "generic" },
    beeper: { v: "enabled", cat: "generic" },
  };
  for (const [k, v] of Object.entries(over)) {
    if (base[k]) base[k] = { ...base[k], v };
    else base[k] = { v, cat: "generic" };
  }
  return Object.entries(base).map(([alias, d], i) => ({
    id: `b${i}`,
    alias,
    category: d.cat,
    value: d.v,
    unit: d.unit,
  })) as unknown as DataBindingWithValue[];
}

/** The diagram's node with this label, to read its figures apart from the headline. */
const nodeOf = (label: string) => screen.getByText(label).closest("[data-slot]") as HTMLElement;

const paintedStrokes = (c: HTMLElement) =>
  [...c.querySelectorAll("path")]
    .map((p) => p.getAttribute("stroke"))
    .filter((s) => s && s !== "none" && s !== "var(--color-border)");

describe("UpsPanel on mains", () => {
  it("puts the three live values on the diagram, one per node", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    expect(within(nodeOf("Protected load")).getByText("21")).toBeTruthy(); // load, watts
    expect(within(nodeOf("Mains")).getByText("237")).toBeTruthy(); // mains, volts
    expect(within(nodeOf("Battery")).getByText("100")).toBeTruthy(); // battery, percent
    // The runtime is the headline's figure, no longer the battery node's sub.
    expect(within(nodeOf("Battery")).queryByText("59 min")).toBeNull();
  });

  it("lights the mains branch and leaves the battery branch dark", () => {
    const { container } = render(<UpsPanel dataBindings={bindings()} />);
    expect(paintedStrokes(container)).toContain("var(--color-energy-grid)");
    expect(paintedStrokes(container)).not.toContain("var(--color-error)");
  });

  // Spec 197 (FR-E1.6) — the same balance line as Live: the state, then the
  // load it carries, then the autonomy that leaves.
  it("reads its status as the headline: state, runtime, then load and battery", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    const headline = screen.getByTestId("flow-headline");
    expect(headline.textContent).toContain("On mains");
    expect(within(headline).getByText("59").parentElement?.className).toContain("text-value");
    expect(within(headline).getByText("min")).toBeTruthy();
    expect(headline.textContent).toMatch(/Battery runtime · load 21\sW · battery 100\s?%/);
    expect(screen.getByTestId("flow-headline-dot").style.background).toBe(
      "var(--color-energy-grid)",
    );
  });

  it("quotes a load given only in percent in the sentence", () => {
    const pctOnly = bindings().filter((b) => b.alias !== "estimated_power");
    render(<UpsPanel dataBindings={pctOnly} />);
    expect(screen.getByTestId("flow-headline").textContent).toMatch(/load 4\s?%/);
  });

  it("falls back to the load, named, when the runtime is unknown", () => {
    const noRuntime = bindings().filter(
      (b) => b.alias !== "battery_runtime" && b.alias !== "estimated_power",
    );
    render(<UpsPanel dataBindings={noRuntime} />);
    const headline = screen.getByTestId("flow-headline");
    expect(within(headline).getByText("4")).toBeTruthy();
    expect(within(headline).getByText("% of capacity")).toBeTruthy();
    expect(headline.textContent).toMatch(/Battery 100\s?%$/);
  });

  it("shows a dash when neither the runtime nor the load can be read", () => {
    const none = bindings().filter(
      (b) => !["estimated_power", "load", "battery_runtime"].includes(b.alias),
    );
    render(<UpsPanel dataBindings={none} />);
    expect(within(screen.getByTestId("flow-headline")).getByText("—")).toBeTruthy();
  });

  it("draws the mains ribbon as wide as the load", () => {
    const { container, rerender } = render(<UpsPanel dataBindings={bindings()} />);
    const width = () => container.querySelector("g[data-edge]")?.getAttribute("data-width");
    expect(width()).toBe(String(ribbonWidth(21)));
    rerender(<UpsPanel dataBindings={bindings({ real_power: 900 })} />);
    expect(width()).toBe(String(ribbonWidth(900)));
  });

  // Spec 197 (FR-E7) — levels, not splits: the load in the source's colour,
  // the battery's charge; no figure repeated on the bars, none on the routes.
  it("shows the load and the battery charge as level bars", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    const level = (label: string) =>
      within(nodeOf(label))
        .getByTestId("flow-share-bar")
        .querySelector<HTMLElement>("[data-share]")!;
    expect(level("Protected load").style.width).toBe("4%");
    expect(level("Protected load").style.background).toBe("var(--color-energy-grid)");
    expect(
      within(nodeOf("Battery")).getByTestId("flow-share-bar").querySelectorAll("[data-share]"),
    ).toHaveLength(1);
    expect(within(nodeOf("Mains")).queryByTestId("flow-share-bar")).toBeNull();
    for (const bar of screen.getAllByTestId("flow-share-bar")) expect(bar.textContent).toBe("");
  });

  it("lights the charge loop only while the UPS is charging", () => {
    const { container, rerender } = render(<UpsPanel dataBindings={bindings()} />);
    expect(screen.queryByText("charging")).toBeNull();
    rerender(<UpsPanel dataBindings={bindings({ charging: true })} />);
    // « charging » is the battery's sub-line now, not a pill on the route.
    expect(within(nodeOf("Battery")).getByText("charging")).toBeTruthy();
    expect(paintedStrokes(container)).toContain("var(--color-solar-auto)");
  });
});

describe("UpsPanel during an outage", () => {
  const outage = () =>
    bindings({ status: "low_battery", battery: 14, battery_runtime: 360, input_voltage: null });

  it("greys the mains node and reads absent", () => {
    render(<UpsPanel dataBindings={outage()} />);
    expect(screen.getByText("absent")).toBeTruthy();
  });

  it("lights the battery branch in the severity colour", () => {
    const { container } = render(<UpsPanel dataBindings={outage()} />);
    expect(paintedStrokes(container)).toContain("var(--color-error)");
    expect(paintedStrokes(container)).not.toContain("var(--color-energy-grid)");
  });

  it("says the time left once, as the headline, not again on the route", () => {
    render(<UpsPanel dataBindings={outage()} />);
    expect(screen.queryByText("6 min")).toBeNull();
    expect(within(screen.getByTestId("flow-headline")).getByText("6")).toBeTruthy();
  });

  it("draws the load and the battery level in the severity colour on battery", () => {
    render(<UpsPanel dataBindings={outage()} />);
    const level = (label: string) =>
      within(nodeOf(label))
        .getByTestId("flow-share-bar")
        .querySelector<HTMLElement>("[data-share]")!;
    expect(level("Battery").style.width).toBe("14%");
    expect(level("Battery").style.background).toBe("var(--color-error)");
    expect(level("Protected load").style.background).toBe("var(--color-error)");
  });

  it("tells a screen reader the status before the flow", () => {
    render(<UpsPanel dataBindings={outage()} />);
    expect(screen.getByRole("img", { name: /^Battery low\. Mains absent\./ })).toBeTruthy();
  });

  it("reads the time left as the headline, the battery and the load as its sentence", () => {
    render(<UpsPanel dataBindings={outage()} />);
    const headline = screen.getByTestId("flow-headline");
    expect(headline.textContent).toContain("Battery low");
    expect(within(headline).getByText("6").parentElement?.className).toContain("text-value");
    expect(within(headline).getByText("min")).toBeTruthy();
    expect(headline.textContent).toMatch(/Battery 14\s?% · load 21\sW$/);
    expect(screen.getByTestId("flow-headline-dot").style.background).toBe("var(--color-error)");
  });

  it("still draws the battery route with its end head on battery", () => {
    render(<UpsPanel dataBindings={outage()} />);
    const caps = screen.getAllByTestId("flow-end-cap");
    expect(caps.map((c) => c.dataset.edge)).toEqual(["rightToFocal"]);
  });

  it("flags the margins as critical", () => {
    render(<UpsPanel dataBindings={outage()} />);
    expect(screen.getByText("Critical")).toBeTruthy();
  });
});

describe("UpsPanel margins", () => {
  it("shows the thresholds, which appear nowhere else", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    expect(screen.getByText("145 – 295 V")).toBeTruthy();
    expect(screen.getByText("520 W")).toBeTruthy();
    expect(screen.getByText(/^10\s?% · 2 min$/)).toBeTruthy();
  });

  it("summarises a healthy unit as comfortable", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    expect(screen.getByText("Comfortable")).toBeTruthy();
  });

  it("calls a heavily loaded unit tight", () => {
    render(<UpsPanel dataBindings={bindings({ load: 92 })} />);
    expect(screen.getByText("Tight")).toBeTruthy();
  });

  it("hides the whole card when the unit reports no thresholds", () => {
    const bare = [
      { id: "1", alias: "status", category: "ups_status", value: "online" },
      { id: "2", alias: "battery", category: "battery", value: 80 },
    ] as unknown as DataBindingWithValue[];
    render(<UpsPanel dataBindings={bare} />);
    expect(screen.queryByText("Margins & thresholds")).toBeNull();
  });
});

describe("UpsPanel technical sheet", () => {
  it("translates the field names instead of showing plugin aliases", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    expect(screen.getByText("Serial number")).toBeTruthy();
    expect(screen.getByText("Buzzer")).toBeTruthy();
    expect(screen.queryByText("battery_charge_low")).toBeNull();
  });

  it("never repeats a value the diagram or the margins already show", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    for (const shown of ["Transfer to battery", "Output capacity", "Shutdown commanded"]) {
      expect(screen.getAllByText(shown)).toHaveLength(1);
    }
    // The nameplate rows the diagram never shows are the sheet's own.
    expect(screen.queryByText("Nominal battery voltage")).toBeNull();
    expect(screen.getByText("Battery voltage")).toBeTruthy();
  });

  it("renders a false flag as a dash rather than the word false", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    expect(screen.queryByText("false")).toBeNull();
  });

  it("does not repeat the output power the focal node already shows (spec 157 FR5)", () => {
    // The focal node reads the load from `estimated_power` (21 W); the sheet
    // must not list it again under "Estimated output power".
    render(<UpsPanel dataBindings={bindings()} />);
    expect(within(nodeOf("Protected load")).getByText("21")).toBeTruthy(); // still on the diagram
    expect(screen.queryByText("Estimated output power")).toBeNull();
  });

  it("hides a measured output power from the sheet too, since it feeds the node", () => {
    render(<UpsPanel dataBindings={bindings({ real_power: 33 })} />);
    expect(within(nodeOf("Protected load")).getByText("33")).toBeTruthy(); // real_power wins
    expect(screen.queryByText("Measured output power")).toBeNull();
    expect(screen.queryByText("Estimated output power")).toBeNull();
  });
});
