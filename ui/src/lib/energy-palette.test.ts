import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { SERIES_COLORS, seriesDrawnHex, seriesPaint } from "./series-palette";
import {
  byUsageSeriesColor,
  pickSubmeterColor,
  seriesColor,
} from "../components/energy/submeterPalette";
import {
  loadStateInk,
  loadStatePillBg,
  surplusStickerColor,
  surplusStickerInk,
} from "../components/energy/arbiterColors";

// Spec 196 (FR-E, AC-11) — the energy palette, computed from
// design-system/tokens.css so a token change that breaks a pair fails here:
// - same-family energy series side by side on one chart (HP/HC,
//   autoconsumption/injection, house/grid, grid/unmanaged): >= 2:1 in dark,
//   >= 1.5:1 in light. Lightness only: they share a hue.
// - a blue next to a green: >= 30 deg of hue.
// - series palette neighbours: >= 2:1 or >= 30 deg of hue.
// - every series against "Other": >= 1.5:1 and >= 30 deg of hue (Other is a
//   near-grey, so hue alone means little).
// - every mark on the dark card: >= 3:1.
const tokensCss = readFileSync(
  new URL("../../../design-system/tokens.css", import.meta.url),
  "utf8",
);

type Theme = "light" | "dark";

function themeVars(theme: Theme): Record<string, string> {
  const selector =
    theme === "light"
      ? /:root,\s*\[data-theme="hybrid"\]\s*\{/
      : /\[data-theme="dark"\],\s*\.dark\s*\{/;
  const start = tokensCss.search(selector);
  const body = tokensCss.slice(tokensCss.indexOf("{", start) + 1, tokensCss.indexOf("\n}", start));
  const vars: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

const LIGHT = themeVars("light");
const VARS: Record<Theme, Record<string, string>> = {
  light: LIGHT,
  dark: { ...LIGHT, ...themeVars("dark") },
};

function hex(theme: Theme, token: string): string {
  const v = VARS[theme][token];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v))
    throw new Error(`${token} in ${theme} is not a #rrggbb colour: ${v}`);
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

/** HSL hue in degrees. */
function hue(h: string): number {
  const [r, g, b] = rgb(h);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const raw = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (raw * 60 + 360) % 360;
}

function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return Math.min(d, 360 - d);
}

const MIN_RATIO: Record<Theme, number> = { light: 1.5, dark: 2 };

/** Same-family series drawn side by side on one chart, and where. */
const SAME_FAMILY: Array<[string, string, string]> = [
  ["--energy-hp", "--energy-hc", "Consumption bars (HP/HC), EV share bar"],
  ["--solar-auto", "--solar-injection", "Production bars (autoconsumption/injection)"],
  ["--energy-hp", "--energy-grid", "Live diagram, UPS panel (house/grid)"],
  ["--energy-grid", "--slate-neutral", "Live page (grid/unmanaged)"],
];

/** A blue next to a green, and where. */
const CROSS_FAMILY: Array<[string, string, string]> = [
  ["--energy-hc", "--solar-auto", "Consumption bars, EV share bar"],
  ["--energy-hp", "--solar-auto", "Consumption bars, UPS panel"],
  ["--energy-grid", "--solar-auto", "Live diagram"],
  ["--slate-neutral", "--solar-auto", "Arbiter legend"],
];

const SERIES = Array.from({ length: 8 }, (_, i) => `--series-${i + 1}`);
const SURFACE = "--n-0";

describe("energy palette: neighbouring series are told apart (spec 196, FR-E)", () => {
  for (const theme of ["light", "dark"] as const) {
    it.each(SAME_FAMILY)(`${theme}: %s / %s differ by lightness (%s)`, (a, b) => {
      const [ca, cb] = [hex(theme, a), hex(theme, b)];
      expect(ratio(ca, cb), `${ca} / ${cb}`).toBeGreaterThanOrEqual(MIN_RATIO[theme]);
    });

    it.each(CROSS_FAMILY)(`${theme}: %s / %s differ by >= 30 deg of hue (%s)`, (a, b) => {
      const [ca, cb] = [hex(theme, a), hex(theme, b)];
      expect(hueGap(ca, cb), `${ca} / ${cb}`).toBeGreaterThanOrEqual(30);
    });
  }

  it.each([
    ...[...SAME_FAMILY, ...CROSS_FAMILY].flatMap(([a, b]) => [a, b]),
    "--solar-production",
    "--energy-other",
  ])("dark: %s stands on the card (>= 3:1)", (token) => {
    expect(ratio(hex("dark", token), hex("dark", SURFACE))).toBeGreaterThanOrEqual(3);
  });

  it("keeps the 'hors pilotage' slate readable as text in both themes (pill, caption)", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(ratio(hex(theme, "--slate-neutral"), hex(theme, SURFACE))).toBeGreaterThanOrEqual(4.2);
    }
  });
});

