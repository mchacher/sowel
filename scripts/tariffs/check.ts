/**
 * Check the committed price file (spec 203): the format an instance accepts,
 * rows sorted and unique, prices and fees in range. Run in CI on every pull
 * request, and by hand:
 *
 *   npx tsx scripts/tariffs/check.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePriceFile, serializePriceFile } from "../../src/energy/price-file/price-file.js";

const FILE = resolve(import.meta.dirname, "../../tariffs/electricity-prices.json");

try {
  const text = readFileSync(FILE, "utf-8");
  const file = parsePriceFile(JSON.parse(text));
  // One row per line, as the update script writes it: a hand edit that
  // reflows the file would make every later pull request unreadable.
  if (serializePriceFile(file) !== text) {
    throw new Error("the file is not laid out as the update script writes it (one row per line)");
  }
  const rows = file.suppliers.reduce((n, s) => n + s.prices.length, 0);
  console.log(`tariffs/electricity-prices.json ✓ ${file.suppliers.length} supplier(s), ${rows} rows`);
} catch (err) {
  console.error(`❌ tariffs/electricity-prices.json: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
