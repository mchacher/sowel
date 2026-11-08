import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classNameOfTag } from "../../lib/classname-scan";

// #1149 — `.sr-only` is `position: absolute`. Inside an unpositioned scroll
// container its containing block is the initial one, so it escapes the
// container's overflow and stretches the document to wherever it sits in the
// scrolled content (3,968 px on the Equipments page at 1920x1080). The page
// scroll container is the positioned ancestor of every page, so any absolute
// descendant stays inside it. jsdom has no layout, so the class is pinned here.
const src = readFileSync(new URL("./AppLayout.tsx", import.meta.url), "utf8");

describe("AppLayout page scroll container", () => {
  it("is a positioned ancestor for absolute content such as .sr-only", () => {
    const at = src.indexOf("<main");
    expect(at).toBeGreaterThan(-1);
    const cls = classNameOfTag(src, at + 1) ?? "";
    expect(cls.split(/\s+/)).toContain("overflow-y-auto");
    expect(cls.split(/\s+/)).toContain("relative");
  });
});
