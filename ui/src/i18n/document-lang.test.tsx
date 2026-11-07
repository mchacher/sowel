import { describe, it, expect, afterEach } from "vitest";
import i18n from "./index";

// Spec 196, slice 2a — `<html lang>` was hard-coded to "en" and never
// updated: a French page was announced as English to screen readers and to
// the browser's hyphenation and translation.

describe("document language", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("follows the UI language, reduced to its two-letter code", async () => {
    await i18n.changeLanguage("fr-FR");
    expect(document.documentElement.lang).toBe("fr");
    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
