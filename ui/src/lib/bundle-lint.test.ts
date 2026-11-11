import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #1187 — the lint rule that keeps the whole Lucide set and hls.js out of the
// first load, checked on a fixture: a rule that silently matched nothing would
// let a namespace import put ~1,600 icons back into the entry chunk.
const uiRoot = fileURLToPath(new URL("../..", import.meta.url));

async function restricted(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: uiRoot });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("lint: imports that defeat code splitting", () => {
  it("flags a namespace import of lucide-react and its icons map", async () => {
    const messages = await restricted(
      `import * as L from "lucide-react";\nimport { icons } from "lucide-react";\nexport const x = [L, icons];\n`,
      "src/components/Fixture.tsx",
    );
    expect(messages.map((m) => m.line)).toEqual([1, 2]);
    expect(messages.every((m) => m.severity === 2)).toBe(true);
    expect(messages[0].message).toMatch(/plugin-icons/);
  }, 30_000);

  it("flags lucide-react/dynamic", async () => {
    const messages = await restricted(
      `import { DynamicIcon } from "lucide-react/dynamic";\nexport const x = DynamicIcon;\n`,
      "src/components/Fixture.tsx",
    );
    expect(messages).toHaveLength(1);
  }, 30_000);

  it("flags a static import of hls.js, not a type import or import()", async () => {
    const messages = await restricted(
      `import Hls from "hls.js";\nimport type H from "hls.js";\nexport const load = () => import("hls.js");\nexport const x: H | typeof Hls | null = null;\n`,
      "src/components/Fixture.tsx",
    );
    expect(messages.map((m) => m.line)).toEqual([1]);
    expect(messages[0].message).toMatch(/import\("hls\.js"\)/);
  }, 30_000);

  it("flags import() and export * of lucide-react", async () => {
    const eslint = new ESLint({ cwd: uiRoot });
    const [result] = await eslint.lintText(
      `export * from "lucide-react";\nexport const load = () => import("lucide-react");\n`,
      { filePath: "src/components/Fixture.tsx" },
    );
    const lucide = result.messages.filter(
      (m) => m.ruleId === "no-restricted-syntax" && /lucide-react/.test(m.message),
    );
    expect(lucide.map((m) => m.line)).toEqual([1, 2]);
  }, 30_000);

  it("leaves named icon imports alone", async () => {
    const messages = await restricted(
      `import { Cpu, House } from "lucide-react";\nexport const x = [Cpu, House];\n`,
      "src/components/Fixture.tsx",
    );
    expect(messages).toEqual([]);
  }, 30_000);
});
