import { describe, it, expect } from "vitest";
import {
  arbiterTile,
  billOf,
  computeBilan,
  dayComparison,
  monthComparison,
  splitPoint,
  usageRows,
  yearComparison,
  type BilanInput,
} from "./bilan.js";
import type { EnergyPoint } from "../shared/types.js";

// Spec 200 — the Bilan arithmetic. Dates are built with local constructors so
// the tests hold in any TZ, as the route's buckets do.

const HP = 0.2;
const HC = 0.1;

/** A history point as /energy/history builds it: hp/hc include autoconso. */
function point(time: Date, hp: number, hc: number, autoconso = 0): EnergyPoint {
  const cost_hp = Math.round((hp / 1000) * HP * 10_000) / 10_000;
  const cost_hc = Math.round((hc / 1000) * HC * 10_000) / 10_000;
  return {
    time: time.toISOString(),
    hp,
    hc,
    prod: autoconso,
    autoconso,
    injection: 0,
    cost_hp,
    cost_hc,
    cost_total: Math.round((cost_hp + cost_hc) * 10_000) / 10_000,
  };
}

/** The grid-side bill exactly as computeTotals prices it (spec 123). */
function gridCost(points: EnergyPoint[]): number {
  let hp = 0;
  let hc = 0;
  for (const p of points) {
    const conso = p.hp + p.hc;
    if (conso > 0 && p.autoconso > 0) {
      hp += Math.max(0, p.hp - p.autoconso * (p.hp / conso));
      hc += Math.max(0, p.hc - p.autoconso * (p.hc / conso));
    } else {
      hp += p.hp;
      hc += p.hc;
    }
  }
  return (hp / 1000) * HP + (hc / 1000) * HC;
}

const day = (d: number, h = 0) => new Date(2026, 10, d, h);

describe("splitPoint", () => {
  it("splits a point into paid and avoided, which add up to its cost", () => {
    const p = point(day(10, 12), 3000, 0, 2000);
    const sp = splitPoint(p);
    expect(sp.share).toBeCloseTo(2 / 3, 10);
    expect(sp.paidHp + sp.paidHc).toBeCloseTo(0.2, 4); // 1 kWh from the grid at 0.2
    expect(sp.avoided).toBeCloseTo(0.4, 4); // 2 kWh of solar at 0.2
    expect(sp.paidHp + sp.paidHc + sp.avoided).toBeCloseTo(p.cost_total, 10);
  });

  it("is all zero on a point without consumption", () => {
    const sp = splitPoint(point(day(10, 3), 0, 0, 0));
    expect(sp).toEqual({ paidHp: 0, paidHc: 0, avoided: 0, share: 0, rate: 0 });
  });

  it("clamps a self-consumption above consumption to a share of 1", () => {
    const p = point(day(10, 12), 1000, 0, 1500);
    const sp = splitPoint(p);
    expect(sp.share).toBe(1);
    expect(sp.paidHp + sp.paidHc).toBe(0);
    expect(sp.avoided).toBeCloseTo(p.cost_total, 10);
  });
});

describe("billOf", () => {
  it("equals the grid-side cost of computeTotals over mixed points", () => {
    const points = [
      point(day(10, 2), 0, 800),
      point(day(10, 12), 2500, 0, 1800),
      point(day(10, 15), 400, 600, 300),
      point(day(10, 20), 1200, 0),
    ];
    expect(billOf(points)).toBeCloseTo(gridCost(points), 4);
  });
});

describe("dayComparison", () => {
  it("averages the days that have consumption", () => {
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) =>
      d === 3 || d === 6 ? point(day(d), 0, 0) : point(day(d), 10_000, 0),
    );
    expect(dayComparison(days)).toEqual({ kind: "days", days: 5, averageBill: 2 });
  });

  it("is null when none of the days has data", () => {
    expect(dayComparison([1, 2, 3].map((d) => point(day(d), 0, 0)))).toBeNull();
  });
});

