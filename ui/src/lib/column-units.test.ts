import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { hasUnit } from "./column-units";
import en from "../i18n/locales/en.json";
import fr from "../i18n/locales/fr.json";

// Every `<thead>` of the app: a header text that holds a unit goes through
// ColumnLabel, or the header's `uppercase` changes the unit's case again. A
// `title` tooltip is not uppercased and is left alone.
const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const locales: Record<string, string>[] = [fr, en];

describe("uppercase column headers keep units in their own case (#1231)", () => {
  it("routes every unit-bearing header text through ColumnLabel", () => {
    const files = readdirSync(srcRoot, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
    );
    const bad: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(srcRoot, file), "utf8");
      for (const head of src.matchAll(/<thead>([\s\S]*?)<\/thead>/g)) {
        for (const call of head[1].matchAll(/(<ColumnLabel text=\{|title=\{)?t\("([^"]+)"/g)) {
          const key = call[2];
          if (call[1] || !locales.some((l) => hasUnit(l[key] ?? ""))) continue;
          bad.push(`${file}: ${key}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
