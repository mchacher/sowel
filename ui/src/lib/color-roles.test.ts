import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Spec 196, FR-4 (slice 4) — colour roles. The ratios are computed from
// design-system/tokens.css at test time, so a token change that breaks a
// pair fails here instead of in a hand-written table (the old one in
// design-system/accessibility.md was wrong by up to 6:1).
const tokensCss = readFileSync(new URL("../../../design-system/tokens.css", import.meta.url), "utf8");
const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const srcRoot = fileURLToPath(new URL("..", import.meta.url));

type Theme = "light" | "dark";

/** The custom properties of one theme block, light inheriting nothing. */
function themeVars(theme: Theme): Record<string, string> {
  const selector = theme === "light" ? /:root,\s*\[data-theme="hybrid"\]\s*\{/ : /\[data-theme="dark"\],\s*\.dark\s*\{/;
  const start = tokensCss.search(selector);
  if (start < 0) throw new Error(`no ${theme} block in tokens.css`);
  const body = tokensCss.slice(tokensCss.indexOf("{", start) + 1, tokensCss.indexOf("\n}", start));
  const vars: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

const LIGHT = themeVars("light");
const DARK = { ...LIGHT, ...themeVars("dark") };
const VARS: Record<Theme, Record<string, string>> = { light: LIGHT, dark: DARK };

/** Tailwind colour name → the token it points at (`active-ink` → `--a-ink`). */
function themeColor(name: string): string {
  const m = indexCss.match(new RegExp(`--color-${name}:\\s*var\\((--[\\w-]+)\\)`));
  if (!m) throw new Error(`--color-${name} is not a token alias in index.css`);
  return m[1];
}

function hex(theme: Theme, token: string): string {
  const v = VARS[theme][token];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${token} in ${theme} is not a #rrggbb colour: ${v}`);
  return v;
}

function rgb(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(h: string): number {
  const [r, g, b] = rgb(h).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `bg-x/10` composed on the surface, as the browser paints it. */
function mix(fg: string, bg: string, alpha: number): string {
  const f = rgb(fg);
  const b = rgb(bg);
  return (
    "#" +
    f
      .map((c, i) => Math.round((c * alpha + b[i] * (1 - alpha)) * 255))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** A colour named the way a class names it: `warning-ink`, `warning/10`, `n-100`. */
function resolve(theme: Theme, spec: string): string {
  const [name, pct] = spec.split("/");
  const color = name.startsWith("n-") ? hex(theme, `--${name}`) : hex(theme, themeColor(name));
  return pct ? mix(color, resolve(theme, "surface"), Number(pct) / 100) : color;
}

const TEXT = 4.5;
const GRAPHIC = 3;

// [foreground, background, minimum]. Backgrounds: the card surface, the page
// background, the tinted pill of the role. Every text pair in table A of the
// colour sheet, plus the off switch (graphic).
const PAIRS: [string, string, number][] = [
  ["active-ink", "surface", TEXT],
  ["active-ink", "background", TEXT],
  ["active-ink", "active-bg", TEXT],
  ["on-active", "active", TEXT],
  ["warning", "surface", GRAPHIC],
  ["warning-ink", "surface", TEXT],
  ["warning-ink", "background", TEXT],
  ["warning-ink", "warning/10", TEXT],
  ["on-status", "warning-ink", TEXT],
  ["success", "surface", TEXT],
  ["success", "background", TEXT],
  ["success", "success/10", TEXT],
  ["on-status", "success", TEXT],
  ["error", "surface", TEXT],
  ["error", "background", TEXT],
  ["error", "error/10", TEXT],
  ["on-status", "error", TEXT],
  ["heat", "heat/10", TEXT],
  ["primary", "primary/10", TEXT],
  ["text-secondary", "border-light-solid", TEXT],
  // Off switch: its outline on the surface, its thumb on its track.
  ["text-tertiary", "surface", GRAPHIC],
  ["text-tertiary", "n-100", GRAPHIC],
  // Tertiary text on the page (AppLayout paints n-25): 4.37:1 in dark before
  // n-400 moved to #8A8E97 (slice 4b).
  ["text-tertiary", "n-25", TEXT],
  // Informational (humidity, contacts): text on its tinted pill.
  ["info-ink", "surface", TEXT],
  ["info-ink", "background", TEXT],
  ["info-ink", "info/10", TEXT],
  ["info", "surface", GRAPHIC],
  // Slice 4b — primary fill carries white text; primary ink is text itself.
  ["on-primary", "primary-fill", TEXT],
  ["on-primary", "primary-fill-hover", TEXT],
  ["primary-fill", "surface", GRAPHIC],
  ["primary", "surface", TEXT],
  ["primary", "background", TEXT],
  // Illustrations at rest, without any brightness filter.
  ["illu", "surface", GRAPHIC],
];

describe.each(["light", "dark"] as Theme[])("colour roles, %s theme", (theme) => {
  it.each(PAIRS)("%s on %s reaches %d:1", (fg, bg, min) => {
    // `border-light` is translucent (--line); the pill it backs is drawn on
    // the surface, which is close enough to the n-50 step to stand for it.
    const back = bg === "border-light-solid" ? hex(theme, "--n-50") : resolve(theme, bg);
    expect(ratio(resolve(theme, fg), back)).toBeGreaterThanOrEqual(min);
  });

  it("keeps attention and fault apart (orange is not red)", () => {
    // Hue alone carries it, so check the two are not the same colour.
    expect(resolve(theme, "warning")).not.toBe(resolve(theme, "error"));
    expect(resolve(theme, "warning-ink")).not.toBe(resolve(theme, "error"));
  });
});

describe("colour role tokens", () => {
  it("binds the values the spec decided", () => {
    expect(hex("light", "--a-500")).toBe("#F2C035");
    expect(hex("light", "--a-ink")).toBe("#8A6100");
    expect(hex("light", "--orange-500")).toBe("#E8730C");
    expect(hex("light", "--orange-700")).toBe("#A85500");
    expect(hex("light", "--red-500")).toBe("#B42318");
    expect(hex("light", "--green-500")).toBe("#13794A");
  });

  it("separates the primary fill from the primary ink in dark (slice 4b)", () => {
    expect(hex("light", "--p-fill")).toBe("#1A4F6E");
    expect(hex("light", "--p-fill-hover")).toBe("#144159");
    expect(hex("dark", "--p-fill")).toBe("#2B7299");
    expect(hex("dark", "--p-fill-hover")).toBe("#276B8F");
    expect(hex("dark", "--p-on")).toBe("#FFFFFF");
    // The light blue stays the ink of links and icons in dark.
    expect(hex("dark", "--p-500")).toBe("#5BA5CC");
    expect(themeColor("primary-fill")).toBe("--p-fill");
    expect(themeColor("on-primary")).toBe("--p-on");
  });

  it("gives the illustrations theme colours (slice 4b)", () => {
    expect(themeColor("illu")).toBe("--illu-ink");
    expect(hex("light", "--illu-ink")).toBe("#1A4F6E");
    expect(hex("dark", "--illu-ink")).toBe("#7FB8D4");
    for (const token of ["--illu-ink-2", "--illu-fill", "--illu-fill-2", "--illu-water"]) {
      expect(hex("dark", token)).not.toBe(hex("light", token));
    }
    expect(hex("dark", "--n-400")).toBe("#8A8E97");
  });

  it("defines info as a role in both themes", () => {
    expect(themeColor("info")).toBe("--info-500");
    expect(themeColor("info-ink")).toBe("--info-700");
  });

  it("makes warning orange, no longer amber", () => {
    expect(themeColor("warning")).toBe("--orange-500");
    expect(themeColor("active")).toBe("--a-500");
  });

  it("follows the theme for native controls", () => {
    expect(indexCss).toMatch(/:root\s*\{[^}]*color-scheme:\s*light;[^}]*accent-color:\s*var\(--color-primary\);/);
    expect(indexCss).toMatch(/\.dark\s*\{[^}]*color-scheme:\s*dark;/);
  });
});

// ── Non-regression ─────────────────────────────────────────────
// Tailwind 4 emits nothing for an unknown class: a class renamed here but
// forgotten in a component does not fail the build, it just disappears. So
// the retired names are searched for in the sources.

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const FILES = sources(srcRoot).map((path) => ({ path: path.slice(srcRoot.length), text: readFileSync(path, "utf8") }));

const RETIRED: [RegExp, string][] = [
  [/\b(text|bg|border|fill|stroke|ring)-accent\b/, "amber means on or running: active, active-ink or active-bg"],
  [/\bactive-text\b/, "renamed active-ink"],
  [/\btext-warning(?![-\w])/, "orange as text is warning-ink"],
  [/\b(bg|border)-(success|warning|error|active)\/15\b/, "tinted status backgrounds stop at /10"],
  [/\b(text|bg|border)-(red|green|amber|yellow|orange|emerald)-\d/, "raw Tailwind colours bypass the theme"],
  [/\b(bg|text)-light-(50|500)\b/, "a light off is neutral; the light tint is gone"],
  [/--color-(accent-light|accent-hover|success-light)\b/, "token removed or never defined"],
  [/#(dcfce7|ede9fe|7c3aed)\b/i, "mode badges take tokens"],
  [/\bbg-primary(?![-/\w])[^"`]*\btext-white\b|\btext-white\b[^"`]*\bbg-primary(?![-/\w])/, "text sits on bg-primary-fill, not on the ink"],
  [/\bbg-primary-hover\b/, "a filled control hovers to bg-primary-fill-hover"],
  [/\bwidget-icon\b|brightness\(1\.6\)/, "illustrations take --illu-* tokens, no brightness filter"],
];

describe("illustrations follow the theme", () => {
  it.each(["components/dashboard/WidgetIcons.tsx", "components/icons/AwningIcon.tsx", "components/icons/EvCarGauge.tsx"])(
    "%s has no hard-coded colour",
    (file) => {
      const text = readFileSync(join(srcRoot, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(text.match(/#[0-9a-f]{3,6}\b|"white"|"black"/gi) ?? []).toEqual([]);
    },
  );

  it("drops the dark-mode brightness filter", () => {
    expect(indexCss).not.toMatch(/filter:\s*brightness/);
  });
});

describe("no retired colour class in ui/src", () => {
  it.each(RETIRED)("%s", (pattern, why) => {
    const hits = FILES.flatMap(({ path, text }) =>
      text.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${path}:${i + 1}`] : [])),
    );
    expect(hits, why).toEqual([]);
  });

  it("uses only role colours that exist in the theme", () => {
    // A typo such as text-warning-text would also vanish silently.
    const defined = new Set([...indexCss.matchAll(/--color-([\w-]+):/g)].map((m) => m[1]));
    const used = new Set(
      FILES.flatMap(({ text }) =>
        [...text.matchAll(/\b(?:text|bg|border|fill|stroke)-((?:active|warning|success|error|heat|info|illu|on-status|on-active|on-primary|primary-fill)[\w-]*)/g)].map(
          (m) => m[1],
        ),
      ),
    );
    expect([...used].filter((c) => !defined.has(c))).toEqual([]);
  });
});
