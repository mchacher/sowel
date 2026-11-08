import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { MarqueeName } from "./MarqueeName";

// jsdom does no layout: the box sizes are mocked, keyed on the box's mode.
// `overflowing` makes the text larger than its box in the fit layout.
let overflowing = false;
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
  reducedMotion = false;
  animate.mockClear();
  // The box: 100 px wide, 40 px high (two lines).
  mockGetter("clientWidth", () => 100);
  mockGetter("clientHeight", () => 40);
  mockGetter("scrollWidth", () => (overflowing ? 260 : 100));
  mockGetter("scrollHeight", () => (overflowing ? 60 : 40));
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
    overflowing = true;
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
});
