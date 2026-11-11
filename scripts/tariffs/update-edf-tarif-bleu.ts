/**
 * Rewrite the EDF Tarif Bleu rows of the price file from the CRE open data
 * (spec 203). Run by `.github/workflows/tariffs.yml` every night, and by hand:
 *
 *   npx tsx scripts/tariffs/update-edf-tarif-bleu.ts
 *   npx tsx scripts/tariffs/update-edf-tarif-bleu.ts --base Option_Base.csv --hphc Option_HPHC.csv
 *   npx tsx scripts/tariffs/update-edf-tarif-bleu.ts --summary summary.md
 *   npx tsx scripts/tariffs/update-edf-tarif-bleu.ts --allow-removal
 *
 * It writes nothing when the rows did not change, and fails without writing
 * when a CRE file cannot be read as expected or when a published row would
 * disappear (`--allow-removal` accepts it, once a maintainer has checked the
 * source). `--summary` receives what changed, in Markdown, for the pull
 * request body. Nothing is published by this script: the file reaches the
 * instances only once a maintainer has merged the pull request.
 *
 * The rules live in `src/energy/price-file/cre-csv.ts` (`planSupplierUpdate`),
 * where they are tested; this file only reads and writes.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CRE_BASE_URL,
  CRE_HPHC_URL,
  buildEdfTarifBleu,
  planSupplierUpdate,
} from "../../src/energy/price-file/cre-csv.js";
import { parsePriceFile, serializePriceFile } from "../../src/energy/price-file/price-file.js";

const FILE = resolve(import.meta.dirname, "../../tariffs/electricity-prices.json");

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

async function csv(localPath: string | null, url: string): Promise<string> {
  if (localPath) return readFileSync(localPath, "utf-8");
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  const summaryPath = option("summary");
  const [baseCsv, hphcCsv] = await Promise.all([
    csv(option("base"), CRE_BASE_URL),
    csv(option("hphc"), CRE_HPHC_URL),
  ]);
  const current = existsSync(FILE) ? parsePriceFile(JSON.parse(readFileSync(FILE, "utf-8"))) : null;
  const update = planSupplierUpdate(
    current,
    buildEdfTarifBleu(baseCsv, hphcCsv),
    new Date().toISOString().slice(0, 10),
    { allowRemoval: flag("allow-removal") },
  );
  if (!update.next) {
    console.log("No change: the rows are as published.");
    return;
  }
  writeFileSync(FILE, serializePriceFile(update.next));
  console.log(update.summary);
  if (summaryPath) writeFileSync(summaryPath, update.summary);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
