/**
 * Rewrite the EDF Tarif Bleu rows of the price file from the CRE open data
 * (spec 203). Run by `.github/workflows/tariffs.yml` every night, and by hand:
 *
 *   npx tsx scripts/tariffs/update-edf-tarif-bleu.ts
 *   npx tsx scripts/tariffs/update-edf-tarif-bleu.ts --base Option_Base.csv --hphc Option_HPHC.csv
 *   npx tsx scripts/tariffs/update-edf-tarif-bleu.ts --summary summary.md
 *
 * It writes nothing when the rows did not change, and fails without writing
 * when a CRE file cannot be read as expected or when a published row would
 * disappear. `--summary` receives what changed, in Markdown, for the pull
 * request body. Nothing is published by this script: the file reaches the
 * instances only once a maintainer has merged the pull request.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PriceFile, PriceFileRow } from "../../src/shared/types.js";
import {
  CRE_BASE_URL,
  CRE_HPHC_URL,
  buildEdfTarifBleu,
  diffRows,
} from "../../src/energy/price-file/cre-csv.js";
import {
  PRICE_FILE_FORMAT,
  parsePriceFile,
  serializePriceFile,
} from "../../src/energy/price-file/price-file.js";

const FILE = "tariffs/electricity-prices.json";

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function csv(localPath: string | null, url: string): Promise<string> {
  if (localPath) return readFileSync(localPath, "utf-8");
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

function describe(row: PriceFileRow): string {
  const prices =
    row.contractType === "base" ? `${row.hp} €/kWh` : `HP ${row.hp}, HC ${row.hc} €/kWh`;
  return `${row.startDate}, ${row.contractType}, ${row.kva} kVA: ${prices}, ${row.fixedFeeYear} €/year`;
}

async function main(): Promise<void> {
  const [baseCsv, hphcCsv] = await Promise.all([
    csv(option("base"), CRE_BASE_URL),
    csv(option("hphc"), CRE_HPHC_URL),
  ]);
  const supplier = buildEdfTarifBleu(baseCsv, hphcCsv);

  const current: PriceFile = existsSync(FILE)
    ? parsePriceFile(JSON.parse(readFileSync(FILE, "utf-8")))
    : { format: PRICE_FILE_FORMAT, generatedAt: "1970-01-01", suppliers: [] };
  const published = current.suppliers.find((s) => s.id === supplier.id)?.prices ?? [];
  const changes = diffRows(published, supplier.prices);

  if (changes.removed.length > 0) {
    throw new Error(
      `${changes.removed.length} published row(s) are no longer in the CRE files, first: ` +
        `${describe(changes.removed[0])}. Not writing: check the source by hand.`,
    );
  }
  if (changes.added.length === 0 && changes.changed.length === 0) {
    console.log(`No change: ${supplier.prices.length} rows, as published.`);
    return;
  }

  const next: PriceFile = {
    format: PRICE_FILE_FORMAT,
    generatedAt: new Date().toISOString().slice(0, 10),
    suppliers: [...current.suppliers.filter((s) => s.id !== supplier.id), supplier].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  };
  // What is written is read back through the same check the instances apply.
  const text = serializePriceFile(next);
  parsePriceFile(JSON.parse(text));
  writeFileSync(FILE, text);

  const summary = [
    `EDF Tarif Bleu, from the CRE open data: ${changes.added.length} row(s) added, ` +
      `${changes.changed.length} changed, ${supplier.prices.length} in all.`,
    "",
    ...(changes.changed.length > 0
      ? [
          "**Rows whose figures changed for a period already published.** Instances that already",
          "took them keep the old figures: check the source before merging.",
          "",
          ...changes.changed.map((c) => `- was \`${describe(c.before)}\`, now \`${describe(c.after)}\``),
          "",
        ]
      : []),
    ...(changes.added.length > 0
      ? ["**Added**", "", ...changes.added.map((row) => `- \`${describe(row)}\``), ""]
      : []),
  ].join("\n");
  console.log(summary);
  const summaryPath = option("summary");
  if (summaryPath) writeFileSync(summaryPath, summary);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
