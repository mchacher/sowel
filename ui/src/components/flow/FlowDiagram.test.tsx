import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { FlowDiagram } from "./FlowDiagram";
import {
  SLOT_ANCHOR,
  WAVE_PERIOD,
  headSize,
  ribbonWidth,
  type FlowLinkSpec,
  type FlowNodeSpec,
} from "./flow-geometry";

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

  it("draws a ribbon on the active links only, and no skeleton under it", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[]}
        links={[
          link({ active: true, color: "lime", powerW: 800 }),
          link({ edge: "rightToFocal", active: false }),
        ]}
      />,
    );
    const ribbons = screen.getAllByTestId("flow-ribbon");
    expect(ribbons).toHaveLength(1);
    expect(ribbons[0].getAttribute("d")).toMatch(/^M 60 180/);
    expect((ribbons[0].parentElement as HTMLElement).style.getPropertyValue("--flow-c")).toBe(
      "lime",
    );
    const skeletons = painted(container).filter((p) => p.stroke === "var(--color-border)");
    expect(skeletons.map((p) => p.d)).toEqual([expect.stringMatching(/^M 480 180/)]);
  });

  it("routes the bottom edge the way round the caller asks", () => {
    const ltr = render(<FlowDiagram nodes={[]} links={[link({ edge: "leftToRight" })]} />);
    const rtl = render(<FlowDiagram nodes={[]} links={[link({ edge: "rightToLeft" })]} />);
    const dOf = (c: HTMLElement) =>
      c.querySelector('[data-testid="flow-ribbon"]')?.getAttribute("d") ?? "";
    // Same drawn shape, opposite traversal — the wave must run the right way.
    expect(dOf(ltr.container)).toMatch(/^M 60 180/);
    expect(dOf(rtl.container)).toMatch(/^M 480 180/);
  });

  it("draws no path ids at all, so two diagrams on one page cannot collide", () => {
    // The SMIL bubbles referenced their route by id; the CSS dots draw on the
    // route itself, so there is nothing left to collide on.
    const { container } = render(
      <div>
        <FlowDiagram nodes={[]} links={[link()]} />
        <FlowDiagram nodes={[]} links={[link()]} />
      </div>,
    );
    expect(container.querySelectorAll("path[id]")).toHaveLength(0);
  });
});

// Spec 197 (FR-E4) — the flow says how much, by width and speed, and which
// way at rest, by a head at the route's end.
// Spec 197 (FR-E4) — the ribbon says how much by its width, which way by its
// wave and, at rest, by the head at its end.
describe("FlowDiagram ribbons", () => {
  it("draws a band, a halo and a three-dash wave per active route, in CSS, with no SMIL", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[]}
        links={[link({ powerW: 500 }), link({ edge: "rightToFocal", active: false })]}
      />,
    );
    expect(container.querySelectorAll("animateMotion, animate, set")).toHaveLength(0);
    expect(container.querySelectorAll(".flow-band")).toHaveLength(1);
    expect(container.querySelectorAll(".flow-halo")).toHaveLength(1);
    const wave = screen.getAllByTestId("flow-wave");
    expect(wave).toHaveLength(3);
    for (const dash of wave) {
      expect(dash.getAttribute("class")).toContain("flow-wave");
      const [len, gap] = dash.style.strokeDasharray.split(" ").map(parseFloat);
      expect(len + gap).toBeCloseTo(WAVE_PERIOD);
    }
    // Longest and faintest first.
    expect(wave.map((d) => Number(d.getAttribute("stroke-opacity")))).toEqual([0.3, 0.55, 1]);
  });

  it("draws nothing but the skeleton for a flow under 5 W", () => {
    const { container } = render(<FlowDiagram nodes={[]} links={[link({ powerW: 2 })]} />);
    expect(screen.queryAllByTestId("flow-ribbon")).toHaveLength(0);
    expect(screen.queryAllByTestId("flow-end-cap")).toHaveLength(0);
    expect(painted(container).filter((p) => p.stroke === "var(--color-border)")).toHaveLength(1);
  });

  it.each([180, 1200, 4900])(
    "sets a %s W ribbon to its width, in screen pixels, narrow and wide",
    (powerW) => {
      render(<FlowDiagram nodes={[]} links={[link({ powerW })]} />);
      const g = screen.getByTestId("flow-ribbon").parentElement as HTMLElement;
      expect(g.style.getPropertyValue("--rw-wide")).toBe(`${ribbonWidth(powerW)}px`);
      expect(g.style.getPropertyValue("--rw")).toBe(`${ribbonWidth(powerW, true)}px`);
      expect(screen.getByTestId("flow-ribbon").getAttribute("vector-effect")).toBe(
        "non-scaling-stroke",
      );
    },
  );

  it("moves the wave faster on a bigger flow", () => {
    const { rerender } = render(<FlowDiagram nodes={[]} links={[link({ powerW: 180 })]} />);
    const slow = parseFloat(screen.getAllByTestId("flow-wave")[0].style.animationDuration);
    rerender(<FlowDiagram nodes={[]} links={[link({ powerW: 4900 })]} />);
    const fast = parseFloat(screen.getAllByTestId("flow-wave")[0].style.animationDuration);
    expect(fast).toBeLessThan(slow);
  });

  it("ends each active route in a head on its destination node, sized on the ribbon", () => {
    render(
      <FlowDiagram
        nodes={[node(), node({ slot: "left", label: "Grid" })]}
        links={[
          link({ edge: "leftToFocal", color: "blue", powerW: 1200 }),
          link({ edge: "rightToFocal", active: false }),
          link({ edge: "rightToLeft", color: "green", powerW: 300 }),
        ]}
      />,
    );
    const caps = screen.getAllByTestId("flow-end-cap");
    expect(caps.map((c) => c.dataset.edge).sort()).toEqual(["leftToFocal", "rightToLeft"]);
    const focalCap = caps.find((c) => c.dataset.edge === "leftToFocal")!;
    // On the focal node's left side, pointing in; never in the middle of a route.
    expect(focalCap.closest('[data-slot="focal"]')).toBeTruthy();
    expect(focalCap.getAttribute("class")).toContain("right-full");
    expect(focalCap.getAttribute("height")).toBe(String(headSize(ribbonWidth(1200)).base));
    expect(focalCap.querySelector('polygon[fill="blue"]')).toBeTruthy();
    const gridCap = caps.find((c) => c.dataset.edge === "rightToLeft")!;
    expect(gridCap.closest('[data-slot="left"]')).toBeTruthy();
    expect(gridCap.getAttribute("class")).toContain("top-full");
  });
});

