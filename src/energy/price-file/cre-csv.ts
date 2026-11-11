/**
 * EDF Tarif Bleu from the CRE open data — spec 203.
 *
 * The CRE publishes the history of the regulated residential prices as two
 * CSV files, one per option. Both: CRLF line ends, `;` separator, decimal
 * comma, dates `DD/MM/YYYY`, an empty end date on the period in force. This
 * module turns them into the rows of the price file, and says what a fresh
 * conversion changes in the published file. Pure: the script that fetches the
 * files and writes the result is `scripts/tariffs/update-edf-tarif-bleu.ts`.
 *
 * It refuses anything it does not recognise rather than guess: these figures
 * end up pricing a household's bill.
 */

import type {
  PriceFile,
  PriceFileRow,
  PriceFileSupplier,
  PriceRowChanges,
} from "../../shared/types.js";
import { PRICE_FILE_FORMAT, compareRows, parsePriceFile } from "./price-file.js";

export const CRE_BASE_URL =
  "https://www.cre.fr/fileadmin/Documents/Open_data/Marches_de_detail/Option_Base.csv";
export const CRE_HPHC_URL =
  "https://www.cre.fr/fileadmin/Documents/Open_data/Marches_de_detail/Option_HPHC.csv";

const HEADERS = {
  base: "DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HT;PART_VARIABLE_TTC",
  hphc: "DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HC_HT;PART_VARIABLE_HC_TTC;PART_VARIABLE_HP_HT;PART_VARIABLE_HP_TTC",
} as const;

/** Column of each figure, incl. tax. */
const COLUMNS = {
  base: { fee: 4, hp: 6, hc: 6 },
  hphc: { fee: 4, hc: 6, hp: 8 },
} as const;

export class CreCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreCsvError";
  }
}

/**
 * A figure as the CRE writes it (`190,8131821`), rounded half up to
 * `decimals` on its decimal digits, not on its binary value: `1,005` at two
 * decimals is 1.01. Digits and one comma only; anything else is refused.
 */
export function decimal(raw: string, decimals: number, what: string, line: number): number {
  const match = /^(\d+)(?:,(\d+))?$/.exec(raw.trim());
  if (!match) {
    throw new CreCsvError(`Line ${line}: ${what} is not a number (${JSON.stringify(raw)})`);
  }
  const fraction = match[2] ?? "";
  let scaled = BigInt(match[1] + fraction.slice(0, decimals).padEnd(decimals, "0"));
  if (fraction.length > decimals && fraction[decimals] >= "5") scaled += 1n;
  return Number(scaled) / 10 ** decimals;
}

/** `01/08/2026` → `2026-08-01`. */
function isoDate(raw: string, line: number): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!match)
    throw new CreCsvError(`Line ${line}: ${JSON.stringify(raw)} is not a DD/MM/YYYY date`);
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    throw new CreCsvError(`Line ${line}: ${raw} is not a real day`);
  }
  return `${year}-${month}-${day}`;
}

/** The rows of one CRE file, sorted as the price file wants them. */
export function parseCreCsv(csv: string, contractType: "base" | "hphc"): PriceFileRow[] {
  // A byte order mark, should the file ever carry one.
  const lines = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines[0] !== HEADERS[contractType]) {
    throw new CreCsvError(
      `Unexpected header for the ${contractType} file: ${JSON.stringify(lines[0] ?? "")}`,
    );
  }
  const columns = COLUMNS[contractType];
  const width = HEADERS[contractType].split(";").length;
  const seen = new Set<string>();
  const rows: PriceFileRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = i + 1;
    const fields = lines[i].split(";");
    if (fields.length !== width) {
      throw new CreCsvError(`Line ${line}: ${fields.length} fields, expected ${width}`);
    }
    const startDate = isoDate(fields[0], line);
    const kva = decimal(fields[2], 0, "the subscribed power", line);
    const key = `${startDate}|${kva}`;
    if (seen.has(key)) {
      throw new CreCsvError(`Line ${line}: ${fields[0]} at ${kva} kVA is listed twice`);
    }
    seen.add(key);
    rows.push({
      contractType,
      kva,
      startDate,
      hp: decimal(fields[columns.hp], 4, "the peak price", line),
      hc: decimal(fields[columns.hc], 4, "the off-peak price", line),
      fixedFeeYear: decimal(fields[columns.fee], 2, "the fixed fee", line),
    });
  }
  if (rows.length === 0) throw new CreCsvError(`The ${contractType} file has no row`);
  return rows.sort(compareRows);
}

