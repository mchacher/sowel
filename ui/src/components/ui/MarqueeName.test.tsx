import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "../../test-utils";
import { MarqueeName } from "./MarqueeName";

// jsdom does no layout: the box sizes are mocked. `overflowing` makes the text
// larger than its box in the fit layout, by width and by height; `wideOnly` by
// width alone (one line).
let overflowing = false;
let wideOnly = false;
let boxWidth = 100;
let reducedMotion = false;
let touch = false;

interface FakeAnimation {
  options: { iterations?: number };
  frames: Array<{ transform: string }>;
  onfinish: null | (() => void);
  cancel: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}
const animations: FakeAnimation[] = [];
const animate = vi.fn((frames: FakeAnimation["frames"], options: FakeAnimation["options"]) => {
  const a: FakeAnimation = {
    frames,
    options,
    onfinish: null,
    cancel: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
  };
  animations.push(a);
  return a;
});

/** Observers the test fires by hand, as the browser would. */
const resizeObservers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  private cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
    resizeObservers.push(this);
  }
  observe() {
    this.cb();
  }
  disconnect() {}
  fire() {
    this.cb();
  }
}
const intersectionObservers: FakeIntersectionObserver[] = [];
class FakeIntersectionObserver {
  private cb: (entries: Array<{ isIntersecting: boolean }>) => void;
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    this.cb = cb;
    intersectionObservers.push(this);
  }
  observe() {}
  disconnect() {}
  fire(isIntersecting: boolean) {
    this.cb([{ isIntersecting }]);
  }
}

const restore: Array<() => void> = [];
function mockGetter(name: string, get: (this: HTMLElement) => number) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
  restore.push(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
  });
}
function mockGlobal(key: "ResizeObserver" | "IntersectionObserver", value: unknown) {
  const g = globalThis as unknown as Record<string, unknown>;
  const original = g[key];
  g[key] = value;
  restore.push(() => {
    g[key] = original;
  });
}

