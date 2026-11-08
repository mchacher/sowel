import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "../../test-utils";
import { MarqueeName } from "./MarqueeName";

// jsdom does no layout: the box sizes are mocked, keyed on the box's mode.
// `overflowing` makes the text larger than its box in the fit layout.
let overflowing = false;
/** Overflow by width only (one line), not by height. */
let wideOnly = false;
let boxWidth = 100;
let reducedMotion = false;
const animate = vi.fn(() => ({ cancel: vi.fn() }));
const restore: Array<() => void> = [];

function mockGetter(name: string, get: (this: HTMLElement) => number) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
  restore.push(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
  });
}

beforeEach(() => {
  overflowing = false;
  wideOnly = false;
  boxWidth = 100;
  reducedMotion = false;
  observers.length = 0;
  animate.mockClear();
  // The box: 100 px wide, 40 px high (two lines).
  mockGetter("clientWidth", () => boxWidth);
  mockGetter("clientHeight", () => 40);
  mockGetter("scrollWidth", () => (overflowing || wideOnly ? 260 : boxWidth));
  mockGetter("scrollHeight", () => (overflowing ? 60 : 40));
  const originalRO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  restore.push(() => {
    globalThis.ResizeObserver = originalRO;
  });
  // The text, on one line in the scroll mode.
  mockGetter("offsetWidth", () => 260);
  const originalAnimate = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
  restore.push(() => {
    HTMLElement.prototype.animate = originalAnimate;
  });
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  restore.push(() => {
    window.matchMedia = originalMatchMedia;
  });
});

afterEach(() => {
  while (restore.length) restore.pop()!();
});

/** A ResizeObserver the test fires by hand, as the browser would on a resize. */
const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  private cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
    observers.push(this);
  }
  observe() {
    this.cb();
  }
  disconnect() {}
  fire() {
    this.cb();
  }
}
const resize = (width: number, overflow: boolean) =>
  act(() => {
    boxWidth = width;
    overflowing = overflow;
    for (const o of observers) o.fire();
  });

const box = () => document.querySelector("[data-marquee]")!;

describe("MarqueeName (#1163)", () => {
  it("does not scroll a name that fits", () => {
    render(<MarqueeName text="Volet" lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("fit");
    expect(box().className).toContain("line-clamp-2");
    expect(animate).not.toHaveBeenCalled();
  });

  it("scrolls a name that overflows its lines, once, and comes back to the start", () => {
    overflowing = true;
    render(<MarqueeName text="Circulation - Escalier Piscine Est" lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("scroll");
    expect(box().className).toContain("whitespace-nowrap");
    expect(box().className).not.toContain("line-clamp");
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, options] = animate.mock.calls[0] as unknown as [
      Array<{ transform: string }>,
      { iterations?: number },
    ];
    // Out by exactly the overflow (260 - 100), back to 0, and not repeated.
    expect(frames.map((f) => f.transform)).toContain("translateX(-160px)");
    expect(frames[frames.length - 1].transform).toBe("translateX(0)");
    expect(options.iterations ?? 1).toBe(1);
  });

  it("measures one line by its width", () => {
    wideOnly = true;
    render(<MarqueeName text="Thermostat présence chambre parents" />);
    expect(box().getAttribute("data-marquee")).toBe("scroll");
  });

  it("keeps the clamp and never moves under reduced motion", () => {
    overflowing = true;
    reducedMotion = true;
    render(<MarqueeName text="Circulation - Escalier Piscine Est" lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("fit");
    expect(box().className).toContain("line-clamp-2");
    expect(animate).not.toHaveBeenCalled();
  });

  it("holds the text once, whatever the mode", () => {
    overflowing = true;
    render(
      <a href="/x">
        <MarqueeName text="Circulation - Escalier Piscine Est" lines={2} />
      </a>,
    );
    expect(screen.getByRole("link").textContent).toBe("Circulation - Escalier Piscine Est");
    expect(screen.getAllByText("Circulation - Escalier Piscine Est")).toHaveLength(1);
  });

  it("does not scroll again on a re-render with the same text", () => {
    overflowing = true;
    const { rerender } = render(<MarqueeName text="Circulation - Escalier Piscine Est" />);
    rerender(<MarqueeName text="Circulation - Escalier Piscine Est" />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("starts to scroll when the room narrows under a name that fitted", () => {
    render(<MarqueeName text="Circulation - Escalier Piscine Est" lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("fit");
    resize(60, true);
    expect(box().getAttribute("data-marquee")).toBe("scroll");
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("goes back to fitting when the room widens", () => {
    overflowing = true;
    render(<MarqueeName text="Circulation - Escalier Piscine Est" lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("scroll");
    resize(400, false);
    expect(box().getAttribute("data-marquee")).toBe("fit");
  });

  it("ignores a neighbour's reading nudging the width, and never replays a finished scroll", () => {
    overflowing = true;
    const finished: Array<{ onfinish: null | (() => void); cancel: () => void }> = [];
    animate.mockImplementation(() => {
      const a = { onfinish: null as null | (() => void), cancel: vi.fn() };
      finished.push(a);
      return a;
    });
    render(<MarqueeName text="Circulation - Escalier Piscine Est" lines={2} />);
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => finished[0].onfinish?.());
    resize(96, true); // 4 px: a reading next door
    expect(animate).toHaveBeenCalledTimes(1);
    resize(60, true); // a real change, but this text has already played
    expect(box().getAttribute("data-marquee")).toBe("scroll");
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("decides again for a new text", () => {
    const { rerender } = render(<MarqueeName text="Volet" lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("fit");
    overflowing = true;
    rerender(
      <MarqueeName text="Volet roulant de la grande baie vitrée côté sud-ouest" lines={2} />,
    );
    expect(box().getAttribute("data-marquee")).toBe("scroll");
  });
});
