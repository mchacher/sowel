/**
 * EDF Tarif Bleu from the CRE open data — spec 203.
 *
 * The CRE publishes the history of the regulated residential prices as two
 * CSV files, one per option. Both: CRLF line ends, `;` separator, decimal
 * comma, dates `DD/MM/YYYY`, an empty end date on the period in force. This
 * module turns them into the rows of the price file. Pure: the script that
 * fetches the files is `scripts/tariffs/update-edf-tarif-bleu.ts`.
 *
 * It refuses anything it does not recognise rather than guess: these figures
 * end up pricing a household's bill.
 */

import type { PriceFileRow, PriceFileSupplier } from "../../shared/types.js";
import { compareRows } from "./price-file.js";

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

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** `190,8131821` → 190.8131821. Throws on anything that is not a number. */
function number(raw: string, what: string, line: number): number {
  const value = Number(raw.trim().replace(",", "."));
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw new CreCsvError(`Line ${line}: ${what} is not a number (${JSON.stringify(raw)})`);
  }
  return value;
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
    const kva = number(fields[2], "the subscribed power", line);
    const key = `${startDate}|${kva}`;
    if (seen.has(key)) {
      throw new CreCsvError(`Line ${line}: ${fields[0]} at ${kva} kVA is listed twice`);
    }
    seen.add(key);
    rows.push({
      contractType,
      kva,
      startDate,
      hp: round(number(fields[columns.hp], "the peak price", line), 4),
      hc: round(number(fields[columns.hc], "the off-peak price", line), 4),
      fixedFeeYear: round(number(fields[columns.fee], "the fixed fee", line), 2),
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

export interface PriceRowChanges {
  added: PriceFileRow[];
  changed: Array<{ before: PriceFileRow; after: PriceFileRow }>;
  removed: PriceFileRow[];
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
