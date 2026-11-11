import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PriceFile, PriceFileRow, TariffVersion } from "../../shared/types.js";
import {
  PRICE_FILE_FORMAT,
  PriceFileError,
  newPrices,
  parsePriceFile,
  rowsFor,
  serializePriceFile,
} from "./price-file.js";

// Spec 203 — the one definition of a valid price file.

const row = (over: Partial<PriceFileRow> = {}): PriceFileRow => ({
  contractType: "hphc",
  kva: 9,
  startDate: "2026-08-01",
  hp: 0.2142,
  hc: 0.1589,
  fixedFeeYear: 239.84,
  ...over,
});

const file = (prices: unknown[], over: Record<string, unknown> = {}) => ({
  format: 1,
  generatedAt: "2026-11-11",
  suppliers: [
    {
      id: "edf-tarif-bleu",
      name: "EDF, Tarif Bleu (tarif réglementé)",
      source: "CRE",
      sourceUrl: "https://www.cre.fr/documents/open-data",
      prices,
    },
  ],
  ...over,
});

/** A one-row file whose supplier carries these fields instead. */
const withSupplier = (over: Record<string, unknown>) => ({
  format: 1,
  generatedAt: "2026-11-11",
  suppliers: [{ ...file([row()]).suppliers[0], ...over }],
});

describe("the committed price file", () => {
  const path = resolve(import.meta.dirname, "../../../tariffs/electricity-prices.json");
  const text = readFileSync(path, "utf-8");
  const committed = parsePriceFile(JSON.parse(text));

  it("is a valid file, laid out as the update script writes it", () => {
    expect(committed.format).toBe(PRICE_FILE_FORMAT);
    expect(serializePriceFile(committed)).toBe(text);
  });

  it("holds EDF Tarif Bleu in Base and off-peak, since 2012", () => {
    const edf = committed.suppliers.find((s) => s.id === "edf-tarif-bleu");
    expect(edf).toBeDefined();
    const types = new Set(edf!.prices.map((r) => r.contractType));
    expect([...types].sort()).toEqual(["base", "hphc"]);
    expect(edf!.prices.some((r) => r.startDate === "2012-07-23")).toBe(true);
    // Off-peak exists up to 36 kVA; Base stops at 15 kVA.
    expect(
      Math.max(...edf!.prices.filter((r) => r.contractType === "hphc").map((r) => r.kva)),
    ).toBe(36);
  });
});

describe("parsePriceFile", () => {
  it("rebuilds the file from its known fields", () => {
    const parsed = parsePriceFile(file([{ ...row(), note: "ignored" }], { extra: true }));
    expect(parsed).toEqual({
      format: 1,
      generatedAt: "2026-11-11",
      suppliers: [
        {
          id: "edf-tarif-bleu",
          name: "EDF, Tarif Bleu (tarif réglementé)",
          source: "CRE",
          sourceUrl: "https://www.cre.fr/documents/open-data",
          prices: [row()],
        },
      ],
    });
  });

  it("refuses a format newer than the one it reads, and says which", () => {
    expect(() => parsePriceFile(file([row()], { format: 2 }))).toThrow(/format 2.*reads format 1/);
  });

  it.each<[string, unknown]>([
    ["something that is not an object", []],
    ["a missing format", file([row()], { format: undefined })],
    ["a generation date that is not a day", file([row()], { generatedAt: "yesterday" })],
    ["suppliers that are not a list", file([row()], { suppliers: {} })],
    ["an unknown contract type", file([row({ contractType: "tempo" as never })])],
    ["a power of 0", file([row({ kva: 0 })])],
    ["a date that does not exist", file([row({ startDate: "2026-02-30" })])],
    ["a price of 2 € per kWh", file([row({ hp: 2 })])],
    ["a price of 0", file([row({ hc: 0 })])],
    ["a negative fee", file([row({ fixedFeeYear: -1 })])],
    ["a base row with two prices", file([row({ contractType: "base" })])],
    ["a price written as text", file([row({ hp: "0.2142" as never })])],
    ["a price with more than 4 decimals", file([row({ hp: 0.21420000001 })])],
    ["an off-peak price at or above the peak price", file([row({ hc: 0.2142 })])],
    ["a fee with more than 2 decimals", file([row({ fixedFeeYear: 239.841 })])],
    ["a fee beyond any plausible one", file([row({ fixedFeeYear: 1e300 })])],
    ["a power that is not a whole number", file([row({ kva: 9.5 })])],
    ["a power beyond any plausible one", file([row({ kva: 1e300 })])],
    ["a supplier with no row", file([])],
    ["a link that is not https", withSupplier({ sourceUrl: "http://www.cre.fr" })],
    ["a javascript: link", withSupplier({ sourceUrl: "javascript:alert(1)" })],
    ["a name of a megabyte", withSupplier({ name: "x".repeat(1_000_000) })],
    ["the reserved supplier id other", withSupplier({ id: "other" })],
    [
      "rows out of order",
      file([row({ startDate: "2026-08-01" }), row({ startDate: "2026-02-01" })]),
    ],
    ["two rows on one contract, power and date", file([row(), row({ hp: 0.3 })])],
    [
      "a supplier id that is not a slug",
      {
        format: 1,
        generatedAt: "2026-11-11",
        suppliers: [{ ...file([row()]).suppliers[0], id: "EDF Bleu" }],
      },
    ],
    [
      "a supplier listed twice",
      {
        format: 1,
        generatedAt: "2026-11-11",
        suppliers: [file([row()]).suppliers[0], file([row()]).suppliers[0]],
      },
    ],
  ])("refuses %s", (_label, value) => {
    expect(() => parsePriceFile(value)).toThrow(PriceFileError);
  });
});

