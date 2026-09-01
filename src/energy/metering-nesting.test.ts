/**
 * Spec 173 — the arithmetic of a meter that sits inside another one.
 *
 * The bug it fixes is silent: two clamps on nested circuits both enrol as
 * submeters, the household breakdown counts the inner one twice, and the
 * residual quietly loses the same kilowatt-hours. These pin the subtraction
 * and the guard that stops a declaration from eating itself.
 */

import { describe, it, expect } from "vitest";
import { childrenByParent, subtractChildren, wouldCycle } from "./metering-nesting.js";

const T = ["01:00", "02:00", "03:00"];
const series = (...wh: number[]) => T.map((time, i) => ({ time, wh: wh[i] }));
const wh = (points: { wh: number }[]) => points.map((p) => p.wh);

describe("childrenByParent", () => {
  it("indexes the declarations, ignoring the ones that say nothing", () => {
    const map = childrenByParent([
      { id: "gite", meteringParentId: null },
      { id: "ce", meteringParentId: "gite" },
      { id: "plaque", meteringParentId: "gite" },
      { id: "pac" },
      // A self-reference cannot happen through the API; if one reaches the
      // database it must not make a meter subtract itself into nothing.
      { id: "broken", meteringParentId: "broken" },
    ]);
    expect(map.get("gite")).toEqual(["ce", "plaque"]);
    expect(map.has("broken")).toBe(false);
  });
});

describe("subtractChildren", () => {
  it("renders a parent net of its child, and leaves the child whole", () => {
    const out = subtractChildren(
      new Map([
        ["gite", series(2260, 100, 50)],
        ["ce", series(2090, 0, 0)],
      ]),
      childrenByParent([{ id: "ce", meteringParentId: "gite" }]),
    );
    expect(wh(out.get("gite")!)).toEqual([170, 100, 50]);
    expect(wh(out.get("ce")!)).toEqual([2090, 0, 0]);
  });

  it("clamps at zero when the child reads more than its parent", () => {
    // Two clamps, two sampling instants: the inner one can overshoot for a
    // bucket. A negative slice would be nonsense on a stacked chart AND would
    // inflate the residual.
    const out = subtractChildren(
      new Map([
        ["parent", series(100, 0, 10)],
        ["child", series(140, 30, 0)],
      ]),
      childrenByParent([{ id: "child", meteringParentId: "parent" }]),
    );
    expect(wh(out.get("parent")!)).toEqual([0, 0, 10]);
  });

  it("subtracts every child of the same parent", () => {
    const out = subtractChildren(
      new Map([
        ["gite", series(1000, 1000, 1000)],
        ["ce", series(600, 0, 0)],
        ["plaque", series(100, 200, 0)],
      ]),
      childrenByParent([
        { id: "ce", meteringParentId: "gite" },
        { id: "plaque", meteringParentId: "gite" },
      ]),
    );
    expect(wh(out.get("gite")!)).toEqual([300, 800, 1000]);
  });

  it("keeps a chain adding back up to its top meter", () => {
    // A ⊃ B ⊃ C. Direct children only: A−B, B−C, C. Subtracting every
    // descendant instead would remove C from A twice.
    const raw = new Map([
      ["a", series(1000, 1000, 1000)],
      ["b", series(600, 400, 0)],
      ["c", series(200, 100, 0)],
    ]);
    const out = subtractChildren(
      raw,
      childrenByParent([
        { id: "b", meteringParentId: "a" },
        { id: "c", meteringParentId: "b" },
      ]),
    );
    expect(wh(out.get("a")!)).toEqual([400, 600, 1000]);
    expect(wh(out.get("b")!)).toEqual([400, 300, 0]);
    expect(wh(out.get("c")!)).toEqual([200, 100, 0]);
    for (let i = 0; i < T.length; i++) {
      const sum = wh(out.get("a")!)[i] + wh(out.get("b")!)[i] + wh(out.get("c")!)[i];
      expect(sum).toBe(wh(raw.get("a")!)[i]);
    }
  });

  it("returns the very same arrays when nothing was declared", () => {
    const raw = new Map([["solo", series(1, 2, 3)]]);
    const out = subtractChildren(raw, new Map());
    // Same reference: an installation that declared nothing pays nothing.
    expect(out.get("solo")).toBe(raw.get("solo"));
  });
});

describe("wouldCycle", () => {
  const graph = [
    { id: "a", meteringParentId: null },
    { id: "b", meteringParentId: "a" },
    { id: "c", meteringParentId: "b" },
    { id: "loner", meteringParentId: null },
  ];

  it("refuses an equipment metered by itself", () => {
    expect(wouldCycle(graph, "a", "a")).toBe(true);
  });

  it("refuses closing a two-meter loop", () => {
    // b is already inside a; putting a inside b closes it.
    expect(wouldCycle(graph, "a", "b")).toBe(true);
  });

  it("refuses closing a longer loop, which the pair alone cannot show", () => {
    expect(wouldCycle(graph, "a", "c")).toBe(true);
  });

  it("allows an honest declaration", () => {
    expect(wouldCycle(graph, "loner", "c")).toBe(false);
    expect(wouldCycle(graph, "c", "loner")).toBe(false);
  });

  it("terminates on a loop that already exists elsewhere in the data", () => {
    const broken = [
      { id: "x", meteringParentId: "y" },
      { id: "y", meteringParentId: "x" },
      { id: "fresh", meteringParentId: null },
    ];
    expect(wouldCycle(broken, "fresh", "x")).toBe(false);
  });
});
