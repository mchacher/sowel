import { beforeEach, describe, expect, it } from "vitest";
import type { EnergyPoint, TariffPrices, TariffVersion } from "../shared/types.js";
import { computeCost } from "./cost-calculator.js";
import {
  crossesChange,
  defaultContract,
  gridSide,
  isPriced,
  monthlyNeedsDaily,
  monthlyPricingPoints,
  normalizeContract,
  periodFee,
  pricePoints,
  priceSpans,
  pricesAt,
  pricesOnOrNull,
  priceSeries,
  priceTotals,
  versionOn,
} from "./pricing.js";

// Spec 202 — pricing by tariff version. The fixtures are synthetic.

type Wh = Omit<EnergyPoint, "cost_hp" | "cost_hc" | "cost_total">;

function version(
  id: string,
  startDate: string | null,
  prices: TariffPrices,
  kva: number | null = null,
): TariffVersion {
  return {
    id,
    startDate,
    prices,
    fixedFeeYear: null,
    kva,
    origin: "manual",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  };
}

const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h);

function wh(time: Date, hp: number, hc: number, autoconso = 0): Wh {
  return { time: time.toISOString(), hp, hc, prod: autoconso, autoconso, injection: 0 };
}

const OLD = version("old", null, { hp: 0.2081, hc: 0.1635 });
const FEB = version("feb", "2026-02-01", { hp: 0.2065, hc: 0.1578 });
const AUG = version("aug", "2026-08-01", { hp: 0.2142, hc: 0.1589 });
const ALL = [AUG, OLD, FEB]; // out of order on purpose

beforeEach(() => {
  process.env.TZ = "Europe/Paris";
});

// ── The computation spec 123 shipped, kept here as the reference ─────────
// One price for everything: each point `computeCost` at that price, and the
// totals the grid-side Wh summed first, then priced once. Spec 202 must give
// exactly these figures as long as there is a single version.

function legacyPoints(points: Wh[], prices: TariffPrices): EnergyPoint[] {
  return points.map((p) => ({ ...p, ...computeCost(p.hp, p.hc, prices) }));
}

function legacyTotals(points: Wh[], prices: TariffPrices) {
  let totalHp = 0;
  let totalHc = 0;
  for (const p of points) {
    const conso = p.hp + p.hc;
    if (conso > 0 && p.autoconso > 0) {
      totalHp += Math.max(0, p.hp - p.autoconso * (p.hp / conso));
      totalHc += Math.max(0, p.hc - p.autoconso * (p.hc / conso));
    } else {
      totalHp += p.hp;
      totalHc += p.hc;
    }
  }
  return computeCost(totalHp, totalHc, prices);
}

/** Awkward Wh values, so that rounding has something to bite on. */
function fixture(step: (i: number) => Date, count: number): Wh[] {
  return Array.from({ length: count }, (_, i) => {
    const hp = (i * 137.3) % 911;
    const hc = (i * 61.7) % 433;
    const autoconso = i % 3 === 0 ? ((i * 43.9) % 700) + 0.37 : 0;
    return wh(step(i), hp, hc, autoconso);
  });
}

describe("versionOn", () => {
  it("gives the version without a date before every dated one", () => {
    expect(versionOn(ALL, "2026-01-31")?.id).toBe("old");
    expect(versionOn(ALL, "1999-01-01")?.id).toBe("old");
  });

  it("switches on the start date, not the day before", () => {
    expect(versionOn(ALL, "2026-07-31")?.id).toBe("feb");
    expect(versionOn(ALL, "2026-08-01")?.id).toBe("aug");
    expect(versionOn(ALL, "2030-01-01")?.id).toBe("aug");
  });

  it("leaves a version dated in the future out until its day", () => {
    const future = version("future", "2027-02-01", { hp: 0.3, hc: 0.2 });
    expect(versionOn([...ALL, future], "2027-01-31")?.id).toBe("aug");
    expect(versionOn([...ALL, future], "2027-02-01")?.id).toBe("future");
  });

  it("gives nothing without versions, or before the only dated one", () => {
    expect(versionOn([], "2026-01-01")).toBeNull();
    expect(versionOn([FEB], "2026-01-31")).toBeNull();
  });
});

