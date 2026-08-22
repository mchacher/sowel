import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { FlowDiagram } from "./FlowDiagram";
import { flowDuration, type FlowLinkSpec, type FlowNodeSpec } from "./flow-geometry";

const node = (over: Partial<FlowNodeSpec> = {}): FlowNodeSpec => ({
  slot: "focal",
  label: "Focal",
  icon: <svg data-testid="icon" />,
  value: "42",
  color: "red",
  ...over,
});

const link = (over: Partial<FlowLinkSpec> = {}): FlowLinkSpec => ({
  edge: "leftToFocal",
  color: "blue",
  active: true,
  ...over,
});

const painted = (c: HTMLElement) =>
  [...c.querySelectorAll("path")]
    .filter((p) => p.getAttribute("stroke") !== "none")
    .map((p) => ({ d: p.getAttribute("d"), stroke: p.getAttribute("stroke") }));

describe("FlowDiagram routes", () => {
  it("draws a skeleton for every declared link, active or not", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[]}
        links={[link({ active: false }), link({ edge: "rightToFocal", active: false })]}
      />,
    );
    const skeletons = painted(container).filter((p) => p.stroke === "var(--color-border)");
    expect(skeletons).toHaveLength(2);
  });

  it("overlays only the active links, on top of their skeleton", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[]}
        links={[link({ active: true, color: "lime" }), link({ edge: "rightToFocal", active: false })]}
      />,
    );
    expect(painted(container).filter((p) => p.stroke === "lime")).toHaveLength(1);
  });

  it("routes the bottom edge the way round the caller asks", () => {
    const ltr = render(<FlowDiagram nodes={[]} links={[link({ edge: "leftToRight" })]} />);
    const rtl = render(<FlowDiagram nodes={[]} links={[link({ edge: "rightToLeft" })]} />);
    const dOf = (c: HTMLElement) => painted(c)[0].d;
    // Same drawn shape, opposite traversal — the bubbles must run the right way.
    expect(dOf(ltr.container)).toMatch(/^M 60 180/);
    expect(dOf(rtl.container)).toMatch(/^M 480 180/);
  });

  it("gives each instance its own motion-path ids so two diagrams cannot collide", () => {
    const { container } = render(
      <div>
        <FlowDiagram nodes={[]} links={[link()]} />
        <FlowDiagram nodes={[]} links={[link()]} />
      </div>,
    );
    const ids = [...container.querySelectorAll("path[id]")].map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("emits three staggered bubbles per active link and none for an idle one", () => {
    const { container } = render(
      <FlowDiagram nodes={[]} links={[link({ magnitude: 500 }), link({ edge: "rightToFocal", active: false })]} />,
    );
    expect(container.querySelectorAll("animateMotion")).toHaveLength(3);
  });

  it("emits no bubbles for a flow too small to animate", () => {
    const { container } = render(<FlowDiagram nodes={[]} links={[link({ magnitude: 2 })]} />);
    expect(container.querySelectorAll("animateMotion")).toHaveLength(0);
  });
});

describe("FlowDiagram nodes", () => {
  it("renders label, value and unit", () => {
    render(<FlowDiagram nodes={[node({ value: "1.8", unit: "kW" })]} links={[]} />);
    expect(screen.getByText("Focal")).toBeTruthy();
    expect(screen.getByText("1.8")).toBeTruthy();
    expect(screen.getByText("kW")).toBeTruthy();
  });

  it("renders the optional sub-line only when given", () => {
    const { rerender } = render(<FlowDiagram nodes={[node({ sub: "59 min" })]} links={[]} />);
    expect(screen.getByText("59 min")).toBeTruthy();
    rerender(<FlowDiagram nodes={[node()]} links={[]} />);
    expect(screen.queryByText("59 min")).toBeNull();
  });

  it("dims the contents but never the box, so the skeleton cannot show through", () => {
    const { container } = render(<FlowDiagram nodes={[node({ dimmed: true })]} links={[]} />);
    const box = container.querySelector(".rounded-\\[14px\\]") as HTMLElement;
    expect(box.className).not.toContain("opacity-40");
    expect((box.firstElementChild as HTMLElement).className).toContain("opacity-40");
  });

  it("renders a value prefix when the caller supplies one", () => {
    render(<FlowDiagram nodes={[node({ valuePrefix: <span>↑</span> })]} links={[]} />);
    expect(screen.getByText("↑")).toBeTruthy();
  });
});

describe("FlowDiagram pills and tag", () => {
  it("places a pill only on the links that carry one", () => {
    render(
      <FlowDiagram
        nodes={[]}
        links={[link({ pill: { text: "90%", color: "green" } }), link({ edge: "rightToFocal" })]}
      />,
    );
    expect(screen.getByText("90%")).toBeTruthy();
  });

  it("renders the qualitative tag when given", () => {
    render(<FlowDiagram nodes={[]} links={[]} tag={{ text: "Sur secteur", color: "blue" }} />);
    expect(screen.getByText("Sur secteur")).toBeTruthy();
  });

  it("exposes the flow as one sentence for screen readers", () => {
    render(<FlowDiagram nodes={[]} links={[]} ariaLabel="Le secteur alimente la charge" />);
    expect(screen.getByRole("img", { name: "Le secteur alimente la charge" })).toBeTruthy();
  });
});

describe("flowDuration", () => {
  it("stays inside the calm band whatever the magnitude", () => {
    expect(flowDuration(50)).toBeGreaterThanOrEqual(4);
    expect(flowDuration(50)).toBeLessThanOrEqual(7);
    expect(flowDuration(50_000)).toBeGreaterThanOrEqual(4);
  });

  it("speeds up as the flow grows", () => {
    expect(flowDuration(10_000)).toBeLessThan(flowDuration(50));
  });

  it("returns zero below the animation floor, so no bubble is drawn", () => {
    expect(flowDuration(2)).toBe(0);
  });

  it("falls back to a mid cadence when there is no magnitude to scale on", () => {
    expect(flowDuration(undefined)).toBe(5.5);
  });
});