beforeEach(() => {
  overflowing = false;
  wideOnly = false;
  boxWidth = 100;
  reducedMotion = false;
  touch = false;
  animations.length = 0;
  resizeObservers.length = 0;
  intersectionObservers.length = 0;
  animate.mockClear();
  // The box: `boxWidth` wide, 40 px high (two lines); the text 260 px on one line.
  mockGetter("clientWidth", () => boxWidth);
  mockGetter("clientHeight", () => 40);
  mockGetter("scrollWidth", () => (overflowing || wideOnly ? 260 : boxWidth));
  mockGetter("scrollHeight", () => (overflowing ? 60 : 40));
  mockGetter("offsetWidth", () => 260);
  const originalAnimate = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
  restore.push(() => {
    HTMLElement.prototype.animate = originalAnimate;
  });
  mockGlobal("ResizeObserver", FakeResizeObserver);
  mockGlobal("IntersectionObserver", FakeIntersectionObserver);
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches:
      (reducedMotion && query.includes("prefers-reduced-motion: reduce")) ||
      (touch && (query.includes("hover: none") || query.includes("pointer: coarse"))),
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

const LONG = "Volet roulant de la grande baie vitrée côté sud-ouest";
const box = () => document.querySelector("[data-marquee]")!;
const resize = (width: number, overflow: boolean) =>
  act(() => {
    boxWidth = width;
    overflowing = overflow;
    for (const o of resizeObservers) o.fire();
  });

describe("MarqueeName — a name that fits (#1163)", () => {
  it("stays put on one line or wrapped onto its lines", () => {
    touch = true;
    render(<MarqueeName text="Volet" lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("fit");
    expect(box().className).toContain("line-clamp-2");
    expect(animate).not.toHaveBeenCalled();
  });

  it("starts to move when the room narrows under it, and stops when it widens", () => {
    touch = true;
    render(<MarqueeName text={LONG} lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("fit");
    resize(60, true);
    expect(box().getAttribute("data-marquee")).toBe("loop");
    resize(400, false);
    expect(box().getAttribute("data-marquee")).toBe("fit");
  });

  it("ignores a neighbour's reading nudging the width", () => {
    render(<MarqueeName text={LONG} lines={2} />);
    resize(96, true); // 4 px: below the guard, nothing measured again
    expect(box().getAttribute("data-marquee")).toBe("fit");
  });

  it("decides again for a new text", () => {
    touch = true;
    const { rerender } = render(<MarqueeName text="Volet" lines={2} />);
    overflowing = true;
    rerender(<MarqueeName text={LONG} lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("loop");
  });
});

describe("MarqueeName — touch screens loop (#1163)", () => {
  beforeEach(() => {
    touch = true;
    overflowing = true;
  });

  it("scrolls a name that overflows its lines on one line, in a loop", () => {
    render(<MarqueeName text={LONG} lines={2} />);
    expect(box().getAttribute("data-marquee")).toBe("loop");
    expect(box().className).toContain("whitespace-nowrap");
    expect(box().className).not.toContain("line-clamp");
    expect(animations).toHaveLength(1);
    const [a] = animations;
    expect(a.options.iterations).toBe(Infinity);
    // At rest at the start, out by exactly the overflow (260 - 100), and the
    // iteration ends there: the next one jumps back, it never scrolls back.
    const t = a.frames.map((f) => f.transform);
    expect(t[0]).toBe("translateX(0)");
    expect(t[1]).toBe("translateX(0)");
    expect(t[t.length - 1]).toBe("translateX(-160px)");
  });

  it("measures one line by its width", () => {
    overflowing = false;
    wideOnly = true;
    render(<MarqueeName text={LONG} />);
    expect(box().getAttribute("data-marquee")).toBe("loop");
  });

  it("pauses while off screen and while the tab is hidden", () => {
    render(<MarqueeName text={LONG} lines={2} />);
    const [a] = animations;
    act(() => intersectionObservers[0].fire(false));
    expect(a.pause).toHaveBeenCalledTimes(1);
    act(() => intersectionObservers[0].fire(true));
    expect(a.play).toHaveBeenCalledTimes(1);

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(a.pause).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(a.play).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it("keeps one loop running through a re-render with the same text", () => {
    const { rerender } = render(<MarqueeName text={LONG} lines={2} />);
    rerender(<MarqueeName text={LONG} lines={2} />);
    expect(animations).toHaveLength(1);
    expect(animations[0].cancel).not.toHaveBeenCalled();
  });

  it("rebuilds the loop for a small width change, so it still ends on the last letter", () => {
    render(<MarqueeName text={LONG} lines={2} />);
    resize(92, true); // 8 px: under the guard, the mode stays
    expect(box().getAttribute("data-marquee")).toBe("loop");
    expect(animations).toHaveLength(2);
    expect(animations[0].cancel).toHaveBeenCalled();
    const t = animations[1].frames.map((f) => f.transform);
    expect(t[t.length - 1]).toBe("translateX(-168px)");
  });

  it("does not revive a loop once it is gone", () => {
    const { unmount } = render(<MarqueeName text={LONG} lines={2} />);
    const [a] = animations;
    unmount();
    act(() => intersectionObservers[0].fire(true));
    expect(a.play).not.toHaveBeenCalled();
  });

  it("holds the text once, whatever the mode", () => {
    render(
      <a href="/x">
        <MarqueeName text={LONG} lines={2} />
      </a>,
    );
    expect(screen.getByRole("link").textContent).toBe(LONG);
    expect(screen.getAllByText(LONG)).toHaveLength(1);
  });
});

describe("MarqueeName — pointer devices end in an ellipsis (#1163)", () => {
  beforeEach(() => {
    overflowing = true;
  });

  const renderLinked = () =>
    render(
      <a href="/x">
        <MarqueeName text={LONG} lines={2} />
      </a>,
    );

  it("rests on one line ending in an ellipsis, without moving", () => {
    renderLinked();
    expect(box().getAttribute("data-marquee")).toBe("ellipsis");
    expect(box().className).toContain("truncate");
    expect(animate).not.toHaveBeenCalled();
  });

  it("scrolls once while the row is hovered, then comes back to the ellipsis", () => {
    renderLinked();
    fireEvent.mouseEnter(screen.getByRole("link"));
    expect(box().getAttribute("data-marquee")).toBe("hover");
    expect(animations).toHaveLength(1);
    expect(animations[0].options.iterations).toBe(1);
    act(() => animations[0].onfinish?.());
    expect(box().getAttribute("data-marquee")).toBe("ellipsis");
    // A new hover scrolls again.
    fireEvent.mouseLeave(screen.getByRole("link"));
    fireEvent.mouseEnter(screen.getByRole("link"));
    expect(animations).toHaveLength(2);
  });

  it("stops at once when the pointer leaves", () => {
    renderLinked();
    fireEvent.mouseEnter(screen.getByRole("link"));
    fireEvent.mouseLeave(screen.getByRole("link"));
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(box().getAttribute("data-marquee")).toBe("ellipsis");
  });

  it("keeps scrolling for the focus when the pointer leaves", () => {
    renderLinked();
    fireEvent.focusIn(screen.getByRole("link"));
    fireEvent.mouseEnter(screen.getByRole("link"));
    fireEvent.mouseLeave(screen.getByRole("link"));
    expect(box().getAttribute("data-marquee")).toBe("hover");
    expect(animations[0].cancel).not.toHaveBeenCalled();
  });

  it("scrolls when the link gets the keyboard focus", () => {
    renderLinked();
    fireEvent.focusIn(screen.getByRole("link"));
    expect(box().getAttribute("data-marquee")).toBe("hover");
    fireEvent.focusOut(screen.getByRole("link"));
    expect(box().getAttribute("data-marquee")).toBe("ellipsis");
  });
});

describe("MarqueeName — reduced motion (#1163)", () => {
  it("never moves, on touch or pointer, and keeps the clamp with its ellipsis", () => {
    overflowing = true;
    reducedMotion = true;
    for (const isTouch of [true, false]) {
      touch = isTouch;
      const { unmount } = render(
        <a href="/x">
          <MarqueeName text={LONG} lines={2} />
        </a>,
      );
      expect(box().getAttribute("data-marquee")).toBe("fit");
      expect(box().className).toContain("line-clamp-2");
      fireEvent.mouseEnter(screen.getByRole("link"));
      expect(animate).not.toHaveBeenCalled();
      unmount();
    }
  });
});
