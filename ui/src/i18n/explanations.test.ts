import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

// Issue #1162 — explanations are short (design-system/README.md, "Explanations").
//
// An explanation shown on screen (a hint, a help line, a caption, a subtitle,
// a context line) is one short line at most, in both languages. Longer detail
// goes in a tooltip or in the docs. This test catches the drift by key name:
// a key whose last segment says it explains something stays under MAX_CHARS.
//
// The exceptions are the keys rendered INSIDE a tooltip (an InfoTooltip's
// `text`, a `title` attribute): that is where detail is meant to go. Adding a
// key here is a decision that its text is read on demand, never on the page.

/** One line of caption text on a desktop card. Most stay well under it. */
const MAX_CHARS = 90;

const EXPLANATION = /(hint|help|caption|subtitle|context|description|intro|instruction|note)$/i;

const IN_A_TOOLTIP: RegExp[] = [
  /^equipments\.metering\.[a-zA-Z]+\.hint$/,
  /^equipments\.gateConfirm\.hint$/,
  /^equipments\.invertDirection(Gate)?\.hint$/,
  /^equipments\.timed\.(ladder)?[hH]int$/,
  /^equipments\.pv\.backfillHint$/,
  /^energyProfile\.(hint|releaseDelayHint)$/,
  /^arbiter\.settings\.[a-zA-Z]+Help$/,
  /^arbiter\.rosterHint\.[a-zA-Z]+$/,
  /^orderOutcome\.setting\.hint$/,
  /^plugins\.sources\.removeHint$/,
];

function explanations(locale: Record<string, string>): [string, string][] {
  return Object.entries(locale).filter(([key]) => {
    const last =
      key
        .replace(/_(one|other)$/, "")
        .split(".")
        .pop() ?? "";
    return EXPLANATION.test(last) && !IN_A_TOOLTIP.some((re) => re.test(key));
  });
}

describe("explanations stay short (#1162)", () => {
  it.each([
    ["en", en as Record<string, string>],
    ["fr", fr as Record<string, string>],
  ])("keeps every on-screen explanation in %s under one line", (_, locale) => {
    const tooLong = explanations(locale)
      .filter(([, value]) => value.length > MAX_CHARS)
      .map(([key, value]) => `${key} (${value.length}): ${value}`);
    expect(tooLong).toEqual([]);
  });

  it("still finds explanations to check, so a renamed suffix cannot empty the test", () => {
    expect(explanations(en as Record<string, string>).length).toBeGreaterThan(20);
  });

  it("lists only tooltip keys that exist", () => {
    const keys = Object.keys(en);
    for (const re of IN_A_TOOLTIP) {
      expect(
        keys.some((k) => re.test(k)),
        String(re),
      ).toBe(true);
    }
  });
});