describe("monthComparison", () => {
  const from = new Date(2026, 10, 1);
  const to = new Date(2026, 11, 1);

  /** Daily points of November with consumption on the first `n` days. */
  const days = (n: number) =>
    Array.from({ length: 30 }, (_, i) => point(new Date(2026, 10, i + 1), i < n ? 1000 : 0, 0));

  it("projects the current month at the pace of its complete days", () => {
    // Nov 10 at 22:00: the daily bucket holds Nov 1 to 9, today is not in the bill.
    const now = new Date(2026, 10, 10, 22).getTime();
    const c = monthComparison(30, days(9), from, to, now, []);
    expect(c).toMatchObject({ kind: "month", previousYearBill: null });
    if (c.kind !== "month") throw new Error("kind");
    expect(c.projectedBill).toBeCloseTo((30 * 30) / 9, 3);
  });

  it("starts projecting with two complete days of data", () => {
    // Nov 3 at 22:00: only Nov 1 and 2 are in, two days: the first projection.
    expect(
      monthComparison(5, days(2), from, to, new Date(2026, 10, 3, 22).getTime(), []),
    ).toMatchObject({ projectedBill: 75 });
    // Nov 2: one complete day, too early.
    expect(
      monthComparison(5, days(1), from, to, new Date(2026, 10, 2, 22).getTime(), []),
    ).toMatchObject({ projectedBill: null });
  });

  it("does not project a past month, and gives the previous year when it has data", () => {
    const now = new Date(2027, 0, 5).getTime();
    const previousYear = [point(new Date(2025, 10, 1), 10_000, 0)];
    expect(monthComparison(40, days(30), from, to, now, previousYear)).toEqual({
      kind: "month",
      projectedBill: null,
      previousYearBill: 2,
    });
  });
});

/** Daily points of a year: consumption from `firstDay` of `firstMonth` on. */
function daily(year: number, firstMonth: number, firstDay = 1): EnergyPoint[] {
  const out: EnergyPoint[] = [];
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const has =
      d.getMonth() > firstMonth || (d.getMonth() === firstMonth && d.getDate() >= firstDay);
    out.push(point(new Date(d), has ? 100 : 0, 0));
  }
  return out;
}

describe("yearComparison", () => {
  const months = (year: number, conso: (m: number) => number) =>
    Array.from({ length: 12 }, (_, m) => point(new Date(year, m, 1), conso(m), 0));
  const now = new Date(2026, 10, 10).getTime(); // November not elapsed

  it("compares the elapsed months covered by data in both years", () => {
    const current = months(2026, () => 10_000); // 2 € a month
    const previous = months(2025, (m) => (m >= 4 ? 20_000 : 0)); // data from May
    const coverage = { current: daily(2026, 0), previous: daily(2025, 4) };
    expect(yearComparison(current, previous, coverage, now)).toEqual({
      kind: "year",
      months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
      bill: 12,
      previousYearBill: 24,
    });
  });

  it("leaves out a month the previous year only partly covers", () => {
    // The meter was installed on April 28, 2025: April has data, but 3 days of it.
    const current = months(2026, () => 10_000);
    const previous = months(2025, (m) => (m === 3 ? 300 : m >= 4 ? 20_000 : 0));
    const coverage = { current: daily(2026, 0), previous: daily(2025, 3, 28) };
    const c = yearComparison(current, previous, coverage, now);
    expect(c).toMatchObject({ kind: "year", previousYearBill: 24 });
    if (c?.kind !== "year") throw new Error("kind");
    expect(c.months[0]).toBe("2026-05");
  });

  it("accepts a month missing two days of data, not three", () => {
    const current = months(2026, () => 10_000);
    const previous = months(2025, (m) => (m >= 3 ? 20_000 : 0));
    // April has 30 days: from April 3, 28 days of data; from April 4, 27.
    const twoMissing = { current: daily(2026, 0), previous: daily(2025, 3, 3) };
    const threeMissing = { current: daily(2026, 0), previous: daily(2025, 3, 4) };
    const first = (c: ReturnType<typeof yearComparison>) =>
      c?.kind === "year" ? c.months[0] : null;
    expect(first(yearComparison(current, previous, twoMissing, now))).toBe("2026-04");
    expect(first(yearComparison(current, previous, threeMissing, now))).toBe("2026-05");
  });

  it("is null without a comparable month", () => {
    const coverage = { current: daily(2026, 0), previous: daily(2025, 12) };
    expect(
      yearComparison(
        months(2026, () => 1000),
        months(2025, () => 0),
        coverage,
        now,
      ),
    ).toBeNull();
  });
});

