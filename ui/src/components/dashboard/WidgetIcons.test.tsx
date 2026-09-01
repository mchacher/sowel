/**
 * The custom widget icons are drawings, so most of what they do is not worth a
 * test. The 3D printer's four states are: it is the one icon whose prop is not
 * a boolean, its `error` state is the reason a workshop plug carries it, and a
 * registry entry that stopped matching the component would render an icon
 * frozen in the wrong state with nothing failing.
 */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "../../test-utils";
import { AirCompressorIcon, Printer3DIcon } from "./WidgetIcons";
import { CUSTOM_ICON_REGISTRY } from "./widget-icons";

function svgOf(node: React.ReactElement): SVGSVGElement {
  const { container } = render(node);
  const svg = container.querySelector("svg");
  expect(svg).toBeTruthy();
  return svg as SVGSVGElement;
}

describe("Printer3DIcon", () => {
  it("rests in the primary tone, with no filament and no fault badge", () => {
    const svg = svgOf(<Printer3DIcon state="off" />);
    expect(svg.getAttribute("class")).toContain("text-primary");
    expect(svg.querySelector("[data-part='filament']")).toBeNull();
    expect(svg.querySelector("[data-part='error-badge']")).toBeNull();
  });

  it("reads as powered but idle: active tone, still no filament", () => {
    const svg = svgOf(<Printer3DIcon state="on" />);
    expect(svg.getAttribute("class")).toContain("text-active");
    expect(svg.querySelector("[data-part='filament']")).toBeNull();
  });

  it("threads the filament only while printing", () => {
    const svg = svgOf(<Printer3DIcon state="printing" />);
    expect(svg.getAttribute("class")).toContain("text-active");
    expect(svg.querySelector("[data-part='filament']")).toBeTruthy();
  });

  it("shows the fault as a badge, not as a colour alone", () => {
    const svg = svgOf(<Printer3DIcon state="error" />);
    expect(svg.getAttribute("class")).toContain("text-error");
    expect(svg.querySelector("[data-part='error-badge']")).toBeTruthy();
    // A fault is not a print in progress, whatever the plug was doing before.
    expect(svg.querySelector("[data-part='filament']")).toBeNull();
  });

  it("defaults to off, so a caller that says nothing gets the resting shape", () => {
    expect(svgOf(<Printer3DIcon />).getAttribute("data-state")).toBe("off");
  });
});

describe("CUSTOM_ICON_REGISTRY", () => {
  it("gives the workshop icons to the plugs, and every entry a drawing", () => {
    for (const [key, entry] of Object.entries(CUSTOM_ICON_REGISTRY)) {
      expect(entry.component, key).toBeTruthy();
      expect(entry.label.length, key).toBeGreaterThan(0);
      expect(entry.types.length, key).toBeGreaterThan(0);
    }
    expect(CUSTOM_ICON_REGISTRY.air_compressor.types).toContain("switch");
    expect(CUSTOM_ICON_REGISTRY.printer_3d.types).toContain("switch");
  });

  it("hands the printer a state its component understands, not a stale prop", () => {
    // previewProps are frozen into every surface that renders a hand-picked
    // icon, so a key the component ignores shows up as a silently wrong state.
    const { container } = render(
      createElement(
        CUSTOM_ICON_REGISTRY.printer_3d.component,
        CUSTOM_ICON_REGISTRY.printer_3d.previewProps,
      ),
    );
    expect(container.querySelector("svg")?.getAttribute("data-state")).toBe("off");
  });

  it("draws the compressor at rest until something tells it otherwise", () => {
    const svg = svgOf(<AirCompressorIcon on={false} />);
    expect(svg.getAttribute("class")).toContain("text-primary");
  });
});