// Spec 197 (FR-E7) — the shares sit under the node, not on the routes.
describe("FlowDiagram share bars", () => {
  const bar = (parts: { share: number; color: string; label?: string }[]) => ({ parts });

  it("draws the parts in order and colour, with the two ends' percentages", () => {
    render(
      <FlowDiagram
        nodes={[
          node({
            bar: bar([
              { share: 0.29, color: "gray", label: "29 %" },
              { share: 0.71, color: "green", label: "71 %" },
            ]),
          }),
        ]}
        links={[]}
      />,
    );
    const shareBar = screen.getByTestId("flow-share-bar");
    const segs = [...shareBar.querySelectorAll<HTMLElement>("[data-share]")];
    expect(segs.map((s) => s.style.background)).toEqual(["gray", "green"]);
    expect(segs.map((s) => s.style.flex)).toEqual(["0.29 1 0px", "0.71 1 0px"]);
    expect(shareBar.textContent).toBe("29 %71 %");
    expect(shareBar.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws a level as one part over the track, with no figure", () => {
    render(
      <FlowDiagram
        nodes={[node({ bar: bar([{ share: 0.11, color: "blue", label: "11 %" }]) })]}
        links={[]}
      />,
    );
    const seg = screen.getByTestId("flow-share-bar").querySelector<HTMLElement>("[data-share]")!;
    expect(seg.style.width).toBe("11%");
    expect(screen.getByTestId("flow-share-bar").textContent).toBe("");
  });

  it("draws no bar for a node without one, and none on the routes", () => {
    render(<FlowDiagram nodes={[node()]} links={[link({ powerW: 900 })]} />);
    expect(screen.queryByTestId("flow-share-bar")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
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

  it("dims the contents but never the boxes, so the routes cannot show through", () => {
    const { container } = render(<FlowDiagram nodes={[node({ dimmed: true })]} links={[]} />);
    const boxes = [...container.querySelectorAll<HTMLElement>('[data-slot="focal"] .bg-surface')];
    expect(boxes.length).toBe(3);
    for (const b of boxes) expect(b.className).not.toContain("opacity-40");
    expect(screen.getByText("Focal").className).toContain("opacity-40");
    expect(screen.getByTestId("flow-node-icon").className).toContain("opacity-40");
  });

  it("masks the routes with the card's own colour, not a tinted well (spec 197)", () => {
    const { container } = render(<FlowDiagram nodes={[node()]} links={[]} />);
    expect(container.querySelector(".bg-background")).toBeNull();
    expect(container.querySelectorAll('[data-slot="focal"] .bg-surface')).toHaveLength(3);
  });

  it("puts each node's icon centre on its anchor, where the routes meet it", () => {
    const { container } = render(
      <FlowDiagram nodes={[node(), node({ slot: "left" }), node({ slot: "right" })]} links={[]} />,
    );
    for (const slot of ["focal", "left", "right"] as const) {
      const el = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
      expect(el.style.left).toBe(`${SLOT_ANCHOR[slot].left}%`);
      expect(el.style.top).toBe(`${SLOT_ANCHOR[slot].top}%`);
      expect(el.className).toContain("-translate-y-1/2");
    }
    // The routes' corners: x 60 / 480 of 540, y 65 (focal) and 180 of 290.
    expect(SLOT_ANCHOR.left.left).toBeCloseTo((60 / 540) * 100);
    expect(SLOT_ANCHOR.focal.top).toBeCloseTo((65 / 290) * 100);
  });

  // Spec 196, slice 5b — a satellite is about 70 px wide on a 390 px phone.
  // In tracked capitals « PRODUCTION » ran past its border; the label is now
  // sentence case and the satellite steps down a size below `sm`.
  it("writes the node label in sentence case, smaller in a satellite on a phone", () => {
    render(
      <FlowDiagram
        nodes={[
          node({ label: "Consommation" }),
          node({ slot: "right", label: "Production", value: "745", unit: "W" }),
        ]}
        links={[]}
      />,
    );
    const focal = screen.getByText("Consommation");
    const satellite = screen.getByText("Production");
    for (const label of [focal, satellite]) {
      expect(label.className).not.toMatch(/uppercase|tracking-widest/);
      expect(label.className).toContain("whitespace-nowrap");
    }
    expect(satellite.className).toMatch(/(^|\s)text-micro(\s|$)/);
    expect(focal.className).not.toMatch(/(^|\s)text-micro(\s|$)/);
    const value = screen.getByText("745").parentElement as HTMLElement;
    expect(value.className).toContain("text-body");
    expect(value.className).not.toContain("font-mono");
    expect(value.className).toContain("tabular-nums");
  });
});

// #1126 — the node's colour is on its icon only. A value in the node colour put
// the solar green on the well at under 2:1.
describe("FlowDiagram colours: values in ink, colour on the node", () => {
  it("paints the icon in the node colour and the value in ink", () => {
    render(
      <FlowDiagram
        nodes={[node({ color: "var(--color-solar-auto)", value: "745", unit: "W" })]}
        links={[]}
      />,
    );
    expect(screen.getByTestId("flow-node-icon").style.color).toBe("var(--color-solar-auto)");
    const value = screen.getByText("745").parentElement as HTMLElement;
    expect(value.className).toMatch(/(^|\s)text-text(\s|$)/);
    expect(value.style.color).toBe("");
    for (let el: HTMLElement | null = value; el && el.tagName !== "BODY"; el = el.parentElement) {
      expect(el.style.color, el.className).toBe("");
    }
    expect(screen.getByText("W").className).toContain("text-text-tertiary");
  });

  it("starts the headline at the card's edge and centres only the diagram", () => {
    render(
      <FlowDiagram
        nodes={[node()]}
        links={[]}
        headline={{ dotColor: "blue", label: "Sur secteur", value: "25", unit: "min" }}
      />,
    );
    const headline = screen.getByTestId("flow-headline");
    expect(headline.closest(".mx-auto")).toBeNull();
    expect(screen.getByText("Focal").closest(".mx-auto")).toBeTruthy();
  });

  it("puts the headline's colour on its dot and writes its words in ink", () => {
    render(
      <FlowDiagram
        nodes={[]}
        links={[]}
        headline={{ dotColor: "var(--color-energy-grid)", label: "Import réseau", value: "4,9" }}
      />,
    );
    expect(screen.getByTestId("flow-headline-dot").style.background).toBe(
      "var(--color-energy-grid)",
    );
    const headline = screen.getByTestId("flow-headline");
    for (const el of headline.querySelectorAll<HTMLElement>("*")) {
      if (el.dataset.testid === "flow-headline-dot") continue;
      expect(el.style.color, el.className).toBe("");
    }
  });
});

describe("FlowDiagram headline", () => {
  // Spec 197 (FR-E1.1) — the balance line above the diagram, shared by Live
  // and the UPS: a dot, a label, a 40 px figure in ink, an optional sentence.
  it("renders the headline above the diagram: label, value in the value size, sentence", () => {
    render(
      <FlowDiagram
        nodes={[node()]}
        links={[]}
        headline={{
          dotColor: "blue",
          label: "Import réseau",
          value: "4,9",
          unit: "kW",
          sentence: "Le soleil couvre 4 % des 5 kW consommés",
        }}
      />,
    );
    const headline = screen.getByTestId("flow-headline");
    expect(headline.textContent).toContain("Import réseau");
    const value = screen.getByText("4,9").parentElement as HTMLElement;
    expect(value.className).toContain("text-value");
    expect(value.className).toContain("tabular-nums");
    expect(screen.getByText("kW").className).toContain("text-lead");
    expect(screen.getByText("Le soleil couvre 4 % des 5 kW consommés")).toBeTruthy();
    // Above the diagram, in document order.
    expect(
      headline.compareDocumentPosition(screen.getByText("Focal")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no headline and no tag band when none is given", () => {
    const { container } = render(<FlowDiagram nodes={[]} links={[]} />);
    expect(screen.queryByTestId("flow-headline")).toBeNull();
    expect(container.querySelector(".rounded-full.absolute")).toBeNull();
  });

  it("exposes the flow as one sentence and hides the figures it already says", () => {
    render(
      <FlowDiagram
        nodes={[node({ value: "1.8" })]}
        links={[link({ powerW: 900 })]}
        headline={{ dotColor: "blue", label: "Sur secteur", value: "21", unit: "W" }}
        ariaLabel="Le secteur alimente la charge"
      />,
    );
    expect(screen.getByRole("img", { name: "Le secteur alimente la charge" })).toBeTruthy();
    for (const text of ["Sur secteur", "1.8"]) {
      expect(screen.getByText(text).closest('[aria-hidden="true"]'), text).toBeTruthy();
    }
  });
});
