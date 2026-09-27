import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// public/splash.js is a classic script served as-is (the CSP forbids an
// inline one), so it is not importable. Run its source against a stand-in
// document, storage and clock.
const source = readFileSync(fileURLToPath(new URL("../../public/splash.js", import.meta.url)), "utf8");

const KEY = "sowel_last_visit";
const HOUR = 60 * 60 * 1000;

function run(now: number, storage: Storage | "throws") {
  const classes = new Set<string>();
  const dataset: Record<string, string> = {};
  const document = {
    documentElement: { classList: { add: (c: string) => classes.add(c) }, dataset },
  };
  const localStorage =
    storage === "throws"
      ? new Proxy({} as Storage, {
          get() {
            throw new Error("SecurityError");
          },
        })
      : storage;
  new Function("document", "localStorage", "Date", source)(document, localStorage, { now: () => now });
  return { skipped: classes.has("no-splash"), splashTs: dataset.splashTs };
}

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

describe("splash gate (#976)", () => {
  const now = Date.UTC(2026, 8, 27, 8, 0, 0);

  it("shows the splash on a first visit and stamps its start", () => {
    const storage = makeStorage();
    expect(run(now, storage)).toEqual({ skipped: false, splashTs: String(now) });
    expect(storage.getItem(KEY)).toBe(String(now));
  });

  it("skips the splash on a reload shortly after a visit", () => {
    const storage = makeStorage({ [KEY]: String(now - 5 * 60 * 1000) });
    expect(run(now, storage)).toEqual({ skipped: true, splashTs: undefined });
    expect(storage.getItem(KEY)).toBe(String(now));
  });

  it("shows the splash again after a long absence", () => {
    const storage = makeStorage({ [KEY]: String(now - 9 * HOUR) });
    expect(run(now, storage).skipped).toBe(false);
  });

  it("shows the splash when the stored stamp is in the future (clock moved back)", () => {
    const storage = makeStorage({ [KEY]: String(now + HOUR) });
    expect(run(now, storage).skipped).toBe(false);
  });

  it("shows the splash on a garbage stamp", () => {
    expect(run(now, makeStorage({ [KEY]: "nope" })).skipped).toBe(false);
  });

  it("shows the splash and does not throw when storage is unavailable", () => {
    expect(run(now, "throws")).toEqual({ skipped: false, splashTs: String(now) });
  });
});
