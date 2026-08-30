/**
 * Spec 168 — the wiring, not the rendering.
 *
 * The strip and the panel are each covered where they live. What no test
 * covered is that anything hands them to the user: delete one prop in
 * EquipmentWidget, or the sheet's forecast branch, and the desktop feature is
 * gone with a green suite. These are the two assertions that fail if it is.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { EquipmentWidget } from "./EquipmentWidget";
import { MobileWidgetCard } from "./MobileWidgetCard";
import { EquipmentDetailSheet } from "./WidgetDetailSheet";
import type { DashboardWidget, DataBindingWithValue, EquipmentWithDetails } from "../../types";

function binding(alias: string, value: unknown): DataBindingWithValue {
  return {
    id: "b-" + alias,
    equipmentId: "eq",
    deviceDataId: "dd-" + alias,
    deviceId: "d1",
    deviceName: "Open-Meteo",
    key: alias,
    alias,
    type: typeof value === "number" ? "number" : "string",
    category: "generic",
    value,
    lastUpdated: new Date().toISOString(),
    lastChanged: new Date().toISOString(),
    stale: false,
  } as unknown as DataBindingWithValue;
}

const CONFIDENCES = ["high", "medium", "low", "medium", "high"];

function forecastEquipment(): EquipmentWithDetails {
  const bindings: DataBindingWithValue[] = [];
  for (let i = 0; i < 5; i++) {
    const n = i + 1;
    bindings.push(binding(`j${n}_condition`, "cloudy"));
    bindings.push(binding(`j${n}_temp_max`, 20 + i));
    bindings.push(binding(`j${n}_temp_min`, 12 + i));
    bindings.push(binding(`j${n}_confidence`, CONFIDENCES[i]));
  }
  return {
    id: "eq",
    name: "Weather Forecast",
    type: "weather_forecast",
    zoneId: "z",
    enabled: true,
    status: "online",
    dataBindings: bindings,
    orderBindings: [],
  } as unknown as EquipmentWithDetails;
}

const widget: DashboardWidget = {
  id: "w-1",
  type: "equipment",
  equipmentId: "eq",
  displayOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
} as DashboardWidget;

/** The confidence dot the tile shows for tomorrow. */
const dots = (c: HTMLElement) =>
  [...c.querySelectorAll("span")].filter((s) => s.className.includes("w-1.5"));

describe("forecast tile wiring (spec 168)", () => {
  it("desktop: EquipmentWidget hands the tile its detail handler, and the click reaches it", () => {
    const onOpenDetail = vi.fn();
    const { container } = render(
      <EquipmentWidget
        widget={widget}
        equipment={forecastEquipment()}
        onExecuteOrder={vi.fn()}
        onOpenDetail={onOpenDetail}
      />,
    );
    const card = container.querySelector(".cursor-pointer");
    expect(card).not.toBeNull();
    (card as HTMLElement).click();
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("desktop: the tile qualifies tomorrow", () => {
    const { container } = render(
      <EquipmentWidget
        widget={widget}
        equipment={forecastEquipment()}
        onExecuteOrder={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );
    expect(dots(container)).toHaveLength(1);
    expect(container.textContent).toContain("reliable");
  });

  it("desktop: no handler, no click affordance", () => {
    // Edit mode: the card is being dragged, a tap must not open anything.
    const { container } = render(
      <EquipmentWidget widget={widget} equipment={forecastEquipment()} onExecuteOrder={vi.fn()} />,
    );
    expect(container.querySelector(".cursor-pointer")).toBeNull();
  });

  it("mobile: the phone tile qualifies tomorrow too", () => {
    // The phone card is a different component with its own forecast branch;
    // the mark has to be wired there too or the feature is missing on the
    // surface this dashboard is mostly read on.
    const { container } = render(
      <MobileWidgetCard
        widget={widget}
        equipment={forecastEquipment()}
        onClick={vi.fn()}
        editMode={false}
      />,
    );
    expect(dots(container)).toHaveLength(1);
    expect(container.textContent).toContain("reliable");
  });

  it("mobile: tapping the card fires the handler that opens the panel", () => {
    const onClick = vi.fn();
    const { container } = render(
      <MobileWidgetCard
        widget={widget}
        equipment={forecastEquipment()}
        onClick={onClick}
        editMode={false}
      />,
    );
    (container.querySelector("button") as HTMLElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("neither tile shows a verdict the plugin did not publish", () => {
    // Plugin older than 2.0: five days, no confidence anywhere.
    const bare = forecastEquipment();
    bare.dataBindings = bare.dataBindings.filter((b) => !b.alias.endsWith("_confidence"));

    const desktop = render(
      <EquipmentWidget
        widget={widget}
        equipment={bare}
        onExecuteOrder={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );
    expect(dots(desktop.container)).toHaveLength(0);

    const mobile = render(
      <MobileWidgetCard widget={widget} equipment={bare} onClick={vi.fn()} editMode={false} />,
    );
    expect(dots(mobile.container)).toHaveLength(0);
  });

  it("the sheet has a forecast branch: without it the type falls through to null", () => {
    render(
      <EquipmentDetailSheet
        widget={widget}
        equipment={forecastEquipment()}
        onExecuteOrder={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Five rows, each named by its confidence.
    expect(screen.getAllByText(/reliable/).length).toBe(5);
  });
});
