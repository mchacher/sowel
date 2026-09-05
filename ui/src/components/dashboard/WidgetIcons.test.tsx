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
import {
  AirCompressorIcon,
  GateWidgetIcon,
  LightBulbIcon,
  PlugWidgetIcon,
  PoolCoverIcon,
  Printer3DIcon,
} from "./WidgetIcons";
import { CUSTOM_ICON_REGISTRY, customIconProps, renderWidgetStateIcon } from "./widget-icons";

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

  it("hands the picker thumbnail a state its component understands", () => {
    // previewProps drive the picker's grid and nothing else. A key the
    // component ignores would show the icon frozen in the wrong state there.
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

/**
 * The defect this pins: a hand-picked icon used to be rendered from its
 * previewProps on every live surface, so a compressor stayed at rest and a
 * plug stayed lit whatever the relay was doing. The drawing must inherit the
 * state props of the type icon it replaces.
 */
describe("renderWidgetStateIcon", () => {
  it("leaves the type icon alone when no icon was picked", () => {
    const typeIcon = <LightBulbIcon on={true} />;
    expect(renderWidgetStateIcon(undefined, typeIcon)).toBe(typeIcon);
    expect(renderWidgetStateIcon("no_such_icon", typeIcon)).toBe(typeIcon);
  });

  it("swaps the drawing and carries the live state across", () => {
    const off = renderWidgetStateIcon("air_compressor", <PlugWidgetIcon on={false} />);
    expect(off.type).toBe(CUSTOM_ICON_REGISTRY.air_compressor.component);
    expect(off.props).toMatchObject({ on: false });

    // The regression: previewProps say `{ on: false }`, so the compressor
    // never lit up when the plug was switched on.
    const on = renderWidgetStateIcon("air_compressor", <PlugWidgetIcon on={true} />);
    expect(on.props).toMatchObject({ on: true });
    expect(svgOf(on).getAttribute("class")).toContain("text-active");
  });

  it("translates the state into the printer's four-valued vocabulary", () => {
    const on = renderWidgetStateIcon("printer_3d", <PlugWidgetIcon on={true} />);
    expect(svgOf(on).getAttribute("data-state")).toBe("on");
    const off = renderWidgetStateIcon("printer_3d", <PlugWidgetIcon on={false} />);
    expect(svgOf(off).getAttribute("data-state")).toBe("off");
  });

  it("fills a drawing's own boolean from whichever one its widget computed", () => {
    // The picker offers every icon under "other", so a gate can be given the
    // plug: `open` has to reach the drawing that reads `on`, and back.
    const plugOnGate = renderWidgetStateIcon("plug", <GateWidgetIcon open={true} />);
    expect(plugOnGate.props).toMatchObject({ on: true });

    const gateOnPlug = renderWidgetStateIcon("gate", <PlugWidgetIcon on={false} />);
    expect(gateOnPlug.props).toMatchObject({ open: false });
  });

  it("leaves a stateless drawing stateless", () => {
    // Sensor icons take no props: nothing to fill in, and nothing invented.
    expect(customIconProps(CUSTOM_ICON_REGISTRY.multi_sensor, {})).toEqual({});
  });

  it("keeps the numeric state of a cover, which has no boolean to inherit", () => {
    const cover = renderWidgetStateIcon("pool_cover", <PoolCoverIcon position={40} />);
    expect(cover.props).toMatchObject({ position: 40 });
  });
});