describe("pricesAt, pricesOnOrNull, isPriced", () => {
  it("reads the local date of the instant", () => {
    // 23:00 local on 31 July is still July: the local date decides.
    expect(pricesAt(ALL, local(2026, 7, 31, 23))).toEqual(FEB.prices);
    expect(pricesAt(ALL, local(2026, 8, 1, 0))).toEqual(AUG.prices);
  });

  it("gives 0/0 without a version, and null when asked for real prices", () => {
    expect(pricesAt([], local(2026, 8, 1))).toEqual({ hp: 0, hc: 0 });
    expect(pricesOnOrNull([], "2026-08-01")).toBeNull();
    expect(pricesOnOrNull([version("zero", null, { hp: 0, hc: 0 })], "2026-08-01")).toBeNull();
    expect(pricesOnOrNull(ALL, "2026-08-01")).toEqual(AUG.prices);
    expect(isPriced(ALL, "2026-08-01")).toBe(true);
    expect(isPriced([version("zero", null, { hp: 0, hc: 0 })], "2026-08-01")).toBe(false);
  });
});

describe("one version: the figures of spec 123, to the cent", () => {
  const cases: Array<[string, Wh[], boolean]> = [
    [
      "hourly points",
      fixture((i) => local(2026, 5, 1 + Math.floor(i / 24), i % 24), 24 * 9),
      false,
    ],
    ["daily points", fixture((i) => local(2026, 1, 1 + i), 365), false],
    ["monthly points", fixture((i) => local(2026, 1 + i, 1), 12), true],
    // The DST days: 23 and 25 hours long, bucket starts at local midnight.
    ["daily points across DST", fixture((i) => local(2026, 3, 25 + i), 10), false],
  ];

  it.each(cases)("prices %s exactly as before", (_label, points, monthly) => {
    const prices = { hp: 0.2142, hc: 0.1589 };
    const one = [version("only", null, prices)];
    expect(pricePoints(points, one, { monthly })).toEqual(legacyPoints(points, prices));
    expect(priceTotals(points, one)).toEqual(legacyTotals(points, prices));
  });

  it("is the same with daily points at hand for a monthly range", () => {
    const prices = { hp: 0.2142, hc: 0.1589 };
    const one = [version("only", null, prices)];
    const months = fixture((i) => local(2026, 1 + i, 1), 12);
    const days = fixture((i) => local(2026, 1, 1 + i), 365);
    expect(pricePoints(months, one, { monthly: true, daily: days })).toEqual(
      legacyPoints(months, prices),
    );
  });
});

describe("several versions", () => {
  it("prices each point with the version of its local date", () => {
    const points = [wh(local(2026, 7, 31), 1000, 1000), wh(local(2026, 8, 1), 1000, 1000)];
    const [before, after] = pricePoints(points, ALL);
    expect(before).toMatchObject(computeCost(1000, 1000, FEB.prices));
    expect(after).toMatchObject(computeCost(1000, 1000, AUG.prices));
  });

  it("prices the totals per version, then adds them", () => {
    const points = [
      wh(local(2026, 7, 30), 4000, 1000),
      wh(local(2026, 7, 31), 2000, 3000, 2500), // half of it covered by solar
      wh(local(2026, 8, 1), 1000, 1000),
    ];
    const july = computeCost(4000 + 1000, 1000 + 1500, FEB.prices);
    const august = computeCost(1000, 1000, AUG.prices);
    const totals = priceTotals(points, ALL);
    expect(totals.cost_hp).toBeCloseTo(july.cost_hp + august.cost_hp, 4);
    expect(totals.cost_hc).toBeCloseTo(july.cost_hc + august.cost_hc, 4);
    expect(totals.cost_total).toBeCloseTo(july.cost_total + august.cost_total, 4);
  });

  it("prices a month crossed by a change from its days", () => {
    const mid = version("mid", "2026-03-16", { hp: 0.3, hc: 0.1 });
    const first = version("first", null, { hp: 0.2, hc: 0.1 });
    const march = wh(local(2026, 3, 1), 31_000, 0);
    const days = Array.from({ length: 31 }, (_, i) => wh(local(2026, 3, 1 + i), 1000, 0));
    const [priced] = pricePoints([march], [first, mid], { monthly: true, daily: days });
    expect(priced.cost_total).toBeCloseTo(15 * 0.2 + 16 * 0.3, 4);
    expect(priceTotals(days, [first, mid]).cost_total).toBeCloseTo(15 * 0.2 + 16 * 0.3, 4);
    // Without the days, the month falls back on the version of its start.
    expect(pricePoints([march], [first, mid], { monthly: true })[0].cost_total).toBeCloseTo(
      31 * 0.2,
      4,
    );
  });

  it("leaves a month under one version to the monthly point", () => {
    const days = [wh(local(2026, 2, 1), 999, 0)]; // disagrees on purpose
    const february = wh(local(2026, 2, 1), 28_000, 0);
    const [priced] = pricePoints([february], ALL, { monthly: true, daily: days });
    expect(priced).toMatchObject(computeCost(28_000, 0, FEB.prices));
  });

  it("costs nothing without any version", () => {
    const points = [wh(local(2026, 8, 1), 1000, 1000)];
    expect(pricePoints(points, [])[0]).toMatchObject({ cost_hp: 0, cost_hc: 0, cost_total: 0 });
    expect(priceTotals(points, [])).toEqual({ cost_hp: 0, cost_hc: 0, cost_total: 0 });
    expect(priceTotals([], ALL)).toEqual({ cost_hp: 0, cost_hc: 0, cost_total: 0 });
  });

  it("dates a point of a DST day by its local date", () => {
    const dst = version("dst", "2026-03-29", { hp: 0.5, hc: 0.5 }); // the 23-hour day
    const points = [wh(local(2026, 3, 28, 23), 1000, 0), wh(local(2026, 3, 29, 0), 1000, 0)];
    const [before, after] = pricePoints(points, [OLD, dst]);
    expect(before.cost_total).toBeCloseTo(0.2081, 4);
    expect(after.cost_total).toBeCloseTo(0.5, 4);
  });
});

