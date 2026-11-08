import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Issue #1141 — pages and components used to fall back to English literals when a request
// failed (`err instanceof Error ? err.message : "Failed to load zone"`), so a French UI
// read « Failed to … ». Failures go through `apiErrorText` / `apiErrorMessage` or a
// translated key. This guard scans the UI sources (tests excluded) for the two shapes the
// bug took: a « Failed to » string literal, and an English literal as the fallback of an
// error message.

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [path];
  });
}

/** Drop comments so a doc comment quoting the old text does not count. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function offenders(pattern: RegExp): string[] {
  return sources(SRC).flatMap((file) =>
    code(readFileSync(file, "utf8"))
      .split("\n")
      .filter((line) => pattern.test(line))
      .map((line) => `${relative(SRC, file)}: ${line.trim()}`),
  );
}

describe("no English error fallback in the UI", () => {
  it("scans a real source tree", () => {
    expect(sources(SRC).length).toBeGreaterThan(100);
  });

  it("has no « Failed to … » string literal", () => {
    expect(offenders(/["'`]Failed to\b/)).toEqual([]);
  });

  it("never falls back to an English literal after an error message", () => {
    expect(offenders(/\.message\s*:\s*["'`][A-Za-z]/)).toEqual([]);
  });
});