describe("usageRows", () => {
  it("prices each meter per point and sorts by paid", () => {
    const points = [point(day(10, 2), 0, 1000), point(day(10, 12), 2000, 0, 1000)];
    const rows = usageRows(
      [
        {
          id: "heater",
          name: "Heater",
          colorIndex: 0,
          points: [
            { time: points[0].time, wh: 0 },
            { time: points[1].time, wh: 1000 },
          ],
        },
        {
          id: null,
          name: "other",
          colorIndex: null,
          points: [
            { time: points[0].time, wh: 1000 },
            { time: points[1].time, wh: 1000 },
          ],
        },
      ],
      points,
    );
    // Other: 1 kWh at night (0.1 €), 1 kWh at noon half solar (0.1 paid, 0.1 avoided).
    expect(rows[0]).toMatchObject({ id: null, wh: 2000, paid: 0.2, avoided: 0.1 });
    expect(rows[1]).toMatchObject({ id: "heater", wh: 1000, paid: 0.1, avoided: 0.1 });
    // The rows cover the main meter: their paid € sum to the bill.
    expect(rows[0].paid + rows[1].paid).toBeCloseTo(billOf(points), 4);
  });

  it("drops a meter with no energy", () => {
    const points = [point(day(10, 2), 0, 1000)];
    const rows = usageRows(
      [{ id: "x", name: "X", colorIndex: 1, points: [{ time: points[0].time, wh: 0 }] }],
      points,
    );
    expect(rows).toEqual([]);
  });
});

describe("arbiterTile", () => {
  // Rows booked in euros before spec 202: no HP/HC split to price.
  const booked = (day: string, equipmentId: string, solarWh: number, avoidedEur: number) => ({
    day,
    equipmentId,
    solarWh,
    solarHpWh: 0,
    solarHcWh: 0,
    avoidedEur,
  });
  // Rows booked in Wh since spec 202: priced when read.
  const measured = (day: string, equipmentId: string, solarHpWh: number, solarHcWh: number) => ({
    day,
    equipmentId,
    solarWh: solarHpWh + solarHcWh,
    solarHpWh,
    solarHcWh,
    avoidedEur: 0,
  });
  const rows = [
    booked("2026-11-10", "car", 4600, 0.8),
    booked("2026-11-10", "heater", 1800, 0.3),
    booked("2026-11-11", "car", 1000, 0.17),
    booked("2026-10-31", "car", 9999, 9),
  ];
  const name = (id: string) => (id === "car" ? "Borne" : null);
  const prices = () => ({ hp: HP, hc: HC });

  it("sums the period's rows per load, sorted by €", () => {
    const t = arbiterTile(true, "2026-11-01", rows, "2026-11-01", "2026-11-30", name, prices);
    expect(t).toMatchObject({ enabled: true, measured: "full", solarWh: 7400, avoided: 1.27 });
    expect(t.loads).toEqual([
      { equipmentId: "car", name: "Borne", solarWh: 5600, avoided: 0.97 },
      { equipmentId: "heater", name: null, solarWh: 1800, avoided: 0.3 },
    ]);
  });

  it("prices the Wh of a row with the prices of its day (spec 202)", () => {
    const t = arbiterTile(
      true,
      "2026-11-01",
      [measured("2026-11-12", "car", 3000, 1000)],
      "2026-11-01",
      "2026-11-30",
      name,
      prices,
    );
    expect(t.solarWh).toBe(4000);
    expect(t.avoided).toBeCloseTo(3 * HP + 1 * HC, 4);
  });

  it("adds the booked euros and the priced Wh of a row that holds both", () => {
    // The day of the upgrade: euros before, Wh after, in one row.
    const row = { ...measured("2026-11-11", "car", 2000, 0), solarWh: 3000, avoidedEur: 0.17 };
    const t = arbiterTile(true, "2026-11-01", [row], "2026-11-01", "2026-11-30", name, prices);
    expect(t.solarWh).toBe(3000);
    expect(t.avoided).toBeCloseTo(0.17 + 2 * HP, 4);
  });

  it("prices each day at its own version across a price change", () => {
    const byDay = (day: string) =>
      day < "2026-11-15" ? { hp: 0.2, hc: 0.1 } : { hp: 0.3, hc: 0.1 };
    const t = arbiterTile(
      true,
      "2026-11-01",
      [measured("2026-11-14", "car", 1000, 0), measured("2026-11-15", "car", 1000, 0)],
      "2026-11-01",
      "2026-11-30",
      name,
      byDay,
    );
    expect(t.avoided).toBeCloseTo(0.2 + 0.3, 4);
  });

  it("says none, partial or full against the first measured day", () => {
    const tile = (since: string | null) =>
      arbiterTile(true, since, [], "2026-11-01", "2026-11-30", name, prices).measured;
    expect(tile(null)).toBe("none");
    expect(tile("2026-12-02")).toBe("none");
    expect(tile("2026-11-10")).toBe("partial");
    expect(tile("2026-11-01")).toBe("full");
  });
});

