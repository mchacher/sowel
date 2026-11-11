import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// #1187 — scripts/check-bundle-budget.mjs, the CI gate on the first load,
// checked on a fake dist: a gate that read nothing would pass everything.
const script = fileURLToPath(new URL("../../scripts/check-bundle-budget.mjs", import.meta.url));

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function dist(files: Record<string, number>, preload: string[]): string {
  dir = mkdtempSync(join(tmpdir(), "bundle-budget-"));
  mkdirSync(join(dir, "assets"));
  for (const [name, size] of Object.entries(files)) {
    writeFileSync(join(dir, "assets", name), "x".repeat(size));
  }
  const links = preload
    .map((p) => `<link rel="modulepreload" crossorigin href="/assets/${p}">`)
    .join("\n");
  writeFileSync(
    join(dir, "index.html"),
    `<html><head><script src="/splash.js"></script>
<script type="module" crossorigin src="/assets/index-a.js"></script>
${links}</head></html>`,
  );
  return dir;
}

function run(distDir: string) {
  return spawnSync(process.execPath, [script, distDir], { encoding: "utf8" });
}

describe("check-bundle-budget", () => {
  it("passes a first load within budget, lazy chunks not counted", () => {
    const r = run(
      dist({ "index-a.js": 800_000, "client-b.js": 300_000, "hls-c.js": 600_000 }, ["client-b.js"]),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/assets\/client-b\.js/);
    expect(r.stdout).not.toMatch(/hls-c/);
  });

  it("fails an entry chunk over budget", () => {
    const r = run(dist({ "index-a.js": 1_100_000 }, []));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/entry chunk/);
  });

  it("fails a first load over budget through its preloaded chunks", () => {
    const r = run(dist({ "index-a.js": 900_000, "recharts-b.js": 600_000 }, ["recharts-b.js"]));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/first load/);
  });

  it("fails when index.html has no module entry", () => {
    dir = mkdtempSync(join(tmpdir(), "bundle-budget-"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    expect(run(dir).status).toBe(1);
  });
});
