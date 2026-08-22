import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { UpsPanel } from "./UpsPanel";
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

const paintedStrokes = (c: HTMLElement) =>
  [...c.querySelectorAll("path")]
    .map((p) => p.getAttribute("stroke"))
    .filter((s) => s && s !== "none" && s !== "var(--color-border)");

describe("UpsPanel on mains", () => {
  it("puts the three live values on the diagram, one per node", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    expect(screen.getByText("21")).toBeTruthy();   // load, watts
    expect(screen.getByText("237")).toBeTruthy();  // mains, volts
    expect(screen.getByText("100")).toBeTruthy();  // battery, percent
    expect(screen.getByText("59 min")).toBeTruthy(); // autonomy, as a duration
  });

  it("lights the mains branch and leaves the battery branch dark", () => {
    const { container } = render(<UpsPanel dataBindings={bindings()} />);
    expect(paintedStrokes(container)).toContain("var(--color-energy-grid)");
    expect(paintedStrokes(container)).not.toContain("var(--color-error)");
  });

  it("names the state in the tag", () => {
    render(<UpsPanel dataBindings={bindings()} />);
    expect(screen.getByText("On mains")).toBeTruthy();
  });

  it("lights the charge loop only while the UPS is charging", () => {
    const { container, rerender } = render(<UpsPanel dataBindings={bindings()} />);
    expect(screen.queryByText("charging")).toBeNull();
    rerender(<UpsPanel dataBindings={bindings({ charging: true })} />);
    expect(screen.getByText("charging")).toBeTruthy();
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

  it("moves the autonomy onto the active branch as a pill", () => {
    render(<UpsPanel dataBindings={outage()} />);
    expect(screen.getByText("6 min")).toBeTruthy();
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
    expect(screen.getByText("10 % · 2 min")).toBeTruthy();
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
    for (const shown of [
      "Transfer to battery",
      "Output capacity",
      "Shutdown commanded",
    ]) {
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
});
