import { describe, it, expect } from "vitest";
import type { ArbiterQuarterState } from "../../types";
import {
  journalDotColor,
  surplusStickerColor,
  surplusFigureInk,
  STICKER_INK,
  isDeficit,
  loadStatePillBg,
  cellColor,
  cellEdge,
  loadStateColor,
  loadStateInk,
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

  it("keeps unclaimed-run on the slate token, suspended on its own (#960)", () => {
    // #960 — a cell click scrolls the journal to the row that explains it, so
    // the row must not be painted as a different state than the cell.
    expect(journalDotColor("suspended")).toBe("var(--color-primary)");
    expect(journalDotColor("unclaimed-run")).toBe("var(--color-slate)");
    expect(journalDotColor("watts-divergence")).toBe("var(--color-slate)");
  });

  it("falls back to a neutral token for other kinds", () => {
    expect(journalDotColor("unclaimed-run-ended")).toBe("var(--color-text-tertiary)");
    expect(journalDotColor("denied")).toBe("var(--color-text-tertiary)");
  });
});

describe("cellColor (timeline ribbon, #617)", () => {
  it("paints the 'en attente' cell with a muted tint, not the solid warning", () => {
    // #617 — the solid orange read as aggressive. The tint went from 15% to
    // 20% because the paler version was hard to make out on the ribbon, then
    // to 40 % with an orange edge (spec 196: 20 % was 1.24:1 on a card).
    expect(cellColor("pending")).toBe(PENDING_FILL);
    expect(PENDING_FILL).toBe("color-mix(in srgb, var(--color-warning) 40%, transparent)");
    expect(cellColor("pending")).not.toBe("var(--color-warning)");
  });

  it("edges the 'en attente' cell only (spec 196, FR-E)", () => {
    expect(cellEdge("pending")).toBe("inset 0 0 0 1px var(--color-warning)");
    for (const s of [
      "granted",
      "granted-idle",
      "revoked",
      "unmanaged",
      "suspended",
      "idle",
    ] as const) {
      expect(cellEdge(s)).toBeUndefined();
    }
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

  it("uses the grid slate on a deficit, never red (spec 197)", () => {
    expect(surplusStickerColor(-1)).toBe("var(--color-energy-grid)");
    expect(surplusStickerColor(-1091)).toBe("var(--color-energy-grid)");
    expect(surplusStickerColor(-1091)).not.toContain("error");
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
      expect(cellColor(s), `no fill for ${s}`).toBeTruthy();
    }
  });

  it("gives the roster pill a SOLID hue, never a pre-blended fill", () => {
    // Review finding: the pill uses this value as its text colour and re-mixes
    // it at 15% for the background, so a transparent fill here rendered "Au
    // repos" and "En attente" at ~15% alpha on a ~2% background.
    for (const s of ALL) {
      expect(loadStateColor(s), `${s} pill colour is transparent`).not.toContain("transparent");
    }
  });

  it("distinguishes granted from granted-idle on BOTH surfaces", () => {
    expect(loadStateColor("granted-idle")).not.toBe(loadStateColor("granted"));
    expect(cellColor("granted-idle")).not.toBe(cellColor("granted"));
  });

  it("keeps the muted states in their own hue family", () => {
    expect(loadStateColor("granted-idle")).toContain("--color-solar-auto");
    expect(cellColor("pending")).toContain("--color-warning");
  });

  it("derives the solid ribbon fills from the same hue as the pill", () => {
    for (const s of ["granted", "revoked", "unmanaged"] as ArbiterQuarterState[]) {
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

describe("#960 — 'pilotage manuel' is a state of its own", () => {
  it("gives suspended a hue distinct from every other state", () => {
    // Token-level only: this cannot catch two tokens that resolve to similar
    // colours. The review measured the pair that matters — suspended against
    // the slate of `unmanaged` — and the fill is solid for that reason.
    const others: ArbiterQuarterState[] = [
      "granted",
      "granted-idle",
      "pending",
      "revoked",
      "unmanaged",
      "idle",
    ];
    for (const s of others) {
      expect(loadStateColor("suspended")).not.toBe(loadStateColor(s));
    }
  });

  it("no longer borrows the idle grey it used to share", () => {
    // The reported confusion: a pump suspended AND running painted slate, then
    // the idle grey, and the reader could not tell either from the real thing.
    expect(loadStateColor("suspended")).not.toBe(loadStateColor("idle"));
    expect(cellColor("suspended")).not.toBe(cellColor("idle"));
    expect(cellColor("suspended")).not.toBe(cellColor("unmanaged"));
  });

  it("paints the ribbon cell in the same solid hue as the pill", () => {
    // Solid, not a tint: a 60 % mix measured ΔE 11 from the slate of
    // `unmanaged` on the light surface, the two states a reader most needs to
    // tell apart, and they sit next to each other in the legend.
    expect(cellColor("suspended")).toBe(loadStateColor("suspended"));
    expect(loadStateColor("suspended")).toContain("--color-primary");
  });
});

describe("loadStateInk (spec 196, FR-E)", () => {
  it("writes 'en attente' in the text orange, never the fill orange", () => {
    // var(--color-warning) as text is 3.05:1 on a light card.
    expect(loadStateInk("pending")).toBe("var(--color-warning-ink)");
    expect(loadStateColor("pending")).toBe("var(--color-warning)");
  });

  it("writes 'accordé' in the success text green, never the auto-consumption fill (#1126)", () => {
    // var(--color-solar-auto) as text was 2.01:1 on a light card.
    expect(loadStateInk("granted")).toBe("var(--color-success)");
    expect(loadStateInk("granted-idle")).toContain("--color-success");
    expect(loadStateColor("granted")).toBe("var(--color-solar-auto)");
  });

  it("writes the grey states in neutral text, the dot telling them apart (#1126)", () => {
    expect(loadStateInk("unmanaged")).toBe("var(--color-text-secondary)");
    expect(loadStateInk("idle")).toBe("var(--color-text-secondary)");
  });

  it("keeps the red and the blue states' words in their hue", () => {
    for (const s of ["revoked", "suspended"] as const) {
      expect(loadStateInk(s)).toBe(loadStateColor(s));
    }
  });

  it("tints the pill with the hue, not the ink", () => {
    expect(loadStatePillBg("granted")).toBe(
      "color-mix(in srgb, var(--color-solar-auto) 15%, transparent)",
    );
  });
});

describe("sticker words and the aside figure (spec 197)", () => {
  it("writes the sticker in neutral text whatever the sign", () => {
    expect(STICKER_INK).toBe("var(--color-text-secondary)");
  });

  it("writes a surplus figure in the success green, a deficit in ink", () => {
    expect(surplusFigureInk(300)).toBe("var(--color-success)");
    expect(surplusFigureInk(-1)).toBe("var(--color-text)");
    expect(surplusFigureInk(-4800)).toBe("var(--color-text)");
    expect(surplusFigureInk(null)).toBe("var(--color-text-secondary)");
  });

  it("calls an import a deficit, zero and a stale reading neither", () => {
    expect(isDeficit(-1)).toBe(true);
    expect(isDeficit(0)).toBe(false);
    expect(isDeficit(1)).toBe(false);
    expect(isDeficit(null)).toBe(false);
  });
});
