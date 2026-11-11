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
} from "../../shared/types.js";
import { isLocalDate } from "../tariff-version-store.js";

/** The format this Sowel reads. A file with a higher one is refused whole. */
export const PRICE_FILE_FORMAT = 1;

/** A price in the file is above 0 and below this, € per kWh. */
export const MAX_FILE_PRICE_EUR_KWH = 1;

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
  if (typeof value !== "string" || value.trim() === "") {
    throw new PriceFileError(`${what} must be a non-empty string`);
  }
  return value;
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
  if (typeof kva !== "number" || !Number.isFinite(kva) || kva <= 0) {
    throw new PriceFileError(`${where}: kva must be a number above 0`);
  }
  if (!isLocalDate(startDate)) {
    throw new PriceFileError(`${where}: startDate must be a real day written YYYY-MM-DD`);
  }
  if (!isFilePrice(hp) || !isFilePrice(hc)) {
    throw new PriceFileError(
      `${where}: prices must be above 0 and below ${MAX_FILE_PRICE_EUR_KWH} € per kWh`,
    );
  }
  if (contractType === "base" && hp !== hc) {
    throw new PriceFileError(`${where}: a base row carries one price, in both hp and hc`);
  }
  if (typeof fixedFeeYear !== "number" || !Number.isFinite(fixedFeeYear) || fixedFeeYear < 0) {
    throw new PriceFileError(`${where}: fixedFeeYear must be a number, 0 or more`);
  }
  return { contractType, kva, startDate, hp, hc, fixedFeeYear };
}

function parseSupplier(value: unknown, where: string): PriceFileSupplier {
  if (!isRecord(value)) throw new PriceFileError(`${where} must be an object`);
  const id = text(value.id, `${where}.id`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    throw new PriceFileError(`${where}.id must be lower-case words joined by dashes`);
  }
  if (!Array.isArray(value.prices)) {
    throw new PriceFileError(`${where}.prices must be a list`);
  }
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
    sourceUrl: text(value.sourceUrl, `${where}.sourceUrl`),
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
