import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classNameOfTag } from "../../lib/classname-scan";

// #1264 (amends spec 208 FR7) — below lg the tab bar is a pill floating over
// the page, the iOS 26 shape, and the page scrolls under it. jsdom has no
// layout, so the classes and the custom properties that make it so are pinned.
const src = readFileSync(new URL("./AppLayout.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

const classesOf = (tagStart: number) => (classNameOfTag(src, tagStart + 1) ?? "").split(/\s+/);

describe("phone tab bar (#1264)", () => {
  it("floats as a translucent pill over the bottom of the content column", () => {
    const at = src.indexOf('<nav\n        aria-label={t("nav.main")}');
    expect(at).toBeGreaterThan(-1);
    const cls = classesOf(at);
    for (const c of [
      "lg:hidden",
      "absolute",
      "inset-x-4",
      "bottom-(--tabbar-offset)",
      "z-30",
      "h-(--tabbar-height)",
      "rounded-full",
      "bg-(--tabbar-glass)",
      "backdrop-blur-xl",
      "border",
      "shadow-lg",
    ]) {
      expect(cls).toContain(c);
    }
  });

  it("positions the content column so the bar floats inside it", () => {
    const at = src.indexOf("{/* Main content");
    expect(at).toBeGreaterThan(-1);
    expect(classesOf(src.indexOf("<div", at))).toContain("relative");
  });

  it("keeps the bar's room free under the page's last line, on phones only", () => {
    const cls = classesOf(src.indexOf("<main"));
    expect(cls).toContain("pb-(--tabbar-clearance)");
    expect(cls).toContain("lg:pb-0");
  });

  it("paints the selected tab as a grey pill and the others as plain text", () => {
    const at = src.indexOf("function MobileNavLink");
    const body = src.slice(at, src.indexOf("\n}\n", at));
    expect(body).toMatch(
      /isActive\s*\?\s*`\$\{TAB_SELECTED_CLASS\} bg-text\/8 text-primary font-semibold`/,
    );
    expect(body).toMatch(/:\s*`\$\{TAB_CLASS\} text-text-secondary font-medium`/);
  });

  it("draws its glass more opaque in dark, where bright content would wash out the labels", () => {
    expect(css).toMatch(
      /:root\s*\{[^}]*--tabbar-glass:\s*color-mix\(in oklab, var\(--color-surface\) 75%, transparent\);/,
    );
    expect(css).toMatch(
      /\.dark\s*\{[^}]*--tabbar-glass:\s*color-mix\(in oklab, var\(--color-surface\) 85%, transparent\);/,
    );
  });

  it("keeps the icon close to its label and the selected bubble 44 px high (#1290)", () => {
    const nav = src.indexOf('<nav\n        aria-label={t("nav.main")}');
    expect(classesOf(nav)).toContain("p-1.25");
    const tab = src.slice(src.indexOf("const TAB_BASE"), src.indexOf("function MobileNavLink"));
    expect(tab).toContain("gap-px");
    // the selected tab takes 40 % more of the bar so its label stays inside the curve of its bubble (#1294)
    expect(tab).toContain("transition-[flex-grow] duration-200 motion-reduce:transition-none");
    expect(tab).toContain("const TAB_CLASS = `flex-1 ${TAB_BASE}`;");
    expect(tab).toContain("const TAB_SELECTED_CLASS = `flex-[1.4] ${TAB_BASE}`;");
    const icon = src.slice(src.indexOf("function MobileNavIcon"));
    expect(icon).toContain("w-7 h-5.5");
    // the body's 20 px line height would eat the bubble's room: 22 + 1 + 20 = 43 of 44 px
    expect(src.match(/<span className="text-micro leading-3">/g)).toHaveLength(2);
  });

  it("lifts the install banner and the restart toast above the bar on phones", () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
    expect(read("./InstallPrompt.tsx")).toMatch(/fixed bottom-\(--tabbar-clearance\) lg:bottom-0/);
    expect(read("../system/RestartToast.tsx")).toMatch(
      /fixed bottom-\(--tabbar-clearance\) lg:bottom-4/,
    );
  });

  it("sits 20 px over the iOS home indicator, 12 px where there is none", () => {
    expect(css).toMatch(/--tabbar-height:\s*56px;/);
    expect(css).toMatch(
      /--tabbar-offset:\s*max\(12px,\s*calc\(env\(safe-area-inset-bottom,\s*0px\)\s*-\s*14px\)\);/,
    );
    expect(css).toMatch(
      /--tabbar-clearance:\s*calc\(var\(--tabbar-height\)\s*\+\s*var\(--tabbar-offset\)\s*\+\s*12px\);/,
    );
  });
});
