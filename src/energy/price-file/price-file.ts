/**
 * The electricity price file — spec 203.
 *
 * `tariffs/electricity-prices.json` holds the prices suppliers publish, per
 * contract type, subscribed power and period. This module is the one
 * definition of a valid file: the CI check runs it on the committed file, and
 * an instance runs it on what it downloads. Pure: no I/O.
 */

import type {
  PriceFile,
  PriceFileRow,
  PriceFileSupplier,
  TariffContract,
  TariffVersion,
} from "../../shared/types.js";
import { isLocalDate } from "../../shared/local-date.js";

/** The format this Sowel reads. A file with a higher one is refused whole. */
export const PRICE_FILE_FORMAT = 1;

/** A price in the file is above 0 and below this, € per kWh. */
export const MAX_FILE_PRICE_EUR_KWH = 1;
/** The highest fixed fee a row may carry, € per year: a typo guard. */
export const MAX_FILE_FEE_EUR_YEAR = 10_000;
/** The highest subscribed power a row may carry, kVA. */
export const MAX_FILE_KVA = 250;
/** Texts of the file are short: a name, a source, a link. */
const MAX_TEXT = 300;
/** `other` is the contract's "supplier not in the file": no supplier may take it. */
const RESERVED_SUPPLIER_IDS = new Set(["other"]);

export class PriceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceFileError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TEXT) {
    throw new PriceFileError(
      `${what} must be a non-empty string of at most ${MAX_TEXT} characters`,
    );
  }
  return value;
}

/** An https link, and nothing else: the settings page may show it. */
function httpsUrl(value: unknown, what: string): string {
  const url = text(value, what);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PriceFileError(`${what} must be an https link`);
  }
  if (parsed.protocol !== "https:") throw new PriceFileError(`${what} must be an https link`);
  return url;
}

/** Is `value` written with at most `decimals` decimals? */
function hasDecimals(value: number, decimals: number): boolean {
  return Number(value.toFixed(decimals)) === value;
}

function isFilePrice(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value < MAX_FILE_PRICE_EUR_KWH
  );
}

/** The order of the rows in the file: contract type, power, start date. */
export function compareRows(a: PriceFileRow, b: PriceFileRow): number {
  return (
    a.contractType.localeCompare(b.contractType) ||
    a.kva - b.kva ||
    a.startDate.localeCompare(b.startDate)
  );
}

function parseRow(value: unknown, where: string): PriceFileRow {
  if (!isRecord(value)) throw new PriceFileError(`${where} must be an object`);
  const { contractType, kva, startDate, hp, hc, fixedFeeYear } = value;
  if (contractType !== "hphc" && contractType !== "base") {
    throw new PriceFileError(`${where}: unknown contract type ${JSON.stringify(contractType)}`);
  }
  if (typeof kva !== "number" || !Number.isInteger(kva) || kva <= 0 || kva > MAX_FILE_KVA) {
    throw new PriceFileError(`${where}: kva must be a whole number from 1 to ${MAX_FILE_KVA}`);
  }
  if (!isLocalDate(startDate)) {
    throw new PriceFileError(`${where}: startDate must be a real day written YYYY-MM-DD`);
  }
  if (!isFilePrice(hp) || !isFilePrice(hc)) {
    throw new PriceFileError(
      `${where}: prices must be above 0 and below ${MAX_FILE_PRICE_EUR_KWH} € per kWh`,
    );
  }
  if (!hasDecimals(hp, 4) || !hasDecimals(hc, 4)) {
    throw new PriceFileError(`${where}: prices are written with at most 4 decimals`);
  }
  if (contractType === "base" && hp !== hc) {
    throw new PriceFileError(`${where}: a base row carries one price, in both hp and hc`);
  }
  if (contractType === "hphc" && hc >= hp) {
    throw new PriceFileError(`${where}: the off-peak price must be below the peak price`);
  }
  if (
    typeof fixedFeeYear !== "number" ||
    !Number.isFinite(fixedFeeYear) ||
    fixedFeeYear < 0 ||
    fixedFeeYear > MAX_FILE_FEE_EUR_YEAR ||
    !hasDecimals(fixedFeeYear, 2)
  ) {
    throw new PriceFileError(
      `${where}: fixedFeeYear must be from 0 to ${MAX_FILE_FEE_EUR_YEAR} € per year, with at most 2 decimals`,
    );
  }
  return { contractType, kva, startDate, hp, hc, fixedFeeYear };
}

function parseSupplier(value: unknown, where: string): PriceFileSupplier {
  if (!isRecord(value)) throw new PriceFileError(`${where} must be an object`);
  const id = text(value.id, `${where}.id`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    throw new PriceFileError(`${where}.id must be lower-case words joined by dashes`);
  }
  if (id.length > 60 || RESERVED_SUPPLIER_IDS.has(id)) {
    throw new PriceFileError(`${where}.id ${JSON.stringify(id)} is reserved or too long`);
  }
  if (!Array.isArray(value.prices)) {
    throw new PriceFileError(`${where}.prices must be a list`);
  }
  if (value.prices.length === 0) throw new PriceFileError(`${id} has no price row`);
  const prices = value.prices.map((row, i) => parseRow(row, `${id} row ${i + 1}`));
  for (let i = 1; i < prices.length; i++) {
    const order = compareRows(prices[i - 1], prices[i]);
    if (order === 0) {
      throw new PriceFileError(
        `${id} row ${i + 1}: same contract, power and date as the row before`,
      );
    }
    if (order > 0) throw new PriceFileError(`${id} row ${i + 1}: rows are not sorted`);
  }
  return {
    id,
    name: text(value.name, `${where}.name`),
    source: text(value.source, `${where}.source`),
    sourceUrl: httpsUrl(value.sourceUrl, `${where}.sourceUrl`),
    prices,
  };
}

