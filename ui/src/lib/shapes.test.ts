import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Spec 196, slice 7b — radii 6 / 10 / 16 and cards without a border
// (decisions pr7-rayons and pr7-bordures). Tailwind 4 emits nothing for a
// class it does not know, so a removed radius step or a stray bordered card
// would not fail the build: they are searched for here.
const tokensCss = readFileSync(new URL("../../../design-system/tokens.css", import.meta.url), "utf8");
const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const srcRoot = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const LINES = sources(srcRoot).flatMap((path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .map((text, i) => ({ where: `${path.slice(srcRoot.length)}:${i + 1}`, text })),
);

/** The value of a custom property in the first block that defines it after `from`. */
function cssVar(css: string, name: string, from = 0): string | undefined {
  return css.slice(from).match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim();
}

describe("radius scale", () => {
  it("defines 6 / 10 / 16 and the 2 px chart exception in the tokens", () => {
    expect(cssVar(tokensCss, "--r-xs")).toBe("2px");
    expect(cssVar(tokensCss, "--r-sm")).toBe("6px");
    expect(cssVar(tokensCss, "--r-md")).toBe("10px");
    expect(cssVar(tokensCss, "--r-lg")).toBe("16px");
  });

  it("binds Tailwind's radii to them and removes the other steps", () => {
    expect(indexCss).toMatch(/--radius-\*:\s*initial;/);
    for (const step of ["xs", "sm", "md", "lg"]) {
      expect(cssVar(indexCss, `--radius-${step}`)).toBe(`var(--r-${step})`);
    }
    // A bare `rounded` would otherwise still draw Tailwind's 4 px.
    expect(cssVar(indexCss, "--radius")).toBe("var(--r-sm)");
  });

  it("leaves no arbitrary or retired radius in ui/src", () => {
    // Bare `rounded` too, but not a variable named so (`const rounded = …`).
    const off = /(^|[\s"'`:])rounded(-(t|r|b|l|s|e|tl|tr|bl|br))?(-\[|-(none|xl|2xl|3xl)\b|(?=["'`]|\s+(?!=)))/;
    const hits = LINES.filter(({ text }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(text) && off.test(text));
    expect(hits.map((h) => h.where)).toEqual([]);
  });
});

describe("cards", () => {
  it("is one class: surface, 10 px, the card shadow", () => {
    const body = indexCss.match(/@utility card\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toMatch(/background-color:\s*var\(--color-surface\)/);
    expect(body).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(body).toMatch(/box-shadow:\s*var\(--sh-card\)/);
    expect(body).not.toMatch(/border(-width|-color)?:/);
  });

  it("floats on a shadow in light and on its tone alone in dark", () => {
    const dark = tokensCss.search(/\[data-theme="dark"\],\s*\.dark\s*\{/);
    expect(cssVar(tokensCss.slice(0, dark), "--sh-card")).toBe("var(--sh-1)");
    expect(cssVar(tokensCss, "--sh-card", dark)).toBe("none");
  });

  it("leaves no bordered card in ui/src (a field, a popover or a selectable option may keep one)", () => {
    // The 107 `bg-surface border border-border rounded-[10px]` sections of
    // before. Floating layers (menus, pickers, toasts) keep their border: they
    // sit over any content, not on the page. So does a dashed empty state.
    const bordered = LINES.filter(
      ({ text }) =>
        /\bbg-surface\b/.test(text) &&
        /(^|[\s"`])border(?=[\s"`])/.test(text) &&
        /\bborder-border(-light)?\b/.test(text) &&
        /\brounded-(md|lg|t-lg)\b/.test(text) &&
        !/\b(absolute|fixed|shadow-lg|shadow-md|border-dashed)\b/.test(text),
    );
    expect(bordered.map((h) => h.where)).toEqual([]);
  });
});
