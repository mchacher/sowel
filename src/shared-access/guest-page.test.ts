import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { GUEST_JS, guestHtml } from "./guest-page.js";

// ============================================================
// Spec 188 O8 — the guest page, run on a DOM.
//
// The served script is executed as the phone runs it, against a fake clock
// (timers, requestAnimationFrame, Date.now, performance.now) and a fake house
// (fetch). The house answers `POST open` with what the core would, and the
// session with this phone's presses whose outcome follows a timeline.
// ============================================================

interface Press {
  outcome?: "pending" | "confirmed" | "unconfirmed";
  expected?: "open" | "close";
}

interface Options {
  /** The `POST open` answers, one per press, in order. */
  opens: Record<string, unknown>[];
  /** This phone's presses as the session reads them `ms` after boot (newest first). */
  presses: (ms: number, sent: number) => Press[];
  travelS?: number;
  /** From this many ms after boot, session reads never come back (a network switch). */
  hangSessionFrom?: number;
  /** The `POST open` request fails on the network. */
  rejectOpen?: boolean;
}

function guestPage(opts: Options) {
  const html = guestHtml({ name: "Gîte", version: "1" }).replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, {
    url: "https://house.example/access/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Record<string, unknown> & {
    eval: (code: string) => void;
    document: Document;
    navigator: Navigator;
    localStorage: Storage;
    MouseEvent: typeof MouseEvent;
    Date: DateConstructor;
    performance: Performance;
  };

  const boot = 1_000_000;
  let now = boot;
  let nextId = 1;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  w.setTimeout = (fn: () => void, ms = 0) => {
    const id = nextId++;
    timers.push({ at: now + ms, fn, id });
    return id;
  };
  w.clearTimeout = (id: number) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  w.requestAnimationFrame = (fn: (t: number) => void) =>
    (w.setTimeout as (f: () => void, ms: number) => number)(() => fn(now), 16);
  w.Date.now = () => now;
  w.performance.now = () => now;
  Object.defineProperty(w.navigator, "languages", { get: () => ["fr-FR"] });
  w.localStorage.setItem("sowel-shared-access", "tok");

  const calls: { path: string; at: number }[] = [];
  let sent = 0;
  const sessionBody = () => ({
    status: "live",
    label: "Gîte",
    gates: [{ id: "g1", name: "Portail" }],
    validUntil: null,
    travelS: opts.travelS ?? 30,
    presses: opts
      .presses(now - boot, sent)
      .slice(0, sent)
      .map((p) => ({
        at: new Date(now).toISOString(),
        gateId: "g1",
        gateName: "Portail",
        result: "sent",
        ...(p.outcome ? { outcome: p.outcome, expected: p.expected ?? "open" } : {}),
      })),
  });
  w.fetch = (url: string) => {
    const path = url.replace(/^api\//, "");
    calls.push({ path, at: now - boot });
    let body: unknown = {};
    if (path === "open" && opts.rejectOpen) return Promise.reject(new TypeError("network"));
    if (
      path === "session" &&
      opts.hangSessionFrom !== undefined &&
      now - boot >= opts.hangSessionFrom
    ) {
      return new Promise(() => {});
    }
    if (path === "open") body = opts.opens[sent++] ?? { ok: true };
    else if (path === "session") body = sessionBody();
    return Promise.resolve({ status: 200, json: () => Promise.resolve(body) });
  };

  w.eval(GUEST_JS);
  const doc = w.document;

  const flush = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  };
  /** Run the clock to `ms` after boot, firing every timer due on the way. */
  const at = async (ms: number) => {
    await flush();
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > boot + ms) break;
      timers.shift();
      now = next.at;
      next.fn();
      await flush();
    }
    now = boot + ms;
  };
  const text = (id: string) => doc.getElementById(id)?.textContent ?? "";
  const orb = () => doc.querySelector(".orb")!;

  return {
    at,
    calls,
    /** The keyboard's way round the pull: Enter, then Enter again (R5.21). */
    press() {
      const enter = () =>
        orb().dispatchEvent(new w.MouseEvent("click", { detail: 0, bubbles: true }));
      enter();
      enter();
    },
    opens: () => calls.filter((c) => c.path === "open").length,
    sessionReadsBetween: (from: number, to: number) =>
      calls.filter((c) => c.path === "session" && c.at > from && c.at <= to).length,
    pill: () => text("pillText"),
    msg: () => text("msg"),
    verb: () => doc.querySelector(".orb .verb")?.textContent ?? "",
    journal: () => [...doc.querySelectorAll(".jrow")].map((r) => r.textContent ?? ""),
  };
}

