import { describe, expect, it } from "vitest";
import type { PriceFile } from "../../shared/types.js";
import {
  CreCsvError,
  buildEdfTarifBleu,
  decimal,
  diffRows,
  parseCreCsv,
  planSupplierUpdate,
} from "./cre-csv.js";
import { parsePriceFile } from "./price-file.js";

// Spec 203 — the CRE files as they are published: CRLF, `;`, decimal comma,
// DD/MM/YYYY, an empty end date on the period in force. Short fixtures; the
// 9 kVA rows of 2026 are the public figures, the others are made up.

const HPHC_HEADER =
  "DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HC_HT;PART_VARIABLE_HC_TTC;PART_VARIABLE_HP_HT;PART_VARIABLE_HP_TTC";
const BASE_HEADER =
  "DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HT;PART_VARIABLE_TTC";

const crlf = (...lines: string[]) => lines.join("\r\n") + "\r\n";

const HPHC = crlf(
  HPHC_HEADER,
  "01/08/2026;;9;178,8;239,8378787;0,1018;0,1589;0,1479;0,2142",
  "01/02/2026;31/07/2026;9;176,16;235,92;0,1007;0,1578;0,1412;0,2065",
  "01/08/2026;;6;143,28;190,8131821;0,1018;0,1589;0,1479;0,2142",
);
const BASE = crlf(
  BASE_HEADER,
  "01/02/2026;31/07/2026;9;176,16;235,9;0,1297;0,1927",
  "01/08/2026;;9;178,8;239,84;0,1348;0,1985",
);

describe("parseCreCsv", () => {
  it("reads the off-peak file: ISO dates, the columns incl. tax, 4 and 2 decimals", () => {
    expect(parseCreCsv(HPHC, "hphc")).toEqual([
      // Sorted by power, then date.
      {
        contractType: "hphc",
        kva: 6,
        startDate: "2026-08-01",
        hp: 0.2142,
        hc: 0.1589,
        fixedFeeYear: 190.81,
      },
      {
        contractType: "hphc",
        kva: 9,
        startDate: "2026-02-01",
        hp: 0.2065,
        hc: 0.1578,
        fixedFeeYear: 235.92,
      },
      {
        contractType: "hphc",
        kva: 9,
        startDate: "2026-08-01",
        hp: 0.2142,
        hc: 0.1589,
        fixedFeeYear: 239.84,
      },
    ]);
  });

  it("reads the Base file with its one price in both hp and hc", () => {
    expect(parseCreCsv(BASE, "base")).toEqual([
      {
        contractType: "base",
        kva: 9,
        startDate: "2026-02-01",
        hp: 0.1927,
        hc: 0.1927,
        fixedFeeYear: 235.9,
      },
      {
        contractType: "base",
        kva: 9,
        startDate: "2026-08-01",
        hp: 0.1985,
        hc: 0.1985,
        fixedFeeYear: 239.84,
      },
    ]);
  });

  it("accepts LF line ends and a byte order mark", () => {
    const lf = String.fromCharCode(0xfeff) + BASE.replace(/\r\n/g, "\n");
    expect(parseCreCsv(lf, "base")).toHaveLength(2);
  });

  it.each([
    [
      "an unknown header",
      crlf(BASE_HEADER + ";EXTRA", "01/08/2026;;9;178,8;239,84;0,1348;0,1985;1"),
    ],
    ["the header of the other file", HPHC],
    [
      "a duplicate date and power",
      crlf(BASE_HEADER, "01/08/2026;;9;1;2;3;0,19", "01/08/2026;;9;1;2;3;0,2"),
    ],
    ["a figure that is not a number", crlf(BASE_HEADER, "01/08/2026;;9;178,8;n/a;0,1348;0,1985")],
    ["an empty figure", crlf(BASE_HEADER, "01/08/2026;;9;178,8;;0,1348;0,1985")],
    ["a date in another format", crlf(BASE_HEADER, "2026-08-01;;9;178,8;239,84;0,1348;0,1985")],
    ["a day that does not exist", crlf(BASE_HEADER, "31/02/2026;;9;178,8;239,84;0,1348;0,1985")],
    ["a line with a missing field", crlf(BASE_HEADER, "01/08/2026;;9;178,8;239,84;0,1348")],
    ["no row at all", crlf(BASE_HEADER)],
  ])("refuses %s", (_label, csv) => {
    expect(() => parseCreCsv(csv, "base")).toThrow(CreCsvError);
  });
});

