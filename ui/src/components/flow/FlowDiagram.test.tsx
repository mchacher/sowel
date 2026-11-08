import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { FlowDiagram } from "./FlowDiagram";
import {
  FLOW_DOT_PERIOD,
  ROUTE_END,
  SLOT_BOX,
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

  it("overlays only the active links, on top of their skeleton", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[]}
        links={[
          link({ active: true, color: "lime" }),
          link({ edge: "rightToFocal", active: false }),
        ]}
      />,
    );
    // The overlay and its moving dots, both on the one active route.
    const lime = [...container.querySelectorAll('path[stroke="lime"]')];
    expect(lime.map((p) => p.getAttribute("d"))).toEqual([
      expect.stringMatching(/^M 60 180/),
      expect.stringMatching(/^M 60 180/),
    ]);
    expect(container.querySelectorAll("[data-tier]")).toHaveLength(1);
  });

  it("routes the bottom edge the way round the caller asks", () => {
    const ltr = render(<FlowDiagram nodes={[]} links={[link({ edge: "leftToRight" })]} />);
    const rtl = render(<FlowDiagram nodes={[]} links={[link({ edge: "rightToLeft" })]} />);
    const dOf = (c: HTMLElement) => painted(c)[0].d;
    // Same drawn shape, opposite traversal — the bubbles must run the right way.
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
describe("FlowDiagram magnitude and motion", () => {
  it("draws one moving-dot stroke per active link, in CSS, with no SMIL", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[]}
        links={[link({ powerW: 500 }), link({ edge: "rightToFocal", active: false })]}
      />,
    );
    expect(container.querySelectorAll("animateMotion, animate, set")).toHaveLength(0);
    const dots = screen.getAllByTestId("flow-dots");
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute("class")).toContain("flow-dash");
    expect(dots[0].getAttribute("stroke-dasharray")).toBe(`0 ${FLOW_DOT_PERIOD}`);
    expect(dots[0].getAttribute("stroke-linecap")).toBe("round");
  });

  it("draws no dots for a flow too small to animate, but keeps the lit route", () => {
    const { container } = render(<FlowDiagram nodes={[]} links={[link({ powerW: 2 })]} />);
    expect(screen.queryAllByTestId("flow-dots")).toHaveLength(0);
    expect(container.querySelectorAll("[data-tier]")).toHaveLength(1);
  });

  it.each([
    [300, 2],
    [1200, 3],
    [4900, 4],
  ])("strokes a %s W route %s px wide, the same on every screen", (powerW, width) => {
    const { container } = render(<FlowDiagram nodes={[]} links={[link({ powerW })]} />);
    const route = container.querySelector("[data-tier]") as SVGPathElement;
    expect(route.getAttribute("stroke-width")).toBe(String(width));
    expect(route.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("moves the dots faster on a bigger flow", () => {
    const { rerender } = render(<FlowDiagram nodes={[]} links={[link({ powerW: 180 })]} />);
    const slow = parseFloat(screen.getByTestId("flow-dots").style.animationDuration);
    rerender(<FlowDiagram nodes={[]} links={[link({ powerW: 4900 })]} />);
    const fast = parseFloat(screen.getByTestId("flow-dots").style.animationDuration);
    expect(fast).toBeLessThan(slow);
  });

  it("puts a head at the end of each active route and nowhere else", () => {
    render(
      <FlowDiagram
        nodes={[]}
        links={[
          link({ edge: "leftToFocal", color: "blue" }),
          link({ edge: "rightToFocal", active: false }),
        ]}
      />,
    );
    const caps = screen.getAllByTestId("flow-end-cap");
    expect(caps).toHaveLength(1);
    expect(caps[0].dataset.edge).toBe("leftToFocal");
    // At the route's destination: the focal box's left edge, on the run's height.
    expect(caps[0].style.getPropertyValue("--cap-left")).toBe(`${ROUTE_END.leftToFocal.left}%`);
    expect(caps[0].style.top).toBe(`${ROUTE_END.leftToFocal.top}%`);
    expect(caps[0].querySelector('path[fill="blue"]')).toBeTruthy();
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
    const box = container.querySelector(".rounded-md") as HTMLElement;
    expect(box.className).not.toContain("opacity-40");
    expect((box.firstElementChild as HTMLElement).className).toContain("opacity-40");
  });

  it("masks the routes with the card's own colour, not a tinted well (spec 197)", () => {
    const { container } = render(<FlowDiagram nodes={[node()]} links={[]} />);
    const box = container.querySelector(".rounded-md") as HTMLElement;
    expect(box.className).toContain("bg-surface");
    expect(box.className).not.toContain("bg-background");
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

  it("writes a percentage as plain secondary text on a surface pad (spec 197)", () => {
    render(<FlowDiagram nodes={[]} links={[link({ pill: { text: "90 %" } })]} />);
    const pill = screen.getByText("90 %");
    expect(pill.style.color).toBe("");
    expect(pill.style.borderColor).toBe("");
    expect(pill.className).toContain("text-text-secondary");
    expect(pill.className).toContain("bg-surface");
    expect(pill.className).not.toMatch(/(^|\s)(border|rounded-full)(\s|$)/);
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

// #1129 — at 22 % with 4 px of padding, « ↑ 10,5 kW » ran past a satellite at
// 360 and 390 px. Below `sm` the satellites widen to 24 % and step 1 % outward,
// and their centre must stay where the routes meet them.
describe("FlowDiagram satellite geometry", () => {
  const pct = (cls: string, prop: string, prefix = "") => {
    const m = cls.match(new RegExp(`(?:^|\\s)${prefix}(-?)${prop}-\\[(\\d+)%\\]`));
    if (m) return (m[1] ? -1 : 1) * Number(m[2]);
    return new RegExp(`(?:^|\\s)${prefix}${prop}-0(\\s|$)`).test(cls) ? 0 : null;
  };
  // x of the vertical leg of each satellite's routes, as a % of the 540 viewBox.
  const ROUTE_X = { left: (60 / 540) * 100, right: 100 - (480 / 540) * 100 };

  it.each(["left", "right"] as const)(
    "keeps the %s satellite centred on its route, phone and wider",
    (slot) => {
      const cls = SLOT_BOX[slot];
      for (const prefix of ["", "sm:"]) {
        const offset = pct(cls, slot, prefix);
        const width = pct(cls, "w", prefix);
        expect(offset, `${prefix}${slot}`).not.toBeNull();
        expect(width, `${prefix}w`).not.toBeNull();
        expect(Math.abs(offset! + width! / 2 - ROUTE_X[slot]), `${prefix} centre`).toBeLessThan(1);
      }
      expect(pct(cls, "w")).toBe(24);
    },
  );
});

describe("FlowDiagram pills and headline", () => {
  it("places a pill only on the links that carry one", () => {
    render(
      <FlowDiagram
        nodes={[]}
        links={[link({ pill: { text: "90%" } }), link({ edge: "rightToFocal" })]}
      />,
    );
    expect(screen.getByText("90%")).toBeTruthy();
  });

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
        links={[link({ pill: { text: "90%" } })]}
        headline={{ dotColor: "blue", label: "Sur secteur", value: "21", unit: "W" }}
        ariaLabel="Le secteur alimente la charge"
      />,
    );
    expect(screen.getByRole("img", { name: "Le secteur alimente la charge" })).toBeTruthy();
    for (const text of ["Sur secteur", "1.8", "90%"]) {
      expect(screen.getByText(text).closest('[aria-hidden="true"]'), text).toBeTruthy();
    }
  });
});