const PENDING_OPEN = { ok: true, outcome: "pending", expected: "open", windowS: 15 };
const PENDING_CLOSE = { ok: true, outcome: "pending", expected: "close", windowS: 60 };

/** A timeline of one press's outcome: `[ms after boot, outcome]`, latest wins. */
const timeline =
  (steps: [number, Press["outcome"]][], expected: "open" | "close" = "open") =>
  (ms: number): Press[] => {
    let outcome: Press["outcome"];
    for (const [t, o] of steps) if (ms >= t) outcome = o;
    return [{ outcome, expected }];
  };

describe("guest page — the outcome of its own press (spec 188 O8)", () => {
  it("reads the session every 2 s while the press is pending, and stops after 70 s", async () => {
    const page = guestPage({ opens: [PENDING_OPEN], presses: timeline([[0, "pending"]]) });
    await page.at(100);
    page.press();
    await page.at(100 + 30_000);
    // One read right after the press (refresh), then one every 2 s.
    expect(page.sessionReadsBetween(100, 100 + 30_000)).toBeGreaterThanOrEqual(15);
    await page.at(100 + 120_000);
    expect(page.sessionReadsBetween(100 + 72_100, 100 + 120_000)).toBe(0);
  });

  it("confirmed: pill and journal say « Ouverture confirmée », and polling stops", async () => {
    const page = guestPage({
      opens: [PENDING_OPEN],
      presses: timeline([
        [0, "pending"],
        [3_000, "confirmed"],
      ]),
    });
    await page.at(100);
    page.press();
    await page.at(100 + 5_000);
    expect(page.pill()).toBe("Ouverture confirmée");
    expect(page.journal()[0]).toContain("Ouverture confirmée");
    const reads = page.sessionReadsBetween(0, 100 + 5_000);
    await page.at(100 + 20_000);
    expect(page.sessionReadsBetween(0, 100 + 20_000)).toBe(reads);
  });

  it("unconfirmed: « Sans confirmation » and the look-first message, never an invitation to retry", async () => {
    const page = guestPage({
      opens: [PENDING_OPEN],
      presses: timeline([
        [0, "pending"],
        [15_100, "unconfirmed"],
      ]),
    });
    await page.at(100);
    page.press();
    await page.at(100 + 18_000);
    expect(page.pill()).toBe("Sans confirmation");
    expect(page.msg()).toBe("Regardez le portail avant de réessayer : il a peut-être bougé.");
    expect(page.journal()[0]).toContain("Ouverture demandée · sans confirmation");
  });

  it("a late state turns unconfirmed into confirmed", async () => {
    const page = guestPage({
      opens: [PENDING_OPEN],
      presses: timeline([
        [0, "pending"],
        [15_100, "unconfirmed"],
        [40_000, "confirmed"],
      ]),
    });
    await page.at(100);
    page.press();
    await page.at(100 + 18_000);
    expect(page.pill()).toBe("Sans confirmation");
    await page.at(100 + 43_000);
    expect(page.pill()).toBe("Ouverture confirmée");
    expect(page.msg()).toBe("");
  });

  it("exempt (state unknown): « Commande envoyée », and nothing is followed", async () => {
    const page = guestPage({ opens: [{ ok: true }], presses: () => [{}] });
    await page.at(100);
    page.press();
    await page.at(100 + 1_000);
    expect(page.pill()).toBe("Commande envoyée");
    await page.at(100 + 25_000);
    // Only the refresh right after the press.
    expect(page.sessionReadsBetween(50, 100 + 25_000)).toBe(1);
    expect(page.journal()[0]).toContain("Ouverture demandée");
  });

  it("a new press stops following the previous one", async () => {
    const page = guestPage({
      opens: [PENDING_OPEN, { ok: true }],
      presses: (ms, sent) =>
        sent === 1 ? timeline([[15_100, "unconfirmed"]])(ms) : [{}, { outcome: "unconfirmed" }],
    });
    await page.at(100);
    page.press();
    await page.at(100 + 31_000); // unconfirmed seen, the bar has ended
    expect(page.opens()).toBe(1);
    page.press();
    await page.at(100 + 32_000);
    expect(page.opens()).toBe(2);
    expect(page.pill()).toBe("Commande envoyée");
    const before = page.sessionReadsBetween(0, 100 + 32_000);
    await page.at(100 + 60_000);
    expect(page.sessionReadsBetween(0, 100 + 60_000)).toBe(before);
  });

  it("from open, the disc stays locked for the 60 s window, past a 30 s travel", async () => {
    const page = guestPage({
      opens: [PENDING_CLOSE, PENDING_CLOSE],
      presses: timeline(
        [
          [0, "pending"],
          [62_000, "unconfirmed"],
        ],
        "close",
      ),
    });
    await page.at(100);
    page.press();
    await page.at(100 + 35_000);
    expect(page.verb()).toBe("ENVOYÉ");
    page.press();
    await page.at(100 + 36_000);
    expect(page.opens()).toBe(1);
    // The window has run out but the outcome is still pending: still locked.
    await page.at(100 + 61_000);
    page.press();
    await page.at(100 + 61_500);
    expect(page.opens()).toBe(1);
    // The outcome came: unlocked, and the journal words the direction.
    await page.at(100 + 64_500);
    expect(page.pill()).toBe("Sans confirmation");
    expect(page.verb()).toBe("OUVRIR");
    expect(page.journal()[0]).toContain("Fermeture demandée · sans confirmation");
    page.press();
    await page.at(100 + 65_000);
    expect(page.opens()).toBe(2);
  });

  it("from open, a closing confirmed after the travel ends the bar at once", async () => {
    const page = guestPage({
      opens: [PENDING_CLOSE],
      presses: timeline(
        [
          [0, "pending"],
          [34_000, "confirmed"],
        ],
        "close",
      ),
    });
    await page.at(100);
    page.press();
    await page.at(100 + 37_000);
    expect(page.pill()).toBe("Fermeture confirmée");
    expect(page.verb()).toBe("OUVRIR");
  });

  it("a session read that never comes back does not lock the disc for good", async () => {
    const page = guestPage({
      opens: [PENDING_CLOSE, PENDING_CLOSE],
      presses: timeline([[0, "pending"]], "close"),
      hangSessionFrom: 5_000,
    });
    await page.at(100);
    page.press();
    await page.at(100 + 65_000);
    expect(page.verb()).toBe("ENVOYÉ");
    await page.at(100 + 73_000);
    expect(page.verb()).toBe("OUVRIR");
    page.press();
    await page.at(100 + 73_500);
    expect(page.opens()).toBe(2);
  });

  it("a press lost on the network never invites a plain retry", async () => {
    const page = guestPage({ opens: [], presses: () => [], rejectOpen: true });
    await page.at(100);
    page.press();
    await page.at(100 + 1_000);
    expect(page.msg()).toBe(
      "Pas de réponse du portail : regardez-le avant de réessayer, il a peut-être bougé.",
    );
  });
});