describe("monthlyPricingPoints", () => {
  it("keeps each month, but gives a month crossed by a change to its days", () => {
    const first = version("first", null, { hp: 0.2, hc: 0.1 });
    const mid = version("mid", "2026-03-16", { hp: 0.3, hc: 0.1 });
    const months = [wh(local(2026, 2, 1), 28_000, 0), wh(local(2026, 3, 1), 31_000, 0)];
    const days = [
      wh(local(2026, 2, 10), 999, 0), // disagrees with February on purpose
      wh(local(2026, 3, 15), 1000, 0),
      wh(local(2026, 3, 16), 1000, 0),
    ];
    const pricing = monthlyPricingPoints(months, [first, mid], days);
    expect(pricing.map((p) => p.hp)).toEqual([28_000, 1000, 1000]);
    // February at its monthly figure, March from its two days.
    expect(priceTotals(pricing, [first, mid]).cost_total).toBeCloseTo(28 * 0.2 + 0.2 + 0.3, 4);
  });

  it("keeps a crossed month whose days are missing", () => {
    const mid = version("mid", "2026-03-16", { hp: 0.3, hc: 0.1 });
    const months = [wh(local(2026, 3, 1), 31_000, 0)];
    expect(monthlyPricingPoints(months, [OLD, mid], [])).toEqual(months);
  });
});

describe("crossesChange, monthlyNeedsDaily", () => {
  it("sees a change strictly inside the range", () => {
    expect(crossesChange(ALL, local(2026, 1, 1), local(2027, 1, 1))).toBe(true);
    expect(crossesChange(ALL, local(2026, 8, 1), local(2026, 9, 1))).toBe(false); // starts the range
    expect(crossesChange(ALL, local(2026, 7, 1), local(2026, 8, 1))).toBe(false); // starts the next
    expect(crossesChange([OLD], local(2026, 1, 1), local(2027, 1, 1))).toBe(false);
  });

  it("needs the days only for a change inside a month", () => {
    const year: [Date, Date] = [local(2026, 1, 1), local(2027, 1, 1)];
    expect(monthlyNeedsDaily(ALL, ...year)).toBe(false); // 1 February, 1 August
    expect(monthlyNeedsDaily([OLD, version("mid", "2026-03-16", FEB.prices)], ...year)).toBe(true);
    expect(monthlyNeedsDaily([OLD, version("next", "2027-03-16", FEB.prices)], ...year)).toBe(
      false,
    );
  });
});

