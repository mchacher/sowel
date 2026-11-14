import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOUSE, MASTER, SMALL, SMALL_BELOW_PX, type LogoWeight } from "./logo";

// Spec 210 — the mark is defined once in lib/logo.ts and rendered by SowelLogo.tsx.
// The splash, the favicons, the PWA icons and the docs landing carry static copies
// of it. Before this spec the copies had drifted into two different drawings, so
// this reads each one and fails when it stops carrying the shared paths, each with
// the stroke width of its weight, the viewBox and the wordmark.
const root = new URL("../../../", import.meta.url);
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, root)), "utf8");

/** Every `<path d=… stroke-width=…>` of a document: d → stroke-width (a path with no width is skipped). */
function pathWidths(source: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const tag of source.match(/<path\b[^>]*>/g) ?? []) {
    const d = /\sd="([^"]*)"/.exec(tag)?.[1];
    const width = /\sstroke-width="([\d.]+)"/.exec(tag)?.[1];
    if (d !== undefined && width !== undefined) out.set(d, Number(width));
  }
  return out;
}

/** The face and outline of `weight`, as the file draws them: each path with the width it must have. */
function expected(weight: LogoWeight): Array<[string, number]> {
  return [
    [HOUSE, weight.house],
    [weight.leftEye, weight.eye],
    [weight.rightEye, weight.eye],
    [weight.smilePath, weight.smile],
  ];
}

function mismatches(source: string, wanted: Array<[string, number]>): string[] {
  const drawn = pathWidths(source);
  return wanted.flatMap(([d, width]) =>
    drawn.get(d) === width
      ? []
      : [`${d} should be ${width}, found ${drawn.get(d) ?? "no such path"}`],
  );
}

describe("logo copies stay on the shared drawing (spec 210)", () => {
  it.each([
    ["ui/public/favicon.svg", "small", SMALL],
    ["docs/assets/favicon.svg", "small", SMALL],
    ["docs/assets/logo.svg", "small", SMALL],
    ["ui/public/pwa-icon.svg", "master", MASTER],
    ["ui/public/pwa-maskable.svg", "master", MASTER],
  ] as const)("%s draws every path of the %s weight at its width", (path, _name, weight) => {
    expect(mismatches(read(path), expected(weight))).toEqual([]);
  });

  it("the favicons and the docs header logo share one viewBox", () => {
    for (const path of [
      "ui/public/favicon.svg",
      "docs/assets/favicon.svg",
      "docs/assets/logo.svg",
    ]) {
      expect(read(path), path).toContain('viewBox="20 10 160 165"');
    }
  });

  it("the splash draws the master weight, the winking eye and the wordmark", () => {
    const html = read("ui/index.html");
    const splash = html.slice(
      html.indexOf('<div id="splash">'),
      html.indexOf("</svg>", html.indexOf('<div id="splash">')),
    );
    // The winking eye is a group around its own centre, so it is checked on its relative path.
    expect(
      mismatches(splash, [
        [HOUSE, MASTER.house],
        [MASTER.leftEye, MASTER.eye],
        [MASTER.smilePath, MASTER.smile],
        [MASTER.wink.path, MASTER.eye],
      ]),
    ).toEqual([]);
    expect(splash).toMatch(
      new RegExp(`translate\\(${MASTER.wink.origin.replace(" ", "[ ,]+")}\\)`),
    );
    expect(splash).toContain('viewBox="20 10 160 205"');
    expect(splash).toMatch(/font-family="Nunito[^"]*" font-weight="700"[^>]*>sowel<\/text>/);
  });

  it("the docs landing draws the master face and outline under their CSS classes, in both languages", () => {
    for (const page of ["docs/index.md", "docs/index.fr.md"]) {
      const text = read(page);
      const drawn = [
        ["house", HOUSE],
        ["smile", MASTER.smilePath],
        ["left-eye", MASTER.leftEye],
        ["right-eye", MASTER.rightEye],
      ];
      for (const [cls, d] of drawn) {
        // hero mark and large mark: two inline SVGs
        const count = text.split(new RegExp(`class="${cls}"\\s+d="${d}"`)).length - 1;
        expect(count, `${page}: class ${cls}`).toBe(2);
      }
      expect(text.split('viewBox="20 10 160 165"').length - 1, `${page}: viewBox`).toBe(2);
      expect(text, `${page}: wordmark`).toContain(
        '<span class="sowel-hero__wordmark">sowel</span>',
      );
    }
  });

  it("the docs stylesheet sets the master widths on the right classes and the wordmark in Nunito", () => {
    const css = read("docs/stylesheets/extra.css");
    const widthOf = (selector: string): number[] =>
      [...css.matchAll(new RegExp(`${selector}[^{]*\\{([^}]*)\\}`, "g"))].flatMap((m) => {
        const w = /stroke-width:\s*([\d.]+)/.exec(m[1])?.[1];
        return w === undefined ? [] : [Number(w)];
      });
    expect(widthOf("\\.sowel-logo \\.house")).toEqual([MASTER.house]);
    expect(widthOf("\\.sowel-logo \\.smile")).toEqual([MASTER.smile]);
    expect(widthOf("\\.sowel-logo \\.right-eye")).toEqual([MASTER.eye]);
    const wordmark = /\.md-typeset \.sowel-hero__wordmark \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(wordmark).toContain('font-family: "Nunito"');
    expect(wordmark).toContain("font-weight: 700;");
    expect(css.match(/\.md-typeset \.sowel-hero__wordmark \{/g)?.length).toBe(1);
  });

  it("SowelLogo draws from the shared definition, with no path of its own, and switches weight at the threshold", () => {
    const component = read("ui/src/components/layout/SowelLogo.tsx");
    expect(component).toContain('from "../../lib/logo"');
    for (const literal of [HOUSE, MASTER.smilePath, SMALL.smilePath]) {
      expect(component).not.toContain(literal);
    }
    expect(component).toContain("size < SMALL_BELOW_PX ? SMALL : MASTER");
    expect(component).toContain('viewBox="20 10 160 165"');
    expect(component).toContain('viewBox="20 10 160 205"');
    expect(SMALL_BELOW_PX).toBe(32);
  });

  it("the wordmark is lowercase « sowel » in Nunito everywhere it is drawn", () => {
    const component = read("ui/src/components/layout/SowelLogo.tsx");
    expect(component).toMatch(/fontFamily="Nunito, sans-serif"\s+fontWeight="700"/);
    expect(component).toMatch(/>\s*sowel\s*</);
    const sidebar = read("ui/src/components/layout/Sidebar.tsx");
    expect(sidebar).toMatch(/\n\s*sowel\n/);
    expect(sidebar).toContain('fontFamily: "Nunito, sans-serif", fontWeight: 700');
    for (const [name, source] of [
      ["SowelLogo.tsx", component],
      ["Sidebar.tsx", sidebar],
      ["index.html", read("ui/index.html")],
    ]) {
      expect(source, `${name} still draws « SOWEL »`).not.toMatch(/>\s*SOWEL\s*</);
    }
  });

  it("the two weights differ, and the small one is the heavier", () => {
    expect(SMALL.house).toBeGreaterThan(MASTER.house);
    expect(SMALL.eye).toBeGreaterThan(MASTER.eye);
    expect(SMALL.smile).toBeGreaterThan(MASTER.smile);
  });
});
