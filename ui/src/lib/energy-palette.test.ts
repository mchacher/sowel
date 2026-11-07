import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { SERIES_COLORS, seriesPaint } from "./series-palette";
import { byUsageSeriesColor, pickSubmeterColor, seriesColor } from "../components/energy/submeterPalette";

// Spec 196 (FR-E) — the energy palette. Series drawn side by side (stacked
// bars, the Live diagram, a legend row, the series palette's neighbours) must
// be told apart: by lightness (>= 2:1 in dark, >= 1.5:1 in light) or by hue
// (>= 30 deg). Each mark must stand on the dark card (>= 3:1). Computed from
// design-system/tokens.css, so a token change that breaks a pair fails here.
const tokensCss = readFileSync(new URL("../../../design-system/tokens.css", import.meta.url), "utf8");

type Theme = "light" | "dark";

function themeVars(theme: Theme): Record<string, string> {
  const selector = theme === "light" ? /:root,\s*\[data-theme="hybrid"\]\s*\{/ : /\[data-theme="dark"\],\s*\.dark\s*\{/;
  const start = tokensCss.search(selector);
  const body = tokensCss.slice(tokensCss.indexOf("{", start) + 1, tokensCss.indexOf("\n}", start));
  const vars: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

const LIGHT = themeVars("light");
const VARS: Record<Theme, Record<string, string>> = { light: LIGHT, dark: { ...LIGHT, ...themeVars("dark") } };

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

/** Pairs that sit next to each other somewhere, and where. */
const NEIGHBOURS: Array<[string, string, string]> = [
  ["--energy-hp", "--energy-hc", "Consumption bars, EV share bar"],
  ["--energy-hc", "--solar-auto", "Consumption bars, EV share bar"],
  ["--energy-hp", "--solar-auto", "Consumption bars, UPS panel"],
  ["--solar-auto", "--solar-injection", "Production bars"],
  ["--energy-hp", "--energy-grid", "Live diagram, UPS panel"],
  ["--energy-grid", "--solar-auto", "Live diagram"],
  ["--energy-grid", "--slate-neutral", "Live page: grid node, arbiter 'hors pilotage'"],
  ["--slate-neutral", "--solar-auto", "Arbiter legend"],
];

const SERIES = Array.from({ length: 8 }, (_, i) => `--series-${i + 1}`);
const SURFACE = "--n-0";

describe("energy palette: neighbouring series are told apart (spec 196, FR-E)", () => {
  for (const theme of ["light", "dark"] as const) {
    it.each(NEIGHBOURS)(`${theme}: %s / %s (%s)`, (a, b) => {
      const [ca, cb] = [hex(theme, a), hex(theme, b)];
      const r = ratio(ca, cb);
      const gap = hueGap(ca, cb);
      expect(r >= MIN_RATIO[theme] || gap >= 30, `${ca} / ${cb}: ${r.toFixed(2)}:1, ${gap.toFixed(0)} deg`).toBe(true);
    });
  }

  it.each([...NEIGHBOURS.flatMap(([a, b]) => [a, b]), "--solar-production", "--energy-other"])(
    "dark: %s stands on the card (>= 3:1)",
    (token) => {
      expect(ratio(hex("dark", token), hex("dark", SURFACE))).toBeGreaterThanOrEqual(3);
    },
  );

  it("keeps the 'hors pilotage' slate readable as text in both themes (pill, caption)", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(ratio(hex(theme, "--slate-neutral"), hex(theme, SURFACE))).toBeGreaterThanOrEqual(4.2);
    }
  });
});

describe("series palette (sub-meters, phases, Analyse)", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme}: each series stands on the card (>= 3:1)`, () => {
      for (const s of SERIES) expect(ratio(hex(theme, s), hex(theme, SURFACE)), s).toBeGreaterThanOrEqual(3);
    });

    it(`${theme}: neighbours, the last and the first included, differ by >= 2:1 or >= 30 deg`, () => {
      SERIES.forEach((s, i) => {
        const [a, b] = [hex(theme, s), hex(theme, SERIES[(i + 1) % SERIES.length])];
        const ok = ratio(a, b) >= 2 || hueGap(a, b) >= 30;
        expect(ok, `${s}: ${a} / ${b}`).toBe(true);
      });
    });

    it(`${theme}: no series takes a role's hue (warning, error, on, success, solar)`, () => {
      const roles = ["--orange-500", "--red-500", "--a-500", "--green-500", "--solar-auto"].map((t) => hex(theme, t));
      for (const s of SERIES) {
        for (const role of roles) expect(hueGap(hex(theme, s), role), `${s} vs ${role}`).toBeGreaterThanOrEqual(20);
      }
    });

    it(`${theme}: the 'Other' slice differs from every series`, () => {
      const other = hex(theme, "--energy-other");
      for (const s of SERIES) {
        const c = hex(theme, s);
        expect(ratio(c, other) >= 1.4 || hueGap(c, other) >= 30, s).toBe(true);
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

describe("sub-meter colours", () => {
  it("take the themed series variable by sorted index, wrapping after eight", () => {
    expect(pickSubmeterColor(0)).toBe("var(--color-series-1)");
    expect(pickSubmeterColor(9)).toBe("var(--color-series-2)");
    expect(seriesColor(7)).toBe("var(--color-series-8)");
  });

  it("follow the server's colorIndex, and fall back on its hex without one", () => {
    expect(byUsageSeriesColor({ color: "#1A4F6E", colorIndex: 3 })).toBe("var(--color-series-4)");
    expect(byUsageSeriesColor({ color: "#1A4F6E" })).toBe("#1A4F6E");
  });
});

describe("lint: no hex colour in energy and history components", () => {
  const uiRoot = fileURLToPath(new URL("../..", import.meta.url));
  const FIXTURE = `
export const a = "#4F7BE8";
export const b = { fill: "#6b93f0" };
export const c = \`1px solid #fff\`;
export const ok1 = "var(--color-energy-hp)";
export const ok2 = "url(#powerGradient)";
`;
  async function hexMessages(filePath: string): Promise<number> {
    const eslint = new ESLint({ cwd: uiRoot });
    const [result] = await eslint.lintText(FIXTURE, { filePath });
    return result.messages.filter((m) => m.ruleId === "sowel-chart/no-hex-color").length;
  }

  it("flags hex literals in the chart folders", async () => {
    expect(await hexMessages("src/components/energy/Fixture.tsx")).toBe(3);
    expect(await hexMessages("src/components/history/Fixture.tsx")).toBe(3);
  }, 30_000);

  it("leaves tests and other folders alone", async () => {
    expect(await hexMessages("src/components/energy/Fixture.test.tsx")).toBe(0);
    expect(await hexMessages("src/lib/Fixture.ts")).toBe(0);
  }, 30_000);
});