describe("series palette (sub-meters, phases, Analyse)", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme}: each series stands on the card (>= 3:1)`, () => {
      for (const s of SERIES)
        expect(ratio(hex(theme, s), hex(theme, SURFACE)), s).toBeGreaterThanOrEqual(3);
    });

    it(`${theme}: neighbours, the last and the first included, differ by >= 2:1 or >= 30 deg`, () => {
      SERIES.forEach((s, i) => {
        const [a, b] = [hex(theme, s), hex(theme, SERIES[(i + 1) % SERIES.length])];
        const ok = ratio(a, b) >= 2 || hueGap(a, b) >= 30;
        expect(ok, `${s}: ${a} / ${b}`).toBe(true);
      });
    });

    it(`${theme}: no series takes a role's hue (warning, error, on, success, solar)`, () => {
      const roles = ["--orange-500", "--red-500", "--a-500", "--green-500", "--solar-auto"].map(
        (t) => hex(theme, t),
      );
      for (const s of SERIES) {
        for (const role of roles)
          expect(hueGap(hex(theme, s), role), `${s} vs ${role}`).toBeGreaterThanOrEqual(20);
      }
    });

    it(`${theme}: the 'Other' slice differs from every series by >= 1.5:1 and >= 30 deg`, () => {
      const other = hex(theme, "--energy-other");
      for (const s of SERIES) {
        const c = hex(theme, s);
        expect(ratio(c, other), `${s} ${c} / ${other}`).toBeGreaterThanOrEqual(1.5);
        expect(hueGap(c, other), `${s} ${c} / ${other}`).toBeGreaterThanOrEqual(30);
      }
    });
  }

  it("makes the first Analyse series visible on the dark card (was 2.02:1)", () => {
    expect(seriesPaint(SERIES_COLORS[0])).toBe("var(--color-series-1)");
    expect(ratio(hex("dark", "--series-1"), hex("dark", SURFACE))).toBeGreaterThanOrEqual(3);
  });

  it("stores the light value of each token as the Analyse hex identity", () => {
    expect(SERIES_COLORS).toEqual(SERIES.map((s) => hex("light", s)));
  });
});

describe("seriesPaint (Analyse)", () => {
  it("paints a palette hex with its themed variable, whatever its case", () => {
    expect(seriesPaint("#6a7b27")).toBe("var(--color-series-2)");
  });

  it("maps a chart saved with the old palette to the entry at the same place", () => {
    // Amber, red and orange of the old palette must not come back on screen.
    expect(seriesPaint("#D4963F")).toBe("var(--color-series-2)");
    expect(seriesPaint("#E74C3C")).toBe("var(--color-series-5)");
    expect(seriesPaint("#F39C12")).toBe("var(--color-series-7)");
  });

  it("paints a freely chosen colour as is", () => {
    expect(seriesPaint("#123456")).toBe("#123456");
  });
});

describe("seriesDrawnHex (the custom colour input's starting value)", () => {
  // What the browser computes for the aliases in dark: the dark tokens.
  const darkVar = (name: string) => {
    const n = /^--color-series-(\d)$/.exec(name)?.[1];
    return n ? ` ${hex("dark", `--series-${n}`)}` : "";
  };

  it("opens on the themed colour drawn, not on the stored hex", () => {
    expect(seriesDrawnHex("#6A7B27", darkVar)).toBe(hex("dark", "--series-2"));
    // A chart saved with the old red: drawn as series 5, so opens there.
    expect(seriesDrawnHex("#E74C3C", darkVar)).toBe(hex("dark", "--series-5"));
  });

  it("falls back on the entry's light hex when nothing is computed", () => {
    expect(seriesDrawnHex("#E74C3C", () => "")).toBe(SERIES_COLORS[4]);
  });

  it("keeps a freely chosen colour", () => {
    expect(seriesDrawnHex("#123456", darkVar)).toBe("#123456");
  });
});