describe("rowsFor", () => {
  const parsed: PriceFile = parsePriceFile(
    file([
      row({ contractType: "base", kva: 9, startDate: "2026-08-01", hp: 0.1985, hc: 0.1985 }),
      row({ kva: 6, startDate: "2026-08-01", fixedFeeYear: 190.81 }),
      row({ kva: 9, startDate: "2026-02-01", hp: 0.2065, hc: 0.1578, fixedFeeYear: 235.92 }),
      row({ kva: 9, startDate: "2026-08-01" }),
    ]),
  );

  it("gives the rows of the contract's supplier, type and power, oldest first", () => {
    const rows = rowsFor(parsed, { supplier: "edf-tarif-bleu", contractType: "hphc", kva: 9 });
    expect(rows.map((r) => r.startDate)).toEqual(["2026-02-01", "2026-08-01"]);
  });

  it("accepts a file with no supplier at all", () => {
    expect(
      parsePriceFile({ format: 1, generatedAt: "2026-11-11", suppliers: [] }).suppliers,
    ).toEqual([]);
  });

  it("gives nothing for a power without rows, no power, or another supplier", () => {
    expect(rowsFor(parsed, { supplier: "edf-tarif-bleu", contractType: "base", kva: 18 })).toEqual(
      [],
    );
    expect(
      rowsFor(parsed, { supplier: "edf-tarif-bleu", contractType: "hphc", kva: null }),
    ).toEqual([]);
    expect(rowsFor(parsed, { supplier: "other", contractType: "hphc", kva: 9 })).toEqual([]);
  });
});

describe("newPrices — added by itself, or held for the user (FR4)", () => {
  const version = (startDate: string | null, hp: number, origin = "manual"): TariffVersion => ({
    id: startDate ?? "origin",
    startDate,
    prices: { hp, hc: hp / 2 },
    fixedFeeYear: null,
    kva: 9,
    origin,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  });
  // The contract's rows, oldest first, as `rowsFor` gives them.
  const rows = [
    row({ startDate: "2025-08-01", hp: 0.2081, hc: 0.1635 }),
    row({ startDate: "2026-02-01", hp: 0.2065, hc: 0.1578 }),
    row({ startDate: "2026-08-01", hp: 0.2142, hc: 0.1589 }),
  ];
  const none = new Set<string>();
  const dates = (list: PriceFileRow[]) => list.map((r) => r.startDate);

  it("holds every row on an instance that only has the version without a date", () => {
    const split = newPrices(rows, [version(null, 0.246)], none);
    expect(split.automatic).toEqual([]);
    expect(dates(split.held)).toEqual(["2025-08-01", "2026-02-01", "2026-08-01"]);
  });

  it("holds every row on an instance without any version", () => {
    expect(newPrices(rows, [], none)).toEqual({ automatic: [], held: rows });
  });

  it("adds by itself a new period that follows the history", () => {
    const versions = [
      version(null, 0.2),
      version("2025-08-01", 0.2081),
      version("2026-02-01", 0.2065),
    ];
    const split = newPrices(rows, versions, none);
    expect(dates(split.automatic)).toEqual(["2026-08-01"]);
    expect(split.held).toEqual([]);
  });

  it("chains two new periods found in one read", () => {
    const split = newPrices(rows, [version(null, 0.2), version("2025-08-01", 0.2081)], none);
    expect(dates(split.automatic)).toEqual(["2026-02-01", "2026-08-01"]);
  });

  it("holds a jump of 30 % or more, and what follows it", () => {
    const jump = [
      ...rows,
      row({ startDate: "2027-02-01", hp: 0.2142 * 1.3, hc: 0.16 }),
      row({ startDate: "2027-08-01", hp: 0.2142 * 1.31, hc: 0.16 }),
    ];
    const versions = [version(null, 0.2), version("2026-02-01", 0.2065)];
    const split = newPrices(jump, versions, none);
    expect(dates(split.automatic)).toEqual(["2026-08-01"]);
    // 2025-08-01 is older than the latest version; the last two are the jump and its follower.
    expect(dates(split.held)).toEqual(["2025-08-01", "2027-02-01", "2027-08-01"]);
  });

  it("adds a rise just under 30 %", () => {
    const next = [row({ startDate: "2027-02-01", hp: 0.2142 * 1.29, hc: 0.16 })];
    const split = newPrices(next, [version(null, 0.2), version("2026-08-01", 0.2142)], none);
    expect(dates(split.automatic)).toEqual(["2027-02-01"]);
  });

  it("holds a row that starts before a version entered meanwhile", () => {
    // The CRE row of 1 February arrives after the user recorded a change on the 10th.
    const versions = [version(null, 0.2), version("2026-02-10", 0.2065)];
    const split = newPrices(rows, versions, none);
    expect(dates(split.held)).toEqual(["2025-08-01", "2026-02-01"]);
    expect(dates(split.automatic)).toEqual(["2026-08-01"]);
  });

  it("never proposes a start date a version already uses, whatever its figures", () => {
    const versions = [version(null, 0.2), version("2026-02-01", 0.9), version("2026-08-01", 0.9)];
    const split = newPrices(rows, versions, none);
    expect(dates(split.held)).toEqual(["2025-08-01"]);
    expect(split.automatic).toEqual([]);
  });

  it("never proposes a row the user set aside", () => {
    const versions = [version(null, 0.2), version("2026-02-01", 0.2065)];
    const split = newPrices(rows, versions, new Set(["2025-08-01", "2026-08-01"]));
    expect(split).toEqual({ automatic: [], held: [] });
  });
});
