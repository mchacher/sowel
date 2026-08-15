import { describe, it, expect } from "vitest";
import { journalDotColor, surplusStickerColor } from "./arbiterColors";

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