describe("parseCreCsv — what it refuses, and where", () => {
  it("names the line of a figure it cannot read", () => {
    const csv = crlf(
      BASE_HEADER,
      "01/02/2026;31/07/2026;9;176,16;235,9;0,1297;0,1927",
      "01/08/2026;;9;178,8;239,84;0,1348;n/a",
    );
    expect(() => parseCreCsv(csv, "base")).toThrow(/Line 3: the peak price is not a number/);
  });

  it.each(["0x9", "1e-1", "0.19", "1 000", "-0,19", ",19", "0,19,5"])(
    "refuses %s as a figure: digits and one comma only",
    (raw) => {
      const csv = crlf(BASE_HEADER, `01/08/2026;;9;178,8;239,84;0,1348;${raw}`);
      expect(() => parseCreCsv(csv, "base")).toThrow(CreCsvError);
    },
  );

  it("refuses a malformed off-peak file too", () => {
    expect(() => parseCreCsv(BASE, "hphc")).toThrow(/Unexpected header for the hphc file/);
    expect(() =>
      parseCreCsv(crlf(HPHC_HEADER, "01/08/2026;;9;178,8;239,84;0,1018;;0,1479;0,2142"), "hphc"),
    ).toThrow(/Line 2: the off-peak price is not a number/);
  });
});

describe("decimal — rounding on the decimal digits", () => {
  it("rounds half up where the binary value would round down", () => {
    expect(decimal("1,005", 2, "x", 1)).toBe(1.01);
    expect(decimal("0,16065", 4, "x", 1)).toBe(0.1607);
    expect(decimal("0,16064", 4, "x", 1)).toBe(0.1606);
    expect(decimal("190,8131821", 2, "x", 1)).toBe(190.81);
    expect(decimal("239,8378787", 2, "x", 1)).toBe(239.84);
  });

  it("keeps a figure that already has few enough decimals", () => {
    expect(decimal("0,27", 4, "x", 1)).toBe(0.27);
    expect(decimal("9", 0, "x", 1)).toBe(9);
    expect(decimal("9,99", 0, "x", 1)).toBe(10);
  });
});

