import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Spec 196, FR-5 (slice 5a) — the variable font, the type scale and the lint
// rule that keeps arbitrary sizes out.
const uiRoot = fileURLToPath(new URL("../..", import.meta.url));
const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const tokensCss = readFileSync(new URL("../../../design-system/tokens.css", import.meta.url), "utf8");

const SCALE: Record<string, number> = {
  micro: 11,
  caption: 12,
  small: 13,
  body: 14,
  lead: 16,
  title: 20,
  display: 28,
  value: 40,
};

describe("fonts", () => {
  it("loads Inter as the variable build, not static weights", () => {
    expect(indexCss).toMatch(/@import "@fontsource-variable\/inter\/[a-z]+\.css";/);
    expect(indexCss).not.toMatch(/@fontsource\/inter\//);
  });

  it("names the family Inter Variable first, or the face never matches", () => {
    // Fontsource registers the variable build as 'Inter Variable'; a stack that
    // starts with 'Inter' falls back to system-ui without any error.
    expect(tokensCss).toMatch(/--font-body:\s*'Inter Variable',/);
  });

  it("loads JetBrains Mono at 400 only", () => {
    const weights = [...indexCss.matchAll(/@fontsource\/jetbrains-mono\/(\d+)\.css/g)].map((m) => m[1]);
    expect(weights).toEqual(["400"]);
  });
});

describe("type scale", () => {
  it.each(Object.entries(SCALE))("text-%s is %i px and exposed to Tailwind", (name, px) => {
    expect(tokensCss).toMatch(new RegExp(`--fs-${name}:\\s*${px}px;`));
    expect(indexCss).toMatch(new RegExp(`--text-${name}: var\\(--fs-${name}\\);`));
  });

  it("sets the size only, so every row keeps the inherited 20 px line height", () => {
    expect(indexCss).not.toMatch(/--text-[a-z]+--line-height/);
  });

  it("drops the dead --font-size-* tokens Tailwind 4 never turned into classes", () => {
    expect(indexCss).not.toMatch(/--font-size-data/);
  });
});

async function restricted(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: uiRoot });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

describe("lint: no arbitrary font size", () => {
  it("flags px, rem and fluid sizes in classes and template literals, and literal fontSize", async () => {
    const code = `
export const a = "text-[13px] font-medium";
export const b = "sm:text-[.82rem]";
export const c = (on: boolean) => \`px-2 text-[10.4px] \${on ? "x" : "y"}\`;
export const d = "text-[clamp(22px,14cqw,36px)]";
export const e = { fontSize: 10 };
export const f = { fontSize: "26px" };
`;
    const messages = await restricted(code, "src/components/Fixture.tsx");
    expect(messages).toHaveLength(6);
    expect(messages.slice(0, 4).every((m) => /type scale/.test(m))).toBe(true);
    expect(messages.slice(4).every((m) => /CHART_TICK_FONT/.test(m))).toBe(true);
  }, 30_000);

  it("leaves scale steps, colours in brackets and named chart sizes alone", async () => {
    const code = `
const CHART_TICK_FONT = 11;
export const a = "text-small sm:text-lead text-text-secondary";
export const b = "text-[var(--green-700)]";
export const c = { fontSize: CHART_TICK_FONT };
`;
    expect(await restricted(code, "src/components/Fixture.tsx")).toEqual([]);
  }, 30_000);
});
