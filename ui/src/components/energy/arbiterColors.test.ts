import { describe, it, expect } from "vitest";
import type { ArbiterQuarterState } from "../../types";
import {
  journalDotColor,
  surplusStickerColor,
  cellColor,
  loadStateColor,
  displayState,
  PENDING_FILL,
  GRANTED_IDLE_FILL,
} from "./arbiterColors";

describe("spec 164 — a grant nothing consumes", () => {
  it("gives granted-idle its own fill, distinct from a consumed grant", () => {
    expect(cellColor("granted-idle")).toBe(GRANTED_IDLE_FILL);
    expect(cellColor("granted-idle")).not.toBe(cellColor("granted"));
  });

  it("keeps the muted fill in the grant's colour family", () => {
    expect(GRANTED_IDLE_FILL).toContain("--color-solar-auto");
  });

  it("keeps both draw kinds in the grant's journal colour", () => {
    expect(journalDotColor("draw-stopped")).toBe("var(--color-solar-auto)");
    expect(journalDotColor("draw-started")).toBe("var(--color-solar-auto)");
  });
});

describe("journalDotColor (spec 148)", () => {
  it("maps granted/resumed to the auto-consumption green token", () => {
    expect(journalDotColor("granted")).toBe("var(--color-solar-auto)");
    expect(journalDotColor("resumed")).toBe("var(--color-solar-auto)");
  });

  it("maps revoked kinds to the error token", () => {
    expect(journalDotColor("revoked")).toBe("var(--color-error)");
    expect(journalDotColor("revoke-not-honored")).toBe("var(--color-error)");
  });

  it("merges suspended (manual) and unclaimed-run into the slate token", () => {
    expect(journalDotColor("suspended")).toBe("var(--color-slate)");
    expect(journalDotColor("unclaimed-run")).toBe("var(--color-slate)");
    expect(journalDotColor("watts-divergence")).toBe("var(--color-slate)");
  });

  it("falls back to a neutral token for other kinds", () => {
    expect(journalDotColor("unclaimed-run-ended")).toBe("var(--color-text-tertiary)");
    expect(journalDotColor("denied")).toBe("var(--color-text-tertiary)");
  });
});

describe("cellColor (timeline ribbon, #617)", () => {
  it("paints the 'en attente' cell with the muted table-pill tint, not the solid warning", () => {
    // #617 — the solid orange read as aggressive; the pending cell must reuse
    // the same 15% warning mix the roster's waiting pill uses.
    expect(cellColor("pending")).toBe(PENDING_FILL);
    expect(PENDING_FILL).toBe("color-mix(in srgb, var(--color-warning) 15%, transparent)");
    expect(cellColor("pending")).not.toBe("var(--color-warning)");
  });

  it("keeps the other states on their solid tokens", () => {
    expect(cellColor("granted")).toBe("var(--color-solar-auto)");
    expect(cellColor("revoked")).toBe("var(--color-error)");
    expect(cellColor("unmanaged")).toBe("var(--color-slate)");
  });

  it("uses a faint neutral tint for idle", () => {
    expect(cellColor("idle")).toBe(
      "color-mix(in srgb, var(--color-text-tertiary) 15%, transparent)",
    );
  });
});

describe("surplusStickerColor", () => {
  it("uses the surplus green when there is surplus to give", () => {
    expect(surplusStickerColor(300)).toBe("var(--color-solar-auto)");
    expect(surplusStickerColor(1)).toBe("var(--color-solar-auto)");
  });

  it("uses red on a deficit (zero or negative surplus)", () => {
    expect(surplusStickerColor(0)).toBe("var(--color-error)");
    expect(surplusStickerColor(-1091)).toBe("var(--color-error)");
  });

  it("uses a neutral tint while degraded/stale (null)", () => {
    expect(surplusStickerColor(null)).toBe("var(--color-text-tertiary)");
  });
});

describe("spec 165 — one colour source for both halves of the surface", () => {
  const ALL: ArbiterQuarterState[] = [
    "granted",
    "granted-idle",
    "pending",
    "revoked",
    "unmanaged",
    "suspended",
    "idle",
  ];

  it("gives every state a colour (exhaustive over the union)", () => {
    for (const s of ALL) {
      expect(loadStateColor(s), `no colour for ${s}`).toBeTruthy();
    }
  });

  it("gives every state a DISTINCT colour", () => {
    const seen = new Set(ALL.map((s) => loadStateColor(s)));
    expect(seen.size).toBe(ALL.length);
  });

  it("is the same source the ribbon cell uses", () => {
    for (const s of ALL) {
      expect(cellColor(s)).toBe(loadStateColor(s));
    }
  });
});

describe("displayState — dormancy applied once, for both halves (#577)", () => {
  it("reads a waiting claim as at rest at night", () => {
    expect(displayState("pending", true)).toBe("idle");
  });

  it("leaves every other state alone at night", () => {
    // A load drawing power is never "at rest", whatever the hour (#491).
    expect(displayState("unmanaged", true)).toBe("unmanaged");
    expect(displayState("granted", true)).toBe("granted");
    expect(displayState("granted-idle", true)).toBe("granted-idle");
    expect(displayState("suspended", true)).toBe("suspended");
  });

  it("changes nothing during the day", () => {
    expect(displayState("pending", false)).toBe("pending");
  });
});
