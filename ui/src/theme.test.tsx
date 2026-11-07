import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme, THEME_COLOR } from "./theme";

// Spec 196, phase 2 review: the browser bar follows the app's theme setting,
// not only the OS scheme the two index.html metas are keyed on.
describe("theme-color follows the app setting", () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#1A4F6E" media="(prefers-color-scheme: light)" />' +
      '<meta name="theme-color" content="#0E191F" media="(prefers-color-scheme: dark)" />';
  });
  afterEach(() => applyTheme("light"));

  const contents = () =>
    [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
      (m) => m.content,
    );

  it("paints both metas dark when the app is dark", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(contents()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
  });

  it("paints both metas with the ocean bar when the app is light", () => {
    applyTheme("light");
    expect(contents()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });
});