/** The EDF Tarif Bleu block of the price file, from the two CRE files. */
export function buildEdfTarifBleu(baseCsv: string, hphcCsv: string): PriceFileSupplier {
  return {
    id: "edf-tarif-bleu",
    name: "EDF, Tarif Bleu (tarif réglementé)",
    source:
      "CRE, historique des tarifs réglementés de vente d'électricité pour les consommateurs résidentiels",
    sourceUrl: "https://www.cre.fr/documents/open-data",
    prices: [...parseCreCsv(baseCsv, "base"), ...parseCreCsv(hphcCsv, "hphc")].sort(compareRows),
  };
}

const rowKey = (row: PriceFileRow) => `${row.contractType}|${row.kva}|${row.startDate}`;

/** What a new list of rows adds, changes and drops against the published one. */
export function diffRows(before: PriceFileRow[], after: PriceFileRow[]): PriceRowChanges {
  const old = new Map(before.map((row) => [rowKey(row), row] as const));
  const next = new Map(after.map((row) => [rowKey(row), row] as const));
  const changes: PriceRowChanges = { added: [], changed: [], removed: [] };
  for (const [key, row] of next) {
    const previous = old.get(key);
    if (!previous) changes.added.push(row);
    else if (
      previous.hp !== row.hp ||
      previous.hc !== row.hc ||
      previous.fixedFeeYear !== row.fixedFeeYear
    ) {
      changes.changed.push({ before: previous, after: row });
    }
  }
  for (const [key, row] of old) if (!next.has(key)) changes.removed.push(row);
  return changes;
}

/** One row in words, for a pull request body or an error. */
export function describeRow(row: PriceFileRow): string {
  const prices =
    row.contractType === "base" ? `${row.hp} €/kWh` : `HP ${row.hp}, HC ${row.hc} €/kWh`;
  return `${row.startDate}, ${row.contractType}, ${row.kva} kVA: ${prices}, ${row.fixedFeeYear} €/year`;
}

export interface SupplierUpdate {
  /** The file to write, null when nothing changed. */
  next: PriceFile | null;
  changes: PriceRowChanges;
  /** What changed, in Markdown, for the pull request. Empty when nothing did. */
  summary: string;
}

/**
 * What replacing a supplier's block does to the published file.
 *
 * Nothing to write when its rows and its texts are as published. A published
 * row that the new block no longer holds is refused (instances may have taken
 * it), unless `allowRemoval` says a maintainer looked at the source. The other
 * suppliers are kept as they are, and the result is read back through
 * `parsePriceFile`, the check every instance applies.
 */
export function planSupplierUpdate(
  current: PriceFile | null,
  supplier: PriceFileSupplier,
  today: string,
  options: { allowRemoval?: boolean } = {},
): SupplierUpdate {
  const published = current?.suppliers.find((s) => s.id === supplier.id) ?? null;
  const changes = diffRows(published?.prices ?? [], supplier.prices);
  if (changes.removed.length > 0 && !options.allowRemoval) {
    throw new CreCsvError(
      `${changes.removed.length} published row(s) are no longer in the source, first: ` +
        `${describeRow(changes.removed[0])}. Not writing: check the source by hand, then run ` +
        `again with --allow-removal if the removal is right.`,
    );
  }
  const textsChanged =
    published !== null &&
    (published.name !== supplier.name ||
      published.source !== supplier.source ||
      published.sourceUrl !== supplier.sourceUrl);
  const rowsChanged =
    changes.added.length > 0 || changes.changed.length > 0 || changes.removed.length > 0;
  if (!rowsChanged && !textsChanged) return { next: null, changes, summary: "" };

  const next = parsePriceFile({
    format: PRICE_FILE_FORMAT,
    generatedAt: today,
    suppliers: [...(current?.suppliers ?? []).filter((s) => s.id !== supplier.id), supplier].sort(
      (a, b) => a.id.localeCompare(b.id),
    ),
  });

  const list = (title: string, rows: string[]) =>
    rows.length > 0 ? [title, "", ...rows.map((r) => `- ${r}`), ""] : [];
  const summary = [
    `${supplier.name}: ${changes.added.length} row(s) added, ${changes.changed.length} changed, ` +
      `${changes.removed.length} removed, ${supplier.prices.length} in all.`,
    "",
    ...(changes.changed.length > 0 || changes.removed.length > 0
      ? [
          "**Figures moved for a period already published.** Instances that already took these rows",
          "keep the old figures: check the source before merging.",
          "",
        ]
      : []),
    ...list(
      "**Changed**",
      changes.changed.map(
        (c) => `was \`${describeRow(c.before)}\`, now \`${describeRow(c.after)}\``,
      ),
    ),
    ...list(
      "**Removed**",
      changes.removed.map((row) => `\`${describeRow(row)}\``),
    ),
    ...list(
      "**Added**",
      changes.added.map((row) => `\`${describeRow(row)}\``),
    ),
    ...(textsChanged && !rowsChanged ? ["The supplier's name or source text changed.", ""] : []),
  ].join("\n");
  return { next, changes, summary };
}
