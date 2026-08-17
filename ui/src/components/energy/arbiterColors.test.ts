import { describe, it, expect } from "vitest";
import { journalDotColor, surplusStickerColor, isArbiterDormant } from "./arbiterColors";

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

describe("isArbiterDormant (issue #577)", () => {
  it("is dormant at night when active with no surplus", () => {
    expect(isArbiterDormant("active", false, -1200)).toBe(true);
    expect(isArbiterDormant("active", false, 0)).toBe(true);
    // Active with a null reading at night still reads as at rest, not deficit.
    expect(isArbiterDormant("active", false, null)).toBe(true);
  });

  it("is NOT dormant when a battery exports at night (positive surplus)", () => {
    expect(isArbiterDormant("active", false, 800)).toBe(false);
  });

  it("is NOT dormant during the day, whatever the surplus", () => {
    expect(isArbiterDormant("active", true, -1200)).toBe(false);
    expect(isArbiterDormant("active", true, 500)).toBe(false);
  });

  it("is NOT dormant when daylight is unknown (no home coordinates)", () => {
    expect(isArbiterDormant("active", null, -1200)).toBe(false);
  });

  it("is NOT dormant unless the arbiter is active (degraded/disabled)", () => {
    expect(isArbiterDormant("degraded", false, -1200)).toBe(false);
    expect(isArbiterDormant("disabled", false, -1200)).toBe(false);
  });
});
