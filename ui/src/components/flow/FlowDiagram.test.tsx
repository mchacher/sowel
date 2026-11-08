import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { FlowDiagram } from "./FlowDiagram";
import { SLOT_BOX, flowDuration, type FlowLinkSpec, type FlowNodeSpec } from "./flow-geometry";

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
      <FlowDiagram
        nodes={[]}
        links={[link({ magnitude: 500 }), link({ edge: "rightToFocal", active: false })]}
      />,
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
    const box = container.querySelector(".rounded-md") as HTMLElement;
    expect(box.className).not.toContain("opacity-40");
    expect((box.firstElementChild as HTMLElement).className).toContain("opacity-40");
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

  it("borders a pill in the link colour and writes its figure in ink", () => {
    render(
      <FlowDiagram
        nodes={[]}
        links={[link({ pill: { text: "90 %", color: "var(--color-solar-auto)" } })]}
      />,
    );
    const pill = screen.getByText("90 %");
    expect(pill.style.borderColor).toBe("var(--color-solar-auto)");
    expect(pill.style.color).toBe("");
    expect(pill.className).toMatch(/(^|\s)text-text(\s|$)/);
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
        links={[link({ pill: { text: "90%", color: "green" } }), link({ edge: "rightToFocal" })]}
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
        links={[link({ pill: { text: "90%", color: "green" } })]}
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
