import { describe, expect, it } from "vitest";
import { buildTariffVersionRows, dayBefore, parseDecimalInput } from "./tariffVersions";
import type { TariffVersion } from "../types";

function version(id: string, startDate: string | null): TariffVersion {
  return {
    id,
    startDate,
    prices: { hp: 0.2, hc: 0.15 },
    fixedFeeYear: null,
    kva: null,
    origin: "manual",
    createdAt: "2026-11-11T10:00:00.000Z",
    updatedAt: "2026-11-11T10:00:00.000Z",
  };
}

/** What a row shows, without the version it carries. */
function shown(versions: TariffVersion[], today: string) {
  return buildTariffVersionRows(versions, today).map((r) => ({
    id: r.version.id,
    startDate: r.startDate,
    endDate: r.endDate,
    status: r.status,
  }));
}

describe("buildTariffVersionRows (spec 202, FR6)", () => {
  const three = [
    version("origin", null),
    version("feb", "2026-02-01"),
    version("aug", "2026-08-01"),
  ];

  it("lists newest first, each version ending the day before the next, the last one current", () => {
    expect(shown(three, "2026-11-11")).toEqual([
      { id: "aug", startDate: "2026-08-01", endDate: null, status: "current" },
      { id: "feb", startDate: "2026-02-01", endDate: "2026-07-31", status: null },
      { id: "origin", startDate: null, endDate: "2026-01-31", status: null },
    ]);
  });

  it("marks the last version as upcoming until its start date", () => {
    const withNext = [...three, version("next", "2027-02-01")];
    expect(shown(withNext, "2026-11-11")).toEqual([
      { id: "next", startDate: "2027-02-01", endDate: null, status: "upcoming" },
      { id: "aug", startDate: "2026-08-01", endDate: "2027-01-31", status: null },
      { id: "feb", startDate: "2026-02-01", endDate: "2026-07-31", status: null },
      { id: "origin", startDate: null, endDate: "2026-01-31", status: null },
    ]);
  });

  it("starts a version on its start date, not the day after", () => {
    const withNext = [...three, version("next", "2027-02-01")];
    expect(shown(withNext, "2027-01-31")[0].status).toBe("upcoming");
    expect(shown(withNext, "2027-02-01")[0].status).toBe("current");
  });

  it("reads a single version without a date as current, with no end", () => {
    expect(shown([version("origin", null)], "2026-11-11")).toEqual([
      { id: "origin", startDate: null, endDate: null, status: "current" },
    ]);
  });

  it("returns nothing without a version", () => {
    expect(buildTariffVersionRows([], "2026-11-11")).toEqual([]);
  });

  it("orders by start date whatever order it is given, the dateless version oldest", () => {
    const shuffled = [three[2], three[0], three[1]];
    expect(shown(shuffled, "2026-11-11").map((r) => r.id)).toEqual(["aug", "feb", "origin"]);
  });

  it("does not reorder the list it is given", () => {
    const input = [three[2], three[0], three[1]];
    buildTariffVersionRows(input, "2026-11-11");
    expect(input.map((v) => v.id)).toEqual(["aug", "origin", "feb"]);
  });

  it("ends a period on the last day of the month before a change on the 1st", () => {
    const ends = (start: string) =>
      shown([version("origin", null), version("v", start)], "2030-01-01")[1].endDate;
    expect(ends("2026-03-01")).toBe("2026-02-28");
    expect(ends("2028-03-01")).toBe("2028-02-29");
    expect(ends("2027-01-01")).toBe("2026-12-31");
  });
});

describe("dayBefore", () => {
  it.each([
    ["2026-03-01", "2026-02-28"],
    ["2028-03-01", "2028-02-29"],
    ["2027-01-01", "2026-12-31"],
    ["2026-08-01", "2026-07-31"],
    ["2026-11-11", "2026-11-10"],
    // The nights the clocks change in France: a calendar count, not 24 hours.
    ["2026-03-30", "2026-03-29"],
    ["2026-10-26", "2026-10-25"],
  ])("the day before %s is %s", (day, expected) => {
    expect(dayBefore(day)).toBe(expected);
  });
});

describe("parseDecimalInput", () => {
  it("reads a comma or a dot as the decimal mark", () => {
    expect(parseDecimalInput("0,2142")).toBe(0.2142);
    expect(parseDecimalInput("0.2142")).toBe(0.2142);
    expect(parseDecimalInput(" 190,81 ")).toBe(190.81);
    expect(parseDecimalInput("6")).toBe(6);
    expect(parseDecimalInput("1\u202F234,5")).toBe(1234.5);
  });

  it("refuses what is not a plain positive number", () => {
    for (const text of ["", "abc", "-1", "1,2,3", "1e3", ",5", "5,"]) {
      expect(parseDecimalInput(text), text).toBeNull();
    }
  });
});
