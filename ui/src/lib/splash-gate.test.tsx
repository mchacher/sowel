import { describe, it, expect, beforeEach } from "vitest";
import source from "../../public/splash.js?raw";
import html from "../../index.html?raw";

// public/splash.js is a classic script served as-is (the CSP forbids an
// inline one), so it is not importable. Run its source against the real
// index.html markup in jsdom, with a stand-in storage, clock and window, and
// judge the splash by its computed style: a class that the cascade then
// overrides would hide nothing.

const KEY = "sowel_last_visit";
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 27, 8, 0, 0);

function makeStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

const throwingStorage = new Proxy({} as Storage, {
  get() {
    throw new Error("SecurityError");
  },
});

function run(storage: Storage, { clock = { now: NOW }, prefersDark = false } = {}) {
  const fakeWindow = {
    addEventListener: () => {},
    matchMedia: () => ({ matches: prefersDark }),
  };
  new Function("document", "window", "localStorage", "Date", source)(document, fakeWindow, storage, {
    now: () => clock.now,
  });
  const splash = document.getElementById("splash")!;
  const style = getComputedStyle(splash);
  return {
    shown: style.display !== "none",
    background: style.backgroundColor,
    splashTs: document.documentElement.dataset.splashTs,
  };
}

describe("splash gate (#976)", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    delete document.documentElement.dataset.splashTs;
    // innerHTML does not execute the <script> tags, only the markup lands.
    document.head.innerHTML = html.match(/<head>([\s\S]*)<\/head>/)![1];
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1];
  });

  it("shows the splash on a first visit and stamps its start", () => {
    const storage = makeStorage();
    expect(run(storage)).toMatchObject({ shown: true, splashTs: String(NOW) });
    expect(storage.getItem(KEY)).toBe(String(NOW));
  });

  it("hides the splash on a reload shortly after a visit", () => {
    const storage = makeStorage({ [KEY]: String(NOW - 5 * 60 * 1000) });
    expect(run(storage)).toMatchObject({ shown: false, splashTs: undefined });
    expect(storage.getItem(KEY)).toBe(String(NOW));
  });

  it("shows the splash again after a long absence", () => {
    expect(run(makeStorage({ [KEY]: String(NOW - 9 * HOUR) })).shown).toBe(true);
  });

  it("shows the splash when the stored stamp is in the future (clock moved back)", () => {
    expect(run(makeStorage({ [KEY]: String(NOW + HOUR) })).shown).toBe(true);
  });

  it("shows the splash on a garbage stamp", () => {
    expect(run(makeStorage({ [KEY]: "nope" })).shown).toBe(true);
  });

  it("shows the splash and does not throw when storage is unavailable", () => {
    expect(run(throwingStorage)).toMatchObject({ shown: true, splashTs: String(NOW) });
  });

  it("refreshes the stamp when the page is hidden, so absence counts from last use", () => {
    const storage = makeStorage();
    const clock = { now: NOW };
    run(storage, { clock });
    clock.now = NOW + 9 * HOUR;
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(storage.getItem(KEY)).toBe(String(NOW + 9 * HOUR));
  });

  it("gives the splash its dark background before the bundle runs", () => {
    expect(run(makeStorage(), { prefersDark: true }).background).toBe("rgb(26, 26, 46)");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("follows an explicit light setting over a dark OS preference", () => {
    const result = run(makeStorage({ sowel_theme: "light" }), { prefersDark: true });
    expect(result.background).toBe("rgb(248, 249, 250)");
  });
});