describe("gridSide", () => {
  it("takes solar from HP and HC in proportion, never below 0", () => {
    expect(gridSide({ hp: 3000, hc: 1000, autoconso: 2000 })).toEqual({ hp: 1500, hc: 500 });
    expect(gridSide({ hp: 1000, hc: 0, autoconso: 5000 })).toEqual({ hp: 0, hc: 0 });
    expect(gridSide({ hp: 1000, hc: 500, autoconso: 0 })).toEqual({ hp: 1000, hc: 500 });
  });
});

describe("priceSeries", () => {
  it("prices each bucket at the main meter's blended price of that bucket", () => {
    const main = pricePoints(
      [wh(local(2026, 5, 25), 1000, 0), wh(local(2026, 5, 26), 0, 1000)],
      [version("only", null, { hp: 0.2, hc: 0.1 })],
    );
    const offPeakOnly = [
      { time: main[0].time, wh: 0 },
      { time: main[1].time, wh: 500 },
    ];
    expect(priceSeries(offPeakOnly, main)).toBeCloseTo(0.05, 4);
    expect(priceSeries([{ time: main[0].time, wh: 500 }], main)).toBeCloseTo(0.1, 4);
  });

  it("costs nothing for a bucket the main meter did not consume in", () => {
    const main = pricePoints([wh(local(2026, 5, 25), 0, 0)], [OLD]);
    expect(priceSeries([{ time: main[0].time, wh: 500 }], main)).toBe(0);
    expect(priceSeries([{ time: "2026-01-01T00:00:00.000Z", wh: 500 }], main)).toBe(0);
  });
});

describe("normalizeContract", () => {
  it("rebuilds a known contract, and nothing else", () => {
    expect(
      normalizeContract({ supplier: "edf-tarif-bleu", contractType: "hphc", kva: 9, extra: "x" }),
    ).toEqual({ supplier: "edf-tarif-bleu", contractType: "hphc", kva: 9, autoUpdate: true });
    expect(normalizeContract({ supplier: "other", contractType: "base", kva: 0 })).toEqual({
      supplier: "other",
      contractType: "base",
      kva: null,
      autoUpdate: false,
    });
  });

  it("follows the price file unless switched off, and never for another supplier (spec 203)", () => {
    const edf = { supplier: "edf-tarif-bleu", contractType: "hphc", kva: 9 };
    expect(normalizeContract(edf)?.autoUpdate).toBe(true);
    expect(normalizeContract({ ...edf, autoUpdate: false })?.autoUpdate).toBe(false);
    expect(normalizeContract({ ...edf, autoUpdate: "no" })?.autoUpdate).toBe(true);
    expect(
      normalizeContract({ supplier: "other", contractType: "hphc", kva: 9, autoUpdate: true })
        ?.autoUpdate,
    ).toBe(false);
  });

  it("refuses an unknown supplier or type, and anything that is not an object", () => {
    expect(normalizeContract({ supplier: "<script>", contractType: "hphc", kva: 6 })).toBeNull();
    expect(normalizeContract({ supplier: "other", contractType: "tempo", kva: 6 })).toBeNull();
    expect(normalizeContract(null)).toBeNull();
    expect(normalizeContract("other")).toBeNull();
  });
});

describe("defaultContract", () => {
  const schedule = (tariff: "hp" | "hc") => ({
    schedules: [{ days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: "22:00", end: "06:00", tariff }] }],
    prices: { hp: 0, hc: 0 },
  });

  it("reads HP/HC from an off-peak slot, and the power of the latest version", () => {
    const versions = [version("a", null, OLD.prices, 6), version("b", "2026-08-01", AUG.prices, 9)];
    expect(defaultContract(schedule("hc"), versions)).toEqual({
      supplier: "other",
      contractType: "hphc",
      kva: 9,
      autoUpdate: false,
    });
  });

  it("reads HP/HC from an off-peak slot in summer only (spec 204)", () => {
    const summerOnly = {
      ...schedule("hp"),
      summer: {
        from: "04-01",
        to: "10-31",
        schedules: [
          {
            days: [0, 1, 2, 3, 4, 5, 6],
            slots: [{ start: "12:00", end: "15:00", tariff: "hc" as const }],
          },
        ],
      },
    };
    expect(defaultContract(summerOnly, []).contractType).toBe("hphc");
  });

  it("reads Base without an off-peak slot or without a schedule", () => {
    expect(defaultContract(schedule("hp"), []).contractType).toBe("base");
    expect(defaultContract(null, [])).toEqual({
      supplier: "other",
      contractType: "base",
      kva: null,
      autoUpdate: false,
    });
  });
});

