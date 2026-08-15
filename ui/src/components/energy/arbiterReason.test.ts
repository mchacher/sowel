import { describe, it, expect } from "vitest";
import { journalReasonLabel, REASON_SLUG } from "./arbiterReason";
import fr from "../../i18n/locales/fr.json";
import en from "../../i18n/locales/en.json";

// Stub `t` that echoes the key (and options) so the mapping is asserted without
// coupling to the actual translations.
const stub = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key} ${JSON.stringify(opts)}` : key;

describe("journalReasonLabel (#518)", () => {
  it("returns null when there is no reason", () => {
    expect(journalReasonLabel(undefined, stub)).toBeNull();
    expect(journalReasonLabel("", stub)).toBeNull();
  });

  it("maps a kebab reason code to its arbiter.reason key", () => {
    expect(journalReasonLabel("surplus-deficit", stub)).toBe("arbiter.reason.surplus-deficit");
    expect(journalReasonLabel("not-profiled", stub)).toBe("arbiter.reason.not-profiled");
    expect(journalReasonLabel("wall-switch-off", stub)).toBe("arbiter.reason.wall-switch-off");
  });

  it("maps a free-text reason to the slug of its kind", () => {
    expect(journalReasonLabel("recipe-driven run outside arbitration", stub)).toBe(
      "arbiter.reason.unclaimed-run",
    );
    expect(journalReasonLabel("export did not recover (a cloud can mask this)", stub)).toBe(
      "arbiter.reason.export-not-recovered",
    );
  });

  it("interpolates the dynamic watts-divergence reason", () => {
    expect(journalReasonLabel("declared 2000 W", stub)).toBe(
      'arbiter.reason.watts-divergence {"watts":"2000"}',
    );
  });

  it("passes an unknown / legacy reason through untranslated", () => {
    expect(journalReasonLabel("some future reason", stub)).toBe("some future reason");
  });

  it("has a matching key in both locales for every mapped reason", () => {
    const slugs = new Set(Object.values(REASON_SLUG));
    slugs.add("watts-divergence"); // the dynamic reason handled by regex
    for (const slug of slugs) {
      const key = `arbiter.reason.${slug}`;
      expect(fr, `fr.json missing ${key}`).toHaveProperty([key]);
      expect(en, `en.json missing ${key}`).toHaveProperty([key]);
    }
  });
});