describe("planSupplierUpdate — what the nightly update writes", () => {
  const supplier = buildEdfTarifBleu(BASE, HPHC);
  const published: PriceFile = parsePriceFile({
    format: 1,
    generatedAt: "2026-09-01",
    suppliers: [supplier],
  });

  it("writes nothing when the rows are as published", () => {
    const update = planSupplierUpdate(published, supplier, "2027-02-25");
    expect(update.next).toBeNull();
    expect(update.summary).toBe("");
  });

  it("creates the file when there is none", () => {
    const update = planSupplierUpdate(null, supplier, "2026-11-11");
    expect(update.next).toMatchObject({ format: 1, generatedAt: "2026-11-11" });
    expect(update.next!.suppliers).toHaveLength(1);
    expect(update.changes.added).toHaveLength(5);
  });

  it("adds a new period, dates the file and says what it added", () => {
    const next = buildEdfTarifBleu(BASE + "01/02/2027;;9;180;241,2;0,135;0,1999\r\n", HPHC);
    const update = planSupplierUpdate(published, next, "2027-02-25");
    expect(update.next!.generatedAt).toBe("2027-02-25");
    expect(update.changes.added.map((r) => r.startDate)).toEqual(["2027-02-01"]);
    expect(update.summary).toContain("1 row(s) added, 0 changed, 0 removed");
    expect(update.summary).toContain("2027-02-01, base, 9 kVA: 0.1999 €/kWh, 241.2 €/year");
  });

  it("calls out a figure that moved for a period already published", () => {
    const moved = buildEdfTarifBleu(BASE.replace("0,1985", "0,1990"), HPHC);
    const update = planSupplierUpdate(published, moved, "2027-02-25");
    expect(update.changes.changed).toHaveLength(1);
    expect(update.summary).toContain("Figures moved for a period already published");
  });

  it("refuses a published row that disappeared, and writes nothing", () => {
    const fewer = buildEdfTarifBleu(
      crlf(BASE_HEADER, "01/08/2026;;9;178,8;239,84;0,1348;0,1985"),
      HPHC,
    );
    expect(() => planSupplierUpdate(published, fewer, "2027-02-25")).toThrow(
      /1 published row\(s\) are no longer in the source/,
    );
  });

  it("accepts the removal once a maintainer allows it", () => {
    const fewer = buildEdfTarifBleu(
      crlf(BASE_HEADER, "01/08/2026;;9;178,8;239,84;0,1348;0,1985"),
      HPHC,
    );
    const update = planSupplierUpdate(published, fewer, "2027-02-25", { allowRemoval: true });
    expect(update.next!.suppliers[0].prices).toHaveLength(4);
    expect(update.summary).toContain("**Removed**");
  });

  it("keeps the other suppliers as they are", () => {
    const other = { ...supplier, id: "another-supplier", name: "Another" };
    const two = parsePriceFile({
      format: 1,
      generatedAt: "2026-09-01",
      suppliers: [other, supplier],
    });
    const next = buildEdfTarifBleu(BASE + "01/02/2027;;9;180;241,2;0,135;0,1999\r\n", HPHC);
    const update = planSupplierUpdate(two, next, "2027-02-25");
    expect(update.next!.suppliers.map((s) => s.id)).toEqual(["another-supplier", "edf-tarif-bleu"]);
    expect(update.next!.suppliers[0]).toEqual(other);
  });

  it("rewrites the file when only the supplier's texts changed", () => {
    const renamed = { ...supplier, name: "EDF, Tarif Bleu" };
    const update = planSupplierUpdate(published, renamed, "2027-02-25");
    expect(update.next!.suppliers[0].name).toBe("EDF, Tarif Bleu");
  });

  it("refuses to write a block the instances would refuse", () => {
    const broken = { ...supplier, sourceUrl: "http://example.org" };
    expect(() => planSupplierUpdate(published, broken, "2027-02-25")).toThrow(/https/);
  });
});

describe("buildEdfTarifBleu", () => {
  it("gives a supplier block the price file accepts", () => {
    const supplier = buildEdfTarifBleu(BASE, HPHC);
    expect(supplier.id).toBe("edf-tarif-bleu");
    expect(supplier.prices).toHaveLength(5);
    expect(() =>
      parsePriceFile({ format: 1, generatedAt: "2026-11-11", suppliers: [supplier] }),
    ).not.toThrow();
  });
});

describe("diffRows", () => {
  const rows = parseCreCsv(BASE, "base");

  it("sees an added row, a changed figure and a dropped row", () => {
    const next = [
      { ...rows[0], fixedFeeYear: 236 },
      { ...rows[1], startDate: "2027-02-01" },
    ];
    const changes = diffRows(rows, next);
    expect(changes.added.map((r) => r.startDate)).toEqual(["2027-02-01"]);
    expect(changes.changed).toEqual([{ before: rows[0], after: next[0] }]);
    expect(changes.removed.map((r) => r.startDate)).toEqual(["2026-08-01"]);
  });

  it("sees nothing between two identical lists", () => {
    expect(diffRows(rows, [...rows])).toEqual({ added: [], changed: [], removed: [] });
  });
});