/**
 * Read a price file from an untrusted value. Throws `PriceFileError` with the
 * reason; the result is rebuilt from the known fields, nothing else is kept.
 */
export function parsePriceFile(value: unknown): PriceFile {
  if (!isRecord(value)) throw new PriceFileError("The price file must be an object");
  const { format, generatedAt, suppliers } = value;
  if (typeof format !== "number" || !Number.isInteger(format) || format < 1) {
    throw new PriceFileError("format must be a whole number, 1 or more");
  }
  if (format > PRICE_FILE_FORMAT) {
    throw new PriceFileError(
      `The price file has format ${format}; this version of Sowel reads format ${PRICE_FILE_FORMAT}`,
    );
  }
  if (!isLocalDate(generatedAt)) {
    throw new PriceFileError("generatedAt must be a real day written YYYY-MM-DD");
  }
  if (!Array.isArray(suppliers)) throw new PriceFileError("suppliers must be a list");
  const parsed = suppliers.map((s, i) => parseSupplier(s, `suppliers[${i}]`));
  const ids = new Set<string>();
  for (const s of parsed) {
    if (ids.has(s.id)) throw new PriceFileError(`Supplier ${s.id} is listed twice`);
    ids.add(s.id);
  }
  return { format, generatedAt, suppliers: parsed };
}

/** The rows of a contract's supplier, type and power, oldest first. */
export function rowsFor(
  file: PriceFile,
  contract: Pick<TariffContract, "supplier" | "contractType" | "kva">,
): PriceFileRow[] {
  const supplier = file.suppliers.find((s) => s.id === contract.supplier);
  if (!supplier || contract.kva === null) return [];
  return supplier.prices
    .filter((row) => row.contractType === contract.contractType && row.kva === contract.kva)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** A new price that moves the peak price by this much or more is not added by itself. */
export const MAX_AUTO_CHANGE = 0.3;

/**
 * The rows of a contract that no version holds yet, split in two (spec 203 FR4).
 *
 * `automatic`: a price that starts after every existing version, on an
 * instance that already has a dated version, and that moves the peak price by
 * less than 30 % against the price just before it. Two new periods in one read
 * chain: the second is compared with the first.
 *
 * `held`: everything else, for the user to confirm. That is the past prices of
 * an instance that has none (the retroactive fill), a row published late that
 * starts before a version entered meanwhile, a jump of 30 % or more, and
 * whatever follows such a jump.
 *
 * `rows` are those of the contract, oldest first. A start date already used by
 * a version, or set aside by the user, is never proposed.
 */
export function newPrices(
  rows: PriceFileRow[],
  versions: TariffVersion[],
  dismissed: ReadonlySet<string>,
): { automatic: PriceFileRow[]; held: PriceFileRow[] } {
  const dated = versions
    .filter((v): v is TariffVersion & { startDate: string } => v.startDate !== null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const taken = new Set(dated.map((v) => v.startDate));
  const latest = dated[dated.length - 1] ?? null;
  const automatic: PriceFileRow[] = [];
  const held: PriceFileRow[] = [];
  let previousHp = latest?.prices.hp ?? 0;
  let chain = latest !== null;
  for (const row of rows) {
    if (taken.has(row.startDate) || dismissed.has(row.startDate)) continue;
    const newer = latest !== null && row.startDate > latest.startDate;
    // Rounded, so that a move of exactly 30 % is held whatever the floats say.
    const change = previousHp > 0 ? Math.abs(row.hp - previousHp) / previousHp : Infinity;
    const steady = Math.round(change * 1e6) / 1e6 < MAX_AUTO_CHANGE;
    if (chain && newer && steady) {
      automatic.push(row);
      previousHp = row.hp;
    } else {
      held.push(row);
      // A newer price held back breaks the chain: what follows it cannot be
      // compared with a price the user has not confirmed.
      if (newer) chain = false;
    }
  }
  return { automatic, held };
}

/**
 * The file as it is written to disk: one row per line, so that a pull request
 * reads as a list of added lines.
 */
export function serializePriceFile(file: PriceFile): string {
  const suppliers = file.suppliers.map((s) => {
    const rows = s.prices.map((row) => `        ${JSON.stringify(row)}`).join(",\n");
    return [
      "    {",
      `      "id": ${JSON.stringify(s.id)},`,
      `      "name": ${JSON.stringify(s.name)},`,
      `      "source": ${JSON.stringify(s.source)},`,
      `      "sourceUrl": ${JSON.stringify(s.sourceUrl)},`,
      `      "prices": [`,
      rows,
      "      ]",
      "    }",
    ].join("\n");
  });
  return [
    "{",
    `  "format": ${file.format},`,
    `  "generatedAt": ${JSON.stringify(file.generatedAt)},`,
    `  "suppliers": [`,
    suppliers.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
}