describe("computeBilan", () => {
  function input(over: Partial<BilanInput> = {}): BilanInput {
    const points = [
      point(day(10, 2), 0, 800),
      point(day(10, 12), 3000, 0, 2000),
      point(day(10, 15), 0, 1000, 600),
    ];
    const cost_hp = 0.2; // grid side: 1 kWh HP
    const cost_hc = 0.08 + 0.04; // 0.8 kWh + 0.4 kWh HC
    return {
      period: "day",
      from: day(10),
      to: day(11),
      resolution: "1h",
      now: day(10, 18).getTime(),
      tariffConfigured: true,
      prices: { hp: HP, hc: HC },
      hasProduction: true,
      points,
      totals: {
        total_consumption: 2200,
        total_hp: 1000,
        total_hc: 1200,
        total_production: 2600,
        total_autoconso: 2600,
        total_injection: 0,
        cost_hp,
        cost_hc,
        cost_total: cost_hp + cost_hc,
      },
      reference: [],
      usage: [],
      arbiter: arbiterTile(
        false,
        null,
        [],
        "2026-11-10",
        "2026-11-10",
        () => null,
        () => ({ hp: HP, hc: HC }),
      ),
      ...over,
    };
  }

  it("makes bill + avoided equal the sum of the points' costs", () => {
    const i = input();
    const b = computeBilan(i);
    const pointsCost = i.points.reduce((s, p) => s + p.cost_total, 0);
    expect(b.bill.total + b.avoided).toBeCloseTo(pointsCost, 4);
  });

  it("makes the bars' paid parts sum to the bill and their avoided parts to the total", () => {
    const b = computeBilan(input());
    const paid = b.points.reduce((s, p) => s + p.paidHp + p.paidHc, 0);
    const avoided = b.points.reduce((s, p) => s + p.avoided, 0);
    expect(paid).toBeCloseTo(b.bill.total, 3);
    expect(avoided).toBeCloseTo(b.avoided, 3);
  });

  it("adds the previous year's bill to each month in the year view", () => {
    const months = (year: number, conso: number) =>
      Array.from({ length: 12 }, (_, m) => point(new Date(year, m, 1), conso, 0));
    const b = computeBilan(
      input({
        period: "year",
        from: new Date(2026, 0, 1),
        to: new Date(2027, 0, 1),
        resolution: "1mo",
        now: new Date(2026, 10, 10).getTime(),
        points: months(2026, 10_000),
        reference: [
          ...months(2025, 0).slice(0, 3),
          point(new Date(2025, 3, 1), 300, 0), // April 2025: 3 days of data
          ...months(2025, 20_000).slice(4),
        ],
        coverage: { current: daily(2026, 0), previous: daily(2025, 3, 28) },
      }),
    );
    expect(b.points[0].previousYearBill).toBeNull();
    expect(b.points[3].previousYearBill).toBeNull(); // partial month: no tick
    expect(b.points[4].previousYearBill).toBe(4);
    expect(b.comparison).toMatchObject({ kind: "year", previousYearBill: 24 });
  });

  it("leaves previousYearBill out of the day and month views", () => {
    expect(computeBilan(input()).points[0]).not.toHaveProperty("previousYearBill");
  });
});
