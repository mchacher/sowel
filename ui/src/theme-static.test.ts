import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Spec 196 (FR-E) — the charts paint the energy and series colours through
// inline styles and SVG attributes (`var(--color-series-5)`). Tailwind v4 emits
// a plain @theme variable only when it sees it used, so an alias no utility
// class names could vanish from the build and leave a bar unpainted. The
// aliases sit in `@theme static`, which is always emitted. Nothing in jsdom
// runs Tailwind, so this reads the stylesheet.
const srcDir = fileURLToPath(new URL(".", import.meta.url));
const css = readFileSync(join(srcDir, "index.css"), "utf8");

/** The body of every `<at-rule> {` block whose header matches, braces balanced. */
function blocks(source: string, header: RegExp): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(new RegExp(header.source, "g"))) {
    let depth = 0;
    const open = source.indexOf("{", m.index);
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") depth -= 1;
      if (depth === 0) {
        out.push(source.slice(open + 1, i));
        break;
      }
    }
  }
  return out;
}

const declared = (body: string) => new Set([...body.matchAll(/(--color-[\w-]+)\s*:/g)].map((m) => m[1]));

const staticVars = declared(blocks(css, /@theme\s+static\s*\{/).join("\n"));
const plainVars = declared(blocks(css, /@theme\s*\{/).join("\n"));

const ENERGY = /--color-(?:energy|solar|series|slate)(?:-[a-z0-9]+)*(?![\w-])/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("index.css — energy and series aliases are always emitted", () => {
  it("declares the energy aliases and the eight series in @theme static", () => {
    for (const v of [
      "--color-energy-hp",
      "--color-energy-hc",
      "--color-energy-grid",
      "--color-energy-other",
      "--color-solar-auto",
      "--color-solar-injection",
      "--color-solar-production",
      "--color-slate",
      ...Array.from({ length: 8 }, (_, i) => `--color-series-${i + 1}`),
    ]) {
      expect(staticVars.has(v), v).toBe(true);
    }
  });

  it("does not declare them again in a plain @theme", () => {
    for (const v of staticVars) expect(plainVars.has(v), v).toBe(false);
  });

  it("covers every energy or series alias the code paints with", () => {
    const used = new Set<string>();
    for (const file of sourceFiles(srcDir)) {
      if (file.endsWith("index.css")) continue;
      for (const m of readFileSync(file, "utf8").matchAll(ENERGY)) used.add(m[0]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const v of used) expect(staticVars.has(v), v).toBe(true);
  });
});
