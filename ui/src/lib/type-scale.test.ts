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

async function restricted(code: string, filePath: string, rule = "sowel/type-scale"): Promise<string[]> {
  const eslint = new ESLint({ cwd: uiRoot });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === rule).map((m) => m.message);
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

// Review of phase 2: the selectors these rules replaced read whole strings, so
// a variant (`sm:uppercase`), an important mark (`!rounded-xl`) or a CSS
// property in brackets went through, and prose that merely held the word was
// at risk. They are now judged token by token, on strings that read as classes.
describe("lint: class tokens, variants included", () => {
  const code = `
export const a = "px-2 sm:uppercase";
export const b = "hover:!uppercase";
export const c = "p-2 !rounded-xl";
export const d = "rounded-2xs";
export const e = "md:rounded-[7px]";
export const f = "[font-size:13px] p-1";
export const g = "lg:!text-[13px]";
`;

  it("flags uppercase, radii and font sizes behind a variant or an important mark", async () => {
    expect(await restricted(code, "src/components/Fixture.tsx", "sowel/sentence-case")).toHaveLength(2);
    expect(await restricted(code, "src/components/Fixture.tsx", "sowel/radius-scale")).toHaveLength(3);
    expect(await restricted(code, "src/components/Fixture.tsx", "sowel/type-scale")).toHaveLength(2);
  }, 30_000);

  it("leaves prose, scale steps, table headers and a cut template token alone", async () => {
    const fine = `
export const p = "Write the label in uppercase, rounded and text-[13px].";
export const q = "rounded-t-lg rounded-sm md:rounded-md rounded-full rounded-xs";
export const r = (x: string) => \`rounded-\${x} p-2\`;
export const t = <table><thead><tr><th className="uppercase">A</th></tr></thead></table>;
`;
    for (const rule of ["sowel/sentence-case", "sowel/radius-scale", "sowel/type-scale"]) {
      expect(await restricted(fine, "src/components/Fixture.tsx", rule), rule).toEqual([]);
    }
  }, 30_000);

  it("is separate from the formatting rules, so a font-size exception leaves toFixed checked", async () => {
    const code = `
// eslint-disable-next-line sowel/type-scale -- fluid
export const a = (v: number) => [\`text-[clamp(22px,14cqw,36px)]\`, v.toFixed(1)];
`;
    expect(await restricted(code, "src/components/Fixture.tsx")).toEqual([]);
    expect(await restricted(code, "src/components/Fixture.tsx", "no-restricted-syntax")).toHaveLength(1);
  }, 30_000);
});
