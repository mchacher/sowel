import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { SensorValues } from "./SensorValues";
import type { DataBindingWithValue } from "../../types";

// Spec 196, FR-1 — the weather station's values ran over its name on a phone.
// layout="wrap" lets them break onto further lines; the default stays a
// single non-shrinking row for the three other callers.

function binding(
  id: string,
  category: DataBindingWithValue["category"],
  value: unknown,
  unit?: string,
): DataBindingWithValue {
  return {
    id,
    equipmentId: "eq-1",
    deviceDataId: `dd-${id}`,
    alias: id,
    deviceId: "dev-1",
    deviceName: "Station",
    key: id,
    type: "number",
    category,
    value,
    unit,
    lastUpdated: null,
    lastChanged: null,
    stale: false,
  };
}

const bindings = [
  binding("humidity", "humidity", 84, "%"),
  binding("noise", "noise", 45, "dB"),
  binding("pressure", "pressure", 1021.7, "mbar"),
];

function valuesContainer(): HTMLElement {
  const first = screen.getByText(/84/);
  // value text → value span → values container
  return first.closest("span.tabular-nums")!.parentElement as HTMLElement;
}

describe("SensorValues layout", () => {
  it('wraps its values and lets them shrink with layout="wrap"', () => {
    render(<SensorValues sensorBindings={bindings} batteryBindings={[]} layout="wrap" />);
    const container = valuesContainer();
    expect(container.className).toContain("flex-wrap");
    expect(container.className).toContain("min-w-0");
    expect(container.className).not.toContain("flex-shrink-0");
    for (const value of Array.from(container.children)) {
      expect(value.className).not.toContain("flex-shrink-0");
    }
  });

  it("keeps the default row unchanged (no wrap, values do not shrink)", () => {
    render(<SensorValues sensorBindings={bindings} batteryBindings={[]} />);
    const container = valuesContainer();
    expect(container.className).not.toContain("flex-wrap");
    expect(container.className).toContain("flex-shrink-0");
    for (const value of Array.from(container.children)) {
      expect(value.className).toContain("flex-shrink-0");
    }
  });

  it('stacks the values with layout="column"', () => {
    render(<SensorValues sensorBindings={bindings} batteryBindings={[]} layout="column" />);
    expect(valuesContainer().className).toContain("flex-col");
  });
});

// Spec 196, slice 2a — a remote's last action read « single 35m04s »: the raw
// action value instead of its label.
describe("SensorValues button action", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the action with its translated label", async () => {
    await i18n.changeLanguage("fr");
    render(
      <SensorValues
        sensorBindings={[binding("action", "action", "single")]}
        batteryBindings={[]}
      />,
    );
    expect(screen.getByText("Appui simple")).toBeTruthy();
    expect(screen.queryByText("single")).toBeNull();
  });

  it("falls back to the raw value for an action it has no label for", async () => {
    await i18n.changeLanguage("fr");
    render(
      <SensorValues
        sensorBindings={[binding("action", "action", "brightness_step_up")]}
        batteryBindings={[]}
      />,
    );
    expect(screen.getByText("brightness_step_up")).toBeTruthy();
  });
});
