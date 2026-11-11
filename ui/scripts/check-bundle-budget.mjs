#!/usr/bin/env node
// #1187 — the size budget of the UI's first load, checked after `vite build`.
//
// The first load is what `dist/index.html` fetches before anything renders:
// the entry module and the chunks it statically imports (the modulepreload
// links Vite writes). Lazy pages, recharts and hls.js are not in it. A change
// that pulls one of them back into the first load, or grows it past the
// budget, fails here with the list of files and their sizes.
//
// Usage: node scripts/check-bundle-budget.mjs [distDir]

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** Raw bytes. The entry chunk alone, and everything the first load fetches. */
export const BUDGET = {
  entry: 1_000_000,
  initial: 1_400_000,
};

const distDir = process.argv[2] ?? "dist";
const html = readFileSync(join(distDir, "index.html"), "utf8");

const entry = [...html.matchAll(/<script[^>]*type="module"[^>]*src="\/(assets\/[^"]+\.js)"/g)].map(
  (m) => m[1],
);
const preloads = [
  ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/(assets\/[^"]+\.js)"/g),
].map((m) => m[1]);

if (entry.length !== 1) {
  console.error(
    `check-bundle-budget: expected one module entry in index.html, found ${entry.length}`,
  );
  process.exit(1);
}

const files = [...entry, ...preloads].map((path) => {
  const bytes = readFileSync(join(distDir, path));
  return { path, raw: statSync(join(distDir, path)).size, gzip: gzipSync(bytes).length };
});
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const entryRaw = files[0].raw;
const initialRaw = files.reduce((s, f) => s + f.raw, 0);
const initialGzip = files.reduce((s, f) => s + f.gzip, 0);

for (const f of files)
  console.log(`${kb(f.raw).padStart(10)}  ${kb(f.gzip).padStart(10)} gz  ${f.path}`);
console.log(`entry ${kb(entryRaw)} (budget ${kb(BUDGET.entry)})`);
console.log(`first load ${kb(initialRaw)}, ${kb(initialGzip)} gzip (budget ${kb(BUDGET.initial)})`);

const failures = [];
if (entryRaw > BUDGET.entry) failures.push(`entry chunk ${kb(entryRaw)} > ${kb(BUDGET.entry)}`);
if (initialRaw > BUDGET.initial)
  failures.push(`first load ${kb(initialRaw)} > ${kb(BUDGET.initial)}`);
if (failures.length > 0) {
  console.error(`check-bundle-budget: over budget (#1187): ${failures.join("; ")}`);
  process.exit(1);
}
