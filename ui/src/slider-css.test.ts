import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Spec 196, slice 1c — the range-slider defaults live in `@layer components`.
// Unlayered, they beat every Tailwind utility: `h-12` on a sheet slider and
// `h-[60px]` on the vertical dashboard light sliders were reset to 5 px, and
// the vertical ones collapsed to a dot. Nothing in jsdom computes the cascade,
// so this reads the stylesheet: every `input[type="range"]` rule must sit
// inside the components layer.
const css = readFileSync(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

/** The body of the `@layer components { … }` block, braces balanced. */
function componentsLayer(source: string): string {
  const start = source.indexOf("@layer components {");
  if (start < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  return "";
}

describe("index.css — range sliders yield to utilities", () => {
  it("declares every range-slider rule inside @layer components", () => {
    const layer = componentsLayer(css);
    const outside = css.replace(layer, "");
    expect(layer).toMatch(/input\[type="range"\]/);
    expect(outside).not.toMatch(/input\[type="range"\]/);
  });

  it("gives the vertical slider a width for its track, not a height", () => {
    const layer = componentsLayer(css);
    expect(layer).toMatch(/input\[type="range"\]\.slider-vertical\s*\{[^}]*width:/);
  });
});
