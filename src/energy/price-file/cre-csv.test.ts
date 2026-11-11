import { describe, expect, it } from "vitest";
import { CreCsvError, buildEdfTarifBleu, diffRows, parseCreCsv } from "./cre-csv.js";
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
