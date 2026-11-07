import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import i18n from "./index";

// Spec 196, slice 2a — the plugins page read « 1 appareils »: the count was
// glued to a fixed plural word. A key called with `count` must carry its
// i18next plural forms (`_one` / `_other`) in both languages.

const fr_ = fr as Record<string, string>;
const en_ = en as Record<string, string>;

// Keys called with `count` whose text does not change with it: an abbreviated
// unit (« 3 j », « 12 min ») or an invariable word (« hors ligne ») has no plural.
const INVARIANT = new Set([
  "weather.rainPartial",
  "weather.rainDaysAgo",
  "dashboard.timed.next",
  "integrations.offlineCount",
]);

// Every UI source file, as text (tests excluded).
const SOURCES = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Literal keys passed to `t()` together with a `count` option. */
function keysCalledWithCount(): Map<string, string> {
  const call = /\bt\(\s*["'`]([\w.]+)["'`]\s*,\s*\{[^}]*?\bcount\b/g;
  const keys = new Map<string, string>();
  for (const [file, text] of Object.entries(SOURCES)) {
    for (const match of text.matchAll(call)) keys.set(match[1], file);
  }
  return keys;
}

describe("plurals", () => {
  it("finds the keys called with count (the scan works)", () => {
    expect(keysCalledWithCount().has("integrations.deviceCount")).toBe(true);
  });

  it("gives every key called with count its _one and _other forms in fr and en", () => {
    const missing: string[] = [];
    for (const [key, file] of keysCalledWithCount()) {
      if (INVARIANT.has(key)) continue;
      for (const [lang, table] of [
        ["fr", fr_],
        ["en", en_],
      ] as const) {
        for (const form of ["_one", "_other"]) {
          if (!(`${key}${form}` in table)) missing.push(`${lang} ${key}${form} (${file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("counts devices in the singular and the plural", () => {
    const fr1 = i18n.t("integrations.deviceCount", { count: 1, lng: "fr" });
    const fr2 = i18n.t("integrations.deviceCount", { count: 2, lng: "fr" });
    expect([fr1, fr2]).toEqual(["1 appareil", "2 appareils"]);
    expect(i18n.t("integrations.deviceCount", { count: 1, lng: "en" })).toBe("1 device");
  });
});