// ── Spec 205 — fixed fee and price spans ────────────────────────────────

/** A version carrying a yearly fee. */
function feeVersion(
  id: string,
  startDate: string | null,
  fixedFeeYear: number | null,
  kva: number | null = 9,
): TariffVersion {
  return { ...version(id, startDate, { hp: 0.2, hc: 0.15 }, kva), fixedFeeYear };
}

describe("periodFee", () => {
  it("prorates one fee over a 31-day month of a common year", () => {
    const fee = periodFee([feeVersion("a", null, 240)], "2026-07-01", "2026-07-31");
    expect(fee).not.toBeNull();
    expect(fee!.total).toBeCloseTo((31 * 240) / 365, 10);
    expect(fee).toMatchObject({ days: 31, daysWithoutFee: 0, kva: 9 });
  });

  it("adds both parts of a month crossed by a fee change on the 16th, each at its own rate", () => {
    const versions = [feeVersion("a", null, 240), feeVersion("b", "2026-07-16", 300, 12)];
    const fee = periodFee(versions, "2026-07-01", "2026-07-31");
    expect(fee!.total).toBeCloseTo((15 * 240) / 365 + (16 * 300) / 365, 10);
    expect(fee!.days).toBe(31);
    // The power of the last day counted.
    expect(fee!.kva).toBe(12);
  });

  it("divides by 366 in a leap year", () => {
    const fee = periodFee([feeVersion("a", null, 240)], "2028-02-01", "2028-02-29");
    expect(fee!.days).toBe(29);
    expect(fee!.total).toBeCloseTo((29 * 240) / 366, 10);
  });

  it("counts the days of a version without fee as without fee", () => {
    const versions = [feeVersion("a", null, null, null), feeVersion("b", "2026-07-11", 240)];
    const fee = periodFee(versions, "2026-07-01", "2026-07-31");
    expect(fee).toMatchObject({ days: 31, daysWithoutFee: 10, kva: 9 });
    expect(fee!.total).toBeCloseTo((21 * 240) / 365, 10);
  });

  it("gives null when no version has a fee, or when nothing is counted", () => {
    expect(periodFee([feeVersion("a", null, null)], "2026-07-01", "2026-07-31")).toBeNull();
    expect(periodFee([], "2026-07-01", "2026-07-31")).toBeNull();
    expect(periodFee([feeVersion("a", null, 240)], "2026-07-02", "2026-07-01")).toBeNull();
  });

  it("counts 365 calendar days over a year that crosses both daylight-saving changes", () => {
    const fee = periodFee([feeVersion("a", null, 240)], "2026-01-01", "2026-12-31");
    expect(fee!.days).toBe(365);
    expect(fee!.total).toBeCloseTo(240, 10);
  });
});

describe("priceSpans", () => {
  const A = feeVersion("a", null, null, null);
  const B = feeVersion("b", "2026-02-01", 235.92);
  const C = feeVersion("c", "2026-08-01", 250.5);

  it("gives one span, the period, for a period inside one version", () => {
    expect(priceSpans([C, A, B], "2026-03-01", "2026-03-31")).toEqual([
      { from: "2026-03-01", to: "2026-03-31", hp: 0.2, hc: 0.15, fixedFeeYear: 235.92, kva: 9 },
    ]);
  });

  it("gives three contiguous spans, clamped, for a period crossed by two changes", () => {
    const spans = priceSpans([C, A, B], "2026-01-01", "2026-12-31");
    expect(spans.map((s) => [s.from, s.to])).toEqual([
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-07-31"],
      ["2026-08-01", "2026-12-31"],
    ]);
    expect(spans.map((s) => s.fixedFeeYear)).toEqual([null, 235.92, 250.5]);
  });

  it("gives the version without date, clamped, for a period before the first dated one", () => {
    expect(priceSpans([C, A, B], "2025-05-01", "2025-05-31")).toEqual([
      { from: "2025-05-01", to: "2025-05-31", hp: 0.2, hc: 0.15, fixedFeeYear: null, kva: null },
    ]);
  });

  it("lists a version that starts after today inside the period", () => {
    const spans = priceSpans([A, feeVersion("d", "2026-11-20", 240)], "2026-11-01", "2026-11-30");
    expect(spans.map((s) => s.from)).toEqual(["2026-11-01", "2026-11-20"]);
  });
});