describe("sub-meter colours", () => {
  it("take the themed series variable by sorted index, wrapping after eight", () => {
    expect(pickSubmeterColor(0)).toBe("var(--color-series-1)");
    expect(pickSubmeterColor(9)).toBe("var(--color-series-2)");
    expect(seriesColor(7)).toBe("var(--color-series-8)");
  });

  it("follow the server's colorIndex, and fall back on its hex without one", () => {
    expect(byUsageSeriesColor({ color: "#60A5FA", colorIndex: 3 })).toBe("var(--color-series-4)");
    expect(byUsageSeriesColor({ color: "#60A5FA" })).toBe("#60A5FA");
  });
});

// #1126 — the energy palette tells marks apart; it is not a text colour. Words
// take a text colour, computed here on the background they sit on.
const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/** `--color-x` (index.css) → the token it aliases. */
function alias(name: string): string {
  const m = indexCss.match(new RegExp(`--color-${name}:\\s*var\\((--[\\w-]+)\\)`));
  if (!m) throw new Error(`--color-${name} is not a token alias in index.css`);
  return m[1];
}

function mixHex(fg: string, bg: string, alpha: number): string {
  const [f, b] = [rgb(fg), rgb(bg)];
  return (
    "#" +
    f
      .map((c, i) =>
        Math.round((c * alpha + b[i] * (1 - alpha)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** What the browser paints for a CSS colour the components write: a
 *  `var(--color-x)`, or a `color-mix(in srgb, A p%, B)` where a transparent B
 *  is the card it sits on. */
function paint(theme: Theme, css: string): string {
  const v = /^var\(--color-([\w-]+)\)$/.exec(css);
  if (v) return hex(theme, alias(v[1]));
  const m = /^color-mix\(in srgb, (.+) (\d+)%, (.+)\)$/.exec(css);
  if (m) {
    const under = m[3] === "transparent" ? hex(theme, SURFACE) : paint(theme, m[3]);
    return mixHex(paint(theme, m[1]), under, Number(m[2]) / 100);
  }
  throw new Error(`cannot resolve ${css}`);
}

describe("words in the energy surfaces reach 4.5:1 (#1126)", () => {
  const STATES = [
    "granted",
    "granted-idle",
    "pending",
    "revoked",
    "unmanaged",
    "suspended",
    "idle",
  ] as const;

  for (const theme of ["light", "dark"] as const) {
    it.each(STATES)(`${theme}: the arbiter pill « %s » reads on its tint`, (s) => {
      const [ink, bg] = [paint(theme, loadStateInk(s)), paint(theme, loadStatePillBg(s))];
      expect(ratio(ink, bg), `${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });

    it.each([
      [300, false],
      [-200, false],
      [null, false],
      [null, true],
    ] as const)(
      `${theme}: the surplus sticker (%s W, night %s) reads on its tint`,
      (w, dormant) => {
        const hue = dormant ? "var(--color-slate)" : surplusStickerColor(w);
        const ink = paint(theme, surplusStickerInk(w, dormant));
        const bg = paint(theme, `color-mix(in srgb, ${hue} 12%, transparent)`);
        expect(ratio(ink, bg), `${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      },
    );
  }

  // A text colour set from a series constant or token, anywhere in a style
  // object (several lines included). Fills, strokes, swatches and borders are
  // what the palette is for. A colour passed through a local variable is not
  // seen: the computed checks above and the component tests cover those.
  const componentsRoot = fileURLToPath(new URL("../components", import.meta.url));
  const scope = [
    ...["energy", "flow", "history", "equipments/ev-sessions"].flatMap((dir) =>
      readdirSync(join(componentsRoot, dir)).map((f) => join(dir, f)),
    ),
    "equipments/UpsPanel.tsx",
    "equipments/PvForecastPanel.tsx",
    "equipments/PvHealthPanel.tsx",
  ]
    .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
    .map((f) => ({ f, text: readFileSync(join(componentsRoot, f), "utf8") }));
  const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

  it("writes no word in an energy colour (tooltips, flow figures, totals)", () => {
    const textInPalette =
      /style=\{\{[^}]*?(?<![\w-])color:\s*(?:[A-Z_]+_COLOR\b|"var\(--color-(?:energy|solar|series|slate)[\w-]*\)")/g;
    const hits = scope.flatMap(({ f, text }) =>
      [...text.matchAll(textInPalette)].map((m) => `${f}:${lineOf(text, m.index)}`),
    );
    expect(hits).toEqual([]);
  });

  it("gives every Recharts default tooltip neutral rows", () => {
    // Without `content` or `itemStyle`, Recharts writes each row in its
    // series colour: the PV forecast's « Attendu » was 2.97:1 on a light card.
    const hits = scope.flatMap(({ f, text }) =>
      [...text.matchAll(/<Tooltip\b[\s\S]*?\/>/g)]
        .filter((m) => !/\b(content|itemStyle)=/.test(m[0]))
        .map((m) => `${f}:${lineOf(text, m.index)}`),
    );
    expect(hits).toEqual([]);
  });
});

describe("lint: no colour literal in the energy components", () => {
  const uiRoot = fileURLToPath(new URL("../..", import.meta.url));

  /** Lines (1-based) the rule reports for `source` linted as `filePath`. */
  async function flagged(
    source: string,
    filePath = "src/components/energy/Fixture.tsx",
  ): Promise<number[]> {
    const eslint = new ESLint({ cwd: uiRoot });
    const [result] = await eslint.lintText(source, { filePath });
    return result.messages
      .filter((m) => m.ruleId === "sowel-chart/no-hex-color")
      .map((m) => m.line);
  }

  const FIXTURE = `
export const a = "#4F7BE8";
export const b = { fill: "#6b93f0" };
export const c = \`1px solid #fff\`;
export const ok1 = "var(--color-energy-hp)";
export const ok2 = "url(#powerGradient)";
`;

  it("flags hex literals in every folder in scope", async () => {
    for (const file of [
      "src/components/energy/Fixture.tsx",
      "src/components/history/Fixture.tsx",
      "src/components/settings/TariffSettings.tsx",
      "src/components/equipments/UpsPanel.tsx",
      "src/components/equipments/ev-sessions/Fixture.tsx",
    ]) {
      expect(await flagged(FIXTURE, file), file).toEqual([2, 3, 4]);
    }
  }, 30_000);

  it("leaves tests and other folders alone", async () => {
    expect(await flagged(FIXTURE, "src/components/energy/Fixture.test.tsx")).toEqual([]);
    expect(await flagged(FIXTURE, "src/lib/Fixture.ts")).toEqual([]);
    expect(await flagged(FIXTURE, "src/components/equipments/OtherPanel.tsx")).toEqual([]);
  }, 30_000);

  it("flags every colour shape and the rgb()/hsl() literals", async () => {
    const source = [
      'export const a = "#ABC";',
      'export const b = "#4F7BE8CC";',
      'export const c = "#fff8";',
      'export const d = "bg-[#4F7BE8]";',
      'export const e = "rgba(0,0,0,0.03)";',
      'export const f = "rgb(255 0 0)";',
      'export const g = "hsl(200, 50%, 50%)";',
      'export const h = "hsla(.5turn 50% 50% / .2)";',
      'export const i = "bg-[rgba(0,0,0,.1)]";',
      "export const j = `${1}px solid #000`;",
      'export const k = "linear-gradient(to right, #fff, transparent)";',
      'export const l = "color-mix(in srgb, #4F7BE8 40%, transparent)";',
    ].join("\n");
    expect(await flagged(source)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  }, 30_000);

  it("does not flag references, anchors, entities, issue numbers or other hex-like text", async () => {
    const source = [
      'export const a = "voir #617";',
      'export const b = "issue #1234 fixed";',
      'export const c = "fill: url(#abc)";',
      'export const d = <a href="#add">x</a>;',
      'export const e = <use xlinkHref={"#bad"} />;',
      'export const f = "&#123;";',
      'export const g = "#section-1";',
      'export const h = "#12345";',
      'export const i = "#abcdefg";',
      'export const j = "rgb(var(--x))";',
      'export const k = "a#fff";',
      'export const l = "Hors pilotage (#960)";',
    ].join("\n");
    expect(await flagged(source)).toEqual([]);
  }, 30_000);
});
