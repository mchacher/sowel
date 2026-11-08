import { describe, it, expect } from "vitest";
import { journalKindLabel, journalReasonLabel, releasedFrom, REASON_SLUG } from "./arbiterReason";
import type { ArbiterDecision, ArbiterQuarterState } from "../../types";
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

  it("maps an informative free-text reason to its key", () => {
    expect(journalReasonLabel("export did not recover (a cloud can mask this)", stub)).toBe(
      "arbiter.reason.export-not-recovered",
    );
  });

  it("suppresses a reason that only repeats its kind (#518 dedup)", () => {
    // These reasons duplicate their kind, so only the kind should show.
    for (const redundant of [
      "recipe switched a comfort load off on revocation",
      "recipe-driven run outside arbitration",
      "running outside arbitration",
      "run outside arbitration finished",
      "resume control",
    ]) {
      expect(journalReasonLabel(redundant, stub), redundant).toBeNull();
    }
  });

  it("interpolates the dynamic watts-divergence reason", () => {
    expect(journalReasonLabel("declared 2000 W", stub)).toBe(
      'arbiter.reason.watts-divergence {"power":"2\u00a0kW"}',
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

describe("releasedFrom (spec 197) — what a release gave up", () => {
  const START = Date.parse("2026-08-15T00:00:00.000Z");
  const STEP = 15 * 60_000;
  const at = (min: number) => new Date(START + min * 60_000).toISOString();
  const d = (min: number, kind: ArbiterDecision["kind"], equipmentId = "ce"): ArbiterDecision => ({
    atIso: at(min),
    kind,
    equipmentId,
  });

  it("reads a release after a grant as giving the surplus back", () => {
    const j = [d(50, "released"), d(40, "waiting", "other"), d(10, "granted")];
    expect(releasedFrom(j, 0, undefined, START, STEP)).toBe("granted");
  });

  it("reads a release after a wait as no longer waiting", () => {
    const j = [d(50, "released"), d(10, "waiting")];
    expect(releasedFrom(j, 0, undefined, START, STEP)).toBe("pending");
  });

  it("falls back to the lane's quarter before the release", () => {
    const lane = { quarters: ["idle", "granted-idle", "granted", "idle"] as ArbiterQuarterState[] };
    expect(releasedFrom([d(50, "released")], 0, lane, START, STEP)).toBe("granted");
  });

  it("says nothing when neither the journal nor the lane tells", () => {
    expect(releasedFrom([d(50, "released"), d(10, "reset")], 0, undefined, START, STEP)).toBeNull();
  });

  it("labels each case, and the unknown one neutrally", () => {
    const t = (k: string) => k;
    expect(journalKindLabel("released", "granted", t)).toBe("arbiter.kind.released-granted");
    expect(journalKindLabel("released", "pending", t)).toBe("arbiter.kind.released-pending");
    expect(journalKindLabel("released", null, t)).toBe("arbiter.kind.released");
    expect(journalKindLabel("granted", null, t)).toBe("arbiter.kind.granted");
  });
});
