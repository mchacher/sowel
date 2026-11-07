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
`;

describe("lint: numbers go through lib/format", () => {
  it("flags toFixed, Intl.NumberFormat and a bare toLocaleString in rendering code", async () => {
    const messages = await restricted(FIXTURE, "src/components/Fixture.tsx");
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatch(/toFixed/);
    expect(messages[1]).toMatch(/lib\/format/);
    expect(messages[2]).toMatch(/toLocaleString/);
  }, 30_000);

  it("leaves lib/format itself and tests alone", async () => {
    expect(await restricted(FIXTURE, "src/lib/format.ts")).toEqual([]);
    expect(await restricted(FIXTURE, "src/components/Fixture.test.tsx")).toEqual([]);
  }, 30_000);
});
