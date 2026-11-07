import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Spec 196, FR-3 — the lint rule that keeps numbers on lib/format, checked on
// a fixture: a rule that silently matched nothing would let `toFixed` back in.
const uiRoot = fileURLToPath(new URL("../..", import.meta.url));

async function restricted(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: uiRoot });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

const FIXTURE = `
export const a = (v: number) => \`\${v.toFixed(1)} kWh\`;
export const b = new Intl.NumberFormat("fr-FR").format(1);
export const c = (1234).toLocaleString();
export const d = (1234).toLocaleString("fr-FR");
export const e = new Date().toLocaleDateString();
export const f = new Date().toLocaleTimeString([], { hour: "2-digit" });
export const g = new Date().toLocaleString(undefined, { month: "short" });
export const h = new Date().toLocaleDateString("fr-FR", { month: "short" });
export const i = new Intl.DateTimeFormat(undefined, { hour: "2-digit" }).format(0);
export const j = new Intl.DateTimeFormat([], { hour: "2-digit" }).format(0);
export const k = new Intl.DateTimeFormat().format(0);
export const l = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit" }).format(0);
`;

describe("lint: numbers go through lib/format", () => {
  it("flags toFixed, Intl.NumberFormat and a bare toLocaleString in rendering code", async () => {
    const messages = await restricted(FIXTURE, "src/components/Fixture.tsx");
    expect(messages).toHaveLength(9);
    expect(messages[0]).toMatch(/toFixed/);
    expect(messages[1]).toMatch(/lib\/format/);
    expect(messages[2]).toMatch(/toLocaleString/);
  }, 30_000);

  it("flags a date formatted in the browser's language, not one given a locale", async () => {
    const messages = await restricted(FIXTURE, "src/components/Fixture.tsx");
    // e (no argument), f ([]), g (undefined); h passes a locale and is fine. The same
    // for Intl.DateTimeFormat: i (undefined), j ([]), k (none); l is fine.
    expect(messages.slice(3)).toHaveLength(6);
    expect(messages.slice(3).every((m) => /currentLocale/.test(m))).toBe(true);
  }, 30_000);

  it("is an error, not a warning, now that every screen is migrated", async () => {
    const eslint = new ESLint({ cwd: uiRoot });
    const [result] = await eslint.lintText(FIXTURE, { filePath: "src/components/Fixture.tsx" });
    const severities = result.messages
      .filter((m) => m.ruleId === "no-restricted-syntax")
      .map((m) => m.severity);
    expect(new Set(severities)).toEqual(new Set([2]));
  }, 30_000);

  it("leaves lib/format itself and tests alone", async () => {
    expect(await restricted(FIXTURE, "src/lib/format.ts")).toEqual([]);
    expect(await restricted(FIXTURE, "src/components/Fixture.test.tsx")).toEqual([]);
  }, 30_000);
});

// #1129 — a percentage written by hand after a value (`{level}%`) skips the
// narrow no-break space French puts before « % » (« 66 % »). Text nodes only:
// a CSS length such as `${pct}%` in a style is not a number for reading.
describe("percentages go through formatPercent", () => {
  it("writes no `{value}%` text in rendering code", () => {
    const srcRoot = fileURLToPath(new URL("..", import.meta.url));
    const files = readdirSync(srcRoot, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
    );
    const hits = files.flatMap((f) => {
      const text = readFileSync(join(srcRoot, f), "utf8");
      return [...text.matchAll(/(^|>)\s*\{[^{}]+\}\s*%\s*(?=<|$)/gm)].map(
        (m) => `${f}:${text.slice(0, m.index).split("\n").length}`,
      );
    });
    expect(hits).toEqual([]);
  });
});
