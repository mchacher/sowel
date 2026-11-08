import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classNameOfTag, classNames } from "./classname-scan";

// Spec 196, slice 7b — radii 6 / 10 / 16 and cards without a border
// (decisions pr7-rayons and pr7-bordures). Tailwind 4 emits nothing for a
// class it does not know, so a removed radius step or a stray bordered card
// would not fail the build: they are searched for here.
const tokensCss = readFileSync(
  new URL("../../../design-system/tokens.css", import.meta.url),
  "utf8",
);
const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const srcRoot = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const FILES = sources(srcRoot).map((path) => ({ path, text: readFileSync(path, "utf8") }));

const LINES = FILES.flatMap(({ path, text: file }) =>
  file.split("\n").map((text, i) => ({ where: `${path.slice(srcRoot.length)}:${i + 1}`, text })),
);

/** Every className value in ui/src, whole even when it spans several lines. */
const CLASSNAMES = FILES.flatMap(({ path, text }) =>
  classNames(text).map(({ line, cls }) => ({
    where: `${path.slice(srcRoot.length)}:${line}`,
    cls,
  })),
);

/** The value of a custom property in the first block that defines it after `from`. */
function cssVar(css: string, name: string, from = 0): string | undefined {
  return css
    .slice(from)
    .match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1]
    .trim();
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
    const off =
      /(^|[\s"'`:])rounded(-(t|r|b|l|s|e|tl|tr|bl|br))?(-\[|-(none|xl|2xl|3xl)\b|(?=["'`]|\s+(?!=)))/;
    const hits = LINES.filter(
      ({ text }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(text) && off.test(text),
    );
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
    // Floating layers are told by their class (absolute, fixed); a chart
    // tooltip is positioned by the chart library, so it is listed here.
    // Selectable options (a profile, a series chip) keep the border that shows
    // their state. EvCurrentSessionCard, listed here until #1129, is a `card`.
    const KEEPS_BORDER = [
      "components/energy/EnergyByUsageChart.tsx",
      "components/shared-access/ProfilesTab.tsx",
      "components/history/AnalyseView.tsx",
    ];
    const bordered = CLASSNAMES.filter(
      ({ where, cls }) =>
        /\bbg-surface\b/.test(cls) &&
        /(^|[\s"`])border(?=[\s"`])/.test(cls) &&
        /\bborder-border(-light)?\b/.test(cls) &&
        /\brounded-(md|lg|t-lg)\b/.test(cls) &&
        !/\b(absolute|fixed|shadow-md|border-dashed)\b/.test(cls) &&
        !KEEPS_BORDER.includes(where.replace(/:\d+$/, "")),
    );
    expect(bordered.map((h) => h.where)).toEqual([]);
  });
});

// Spec 196, slice 7c (decision pr7-panneaux, « Couvercle ») — a Maison panel
// is a detached lid over a body of slices: 12 px under the lid, 4 px between
// slices, 4 px inner corners and the 10 px outer radius at the body's ends.
describe("panels as slices under a lid", () => {
  /** The whole body of an @utility, nested rules included. */
  function utility(name: string): string {
    const start = indexCss.search(new RegExp(`@utility ${name}\\s*\\{`));
    if (start < 0) return "";
    let depth = 0;
    for (let i = indexCss.indexOf("{", start); i < indexCss.length; i++) {
      if (indexCss[i] === "{") depth++;
      if (indexCss[i] === "}" && --depth === 0) return indexCss.slice(start, i + 1);
    }
    return "";
  }

  it("draws the lid as a card slice, at least 48 px high", () => {
    const lid = utility("panel-lid");
    expect(lid).toMatch(/background-color:\s*var\(--color-surface\)/);
    expect(lid).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(lid).toMatch(/box-shadow:\s*var\(--sh-card\)/);
    expect(lid).toMatch(/min-height:\s*48px/);
  });

  it("stacks the body's slices 4 px apart, 4 px inside and 10 px at the ends", () => {
    const body = utility("slices");
    expect(body).toMatch(/gap:\s*4px/);
    expect(body).toMatch(
      /& > \*\s*\{[^}]*background-color:\s*var\(--color-surface\)[^}]*border-radius:\s*4px[^}]*box-shadow:\s*var\(--sh-card\)/,
    );
    expect(body).toMatch(/& > :first-child\s*\{[^}]*border-top-left-radius:\s*var\(--radius-md\)/);
    expect(body).toMatch(
      /& > :last-child\s*\{[^}]*border-bottom-right-radius:\s*var\(--radius-md\)/,
    );
  });

  it("separates rows by an inset hairline, none above the first", () => {
    expect(utility("slice-rows")).toMatch(/& > \* \+ \*::before\s*\{[^}]*height:\s*1px/);
  });

  it("leaves no tinted panel band nor n-25 category band in ui/src", () => {
    const band = CLASSNAMES.filter(
      ({ cls }) =>
        /\bbg-primary-light\b.*\bborder-b\b.*\bborder-(primary-mid|\[var\(--p-100\)\])/.test(cls) ||
        /bg-\[var\(--n-25\)\]\s+border-t\s+border-b/.test(cls),
    );
    expect(band.map((h) => h.where)).toEqual([]);
  });
});

// Review of phase 2: the 7b codemod took `border border-border` off ~140
// fields, selects, steppers and secondary buttons and gave them `shadow-lg`, so
// they lost their edge, their on-state border (`!border-active`) and their
// focus border. A control on the surface needs its border to be seen at all.
describe("controls", () => {
  const has = (cls: string, token: string) =>
    new RegExp(`(^|[\\s"'\`])${token}(?=[\\s"'\`]|$)`).test(cls);

  // Segments inside a bordered group (the shared SegmentedControl since spec
  // 197), and the solid button on the red takeover banner.
  const BORDERLESS_OK = [
    "components/ui/SegmentedControl.tsx",
    "components/layout/TakeoverBanner.tsx",
  ];

  it("gives every input, select, textarea and button on bg-surface a border", () => {
    const hits = FILES.flatMap(({ path, text }) =>
      [...text.matchAll(/<(input|select|textarea|button)\b/g)].flatMap((m) => {
        const cls = classNameOfTag(text, m.index + m[0].length);
        if (!cls || !has(cls, "bg-surface") || has(cls, "border(-[trblxy])?")) return [];
        const where = path.slice(srcRoot.length);
        if (BORDERLESS_OK.includes(where)) return [];
        return [`${where}:${text.slice(0, m.index).split("\n").length}`];
      }),
    );
    expect(hits).toEqual([]);
  });

  it("never draws a control as a floating layer (bg-surface rounded-sm shadow-lg)", () => {
    const hits = FILES.flatMap(({ path, text }) =>
      [...text.matchAll(/"[^"\n]*"|`[^`]*`/g)]
        .filter(([s]) => has(s, "bg-surface") && has(s, "rounded-sm") && has(s, "shadow-lg"))
        .map((m) => `${path.slice(srcRoot.length)}:${text.slice(0, m.index).split("\n").length}`),
    );
    expect(hits).toEqual([]);
  });
});
