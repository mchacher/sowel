import { describe, it, expect, beforeAll } from "vitest";
import i18n from "../../i18n";
import type { BilanArbiter, BilanComparison, BilanFee, BilanPriceSpan } from "../../types";
import {
  arbiterTileText,
  averagePrice,
  billLabel,
  changeMarkers,
  comparisonLines,
  energyComparisonLines,
  energyLabel,
  energyLines,
  feeLines,
  methodSpans,
  showArbiterTile,
} from "./bilan-format";

// Spec 200 — the words of the Bilan page, in French (the maintainer's language).

const t = i18n.t.bind(i18n) as (k: string, o?: Record<string, unknown>) => string;
const FR = "fr-FR";

beforeAll(async () => {
  await i18n.changeLanguage("fr");
});

/** Normalise the narrow spaces Intl puts in French numbers. */
const n = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

describe("billLabel", () => {
  it("names today's bill as in progress, another day by its date", () => {
    expect(billLabel("day", "2026-11-10", "2026-11-10", FR, t)).toBe("Facture du jour, en cours");
    expect(billLabel("day", "2026-11-09", "2026-11-10", FR, t)).toBe("Facture du 9 novembre");
  });

  it("names the current month up to today, a past month with its year", () => {
    expect(billLabel("month", "2026-11-03", "2026-11-10", FR, t)).toBe(
      "Facture de novembre, au 10",
    );
    expect(billLabel("month", "2026-10-03", "2026-11-10", FR, t)).toBe("Facture d'octobre 2026");
    expect(billLabel("month", "2026-09-03", "2026-11-10", FR, t)).toBe("Facture de septembre 2026");
  });

  it("names the current year up to today, a past year alone", () => {
    expect(billLabel("year", "2026-03-01", "2026-11-10", FR, t)).toBe(
      "Facture 2026, au 10 novembre",
    );
    expect(billLabel("year", "2025-03-01", "2026-11-10", FR, t)).toBe("Facture 2025");
  });
});

// The € comparisons below do not read the Wh fields (spec 207): zeros.
const days = (d: number, averageBill: number): BilanComparison => ({
  kind: "days",
  days: d,
  averageBill,
  averageGridWh: 0,
});
const month = (projectedBill: number | null, previousYearBill: number | null): BilanComparison => ({
  kind: "month",
  projectedBill,
  previousYearBill,
  projectedGridWh: null,
  previousYearGridWh: null,
});
const year = (months: string[], bill: number, previousYearBill: number): BilanComparison => ({
  kind: "year",
  months,
  bill,
  previousYearBill,
  gridWh: 0,
  previousYearGridWh: 0,
});

describe("comparisonLines", () => {
  it("states the average of the previous days", () => {
    const c = comparisonLines(days(7, 4.2), "2026-11-10", FR, t);
    expect(n(c!.main)).toBe("Moyenne des 7 jours précédents : 4,20 € par jour.");
  });

  it("states the projection, then the same month a year earlier", () => {
    const c = comparisonLines(month(127.3, 241.6), "2026-11-10", FR, t);
    expect(n(c!.main)).toBe("Au même rythme, novembre coûtera environ 127,30 €.");
    expect(n(c!.sub!)).toBe("Novembre 2025 : 241,60 €.");
  });

  it("keeps the previous year alone for a past month, and nothing without data", () => {
    expect(n(comparisonLines(month(null, 100), "2026-10-10", FR, t)!.main)).toBe(
      "Octobre 2025 : 100,00 €.",
    );
    expect(comparisonLines(month(null, null), "2026-10-10", FR, t)).toBeNull();
  });

  it("names a range of contiguous months with the change in percent", () => {
    const c = comparisonLines(
      year(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], 474, 948),
      "2026-11-10",
      FR,
      t,
    );
    expect(n(c!.main)).toBe("De mai à octobre : 474,00 €, contre 948,00 € en 2025 (−50 %).");
  });

  it("elides « de » before a month that starts with a vowel", () => {
    const c = comparisonLines(year(["2026-04", "2026-05"], 100, 100), "2026-11-10", FR, t);
    expect(n(c!.main)).toBe("D'avril à mai : 100,00 €, contre 100,00 € en 2025 (0 %).");
  });

  it("counts the months when they are not contiguous", () => {
    const c = comparisonLines(year(["2026-05", "2026-07"], 120, 100), "2026-11-10", FR, t);
    expect(n(c!.main)).toBe("Sur 2 mois comparables : 120,00 €, contre 100,00 € en 2025 (+20 %).");
  });
});

describe("arbiter tile", () => {
  const base: BilanArbiter = {
    enabled: true,
    since: "2026-11-10",
    measured: "full",
    solarWh: 7600,
    avoided: 0.7,
    loads: [
      { equipmentId: "a", name: "Borne Tuya", solarWh: 5400, avoided: 0.5 },
      { equipmentId: "b", name: null, solarWh: 2200, avoided: 0.2 },
      { equipmentId: "c", name: "Piscine", solarWh: 100, avoided: 0.01 },
    ],
  };

  it("gives the gain and the two loads that earned most", () => {
    const a = arbiterTileText(base, FR, t);
    expect(n(a.value!)).toBe("0,70 €");
    expect(n(a.caption)).toBe("Borne Tuya 5,4 kWh, Équipement supprimé 2,2 kWh");
    expect(a.note).toBeUndefined();
  });

  it("says when the measure started inside the period", () => {
    const a = arbiterTileText({ ...base, measured: "partial" }, FR, t);
    expect(a.note).toBe("Mesuré depuis le 10 novembre 2026.");
  });

  it("reads not measured before the first day", () => {
    const a = arbiterTileText({ ...base, measured: "none", loads: [], avoided: 0 }, FR, t);
    expect(a.value).toBeNull();
    expect(a.caption).toBe("Mesuré à partir du 10 novembre 2026.");
  });

  it("is hidden when the arbiter is off and earned nothing", () => {
    expect(showArbiterTile({ ...base, enabled: false, loads: [] })).toBe(false);
    expect(showArbiterTile({ ...base, enabled: false })).toBe(true);
  });
});

// ── Spec 205 — the fee and the price spans ──────────────────────────────

const tEn = i18n.getFixedT("en") as unknown as (k: string, o?: Record<string, unknown>) => string;
const EN = "en-US";

describe("feeLines", () => {
  const fee: BilanFee = { total: 20.3836, days: 31, daysWithoutFee: 0, kva: 9 };

  it("names the power and the days counted, and adds the fee to the bill", () => {
    const f = feeLines(fee, 136.86, FR, t);
    expect(f.label).toBe("Abonnement 9 kVA");
    expect(f.caption).toBe("Part fixe au prorata, 31 jours");
    expect(f.missing).toBe(false);
    expect(n(f.amount)).toBe("20,38 €");
    expect(n(f.total)).toBe("157,24 €");
  });

  it("leaves the power out when unknown", () => {
    expect(feeLines({ ...fee, kva: null }, 0, FR, t).label).toBe("Abonnement");
  });

  it("says how many days have no fee, and asks for the link", () => {
    const f = feeLines({ ...fee, daysWithoutFee: 10 }, 0, FR, t);
    expect(f.caption).toBe(
      "Part fixe au prorata, 31 jours, dont 10 jours sans abonnement renseigné",
    );
    expect(f.missing).toBe(true);
    expect(feeLines({ ...fee, days: 1, daysWithoutFee: 1, kva: null }, 0, FR, t).caption).toBe(
      "Part fixe au prorata, 1 jour, dont 1 jour sans abonnement renseigné",
    );
  });

  it("reads in English", () => {
    const f = feeLines({ ...fee, daysWithoutFee: 10 }, 136.86, EN, tEn);
    expect(f.label).toBe("Subscription 9 kVA");
    expect(f.caption).toBe(
      "Fixed part, prorated, 31 days, including 10 days without a subscription set",
    );
  });
});

describe("methodSpans", () => {
  const span = (from: string, to: string, over: Partial<BilanPriceSpan> = {}): BilanPriceSpan => ({
    from,
    to,
    hp: 0.2065,
    hc: 0.1578,
    fixedFeeYear: 235.92,
    kva: 9,
    ...over,
  });
  const prices = { hp: 0.2142, hc: 0.1589 };

  it("keeps the single sentence for one version, with the fee and the power", () => {
    const one = methodSpans(
      [span("2026-10-01", "2026-10-31", { ...prices, fixedFeeYear: 239.84 })],
      prices,
      FR,
      t,
    );
    expect(n(one.intro)).toBe(
      "Tarif : heures pleines 0,2142 €/kWh, heures creuses 0,1589 €/kWh, abonnement 239,84 € par an (9 kVA).",
    );
    expect(one.items).toEqual([]);
    const noFee = methodSpans(
      [span("2026-10-01", "2026-10-31", { ...prices, fixedFeeYear: null })],
      prices,
      FR,
      t,
    );
    expect(n(noFee.intro)).toBe(
      "Tarif : heures pleines 0,2142 €/kWh, heures creuses 0,1589 €/kWh.",
    );
  });

  it("states the prices of the one span, not those of the last day", () => {
    // A single version starting 16 July, July read on the 11th: the response's
    // `prices` (today) are 0/0, the span carries the version's own prices.
    const one = methodSpans(
      [span("2026-07-16", "2026-07-31", { fixedFeeYear: 300 })],
      { hp: 0, hc: 0 },
      FR,
      t,
    );
    expect(n(one.intro)).toBe(
      "Tarif : heures pleines 0,2065 €/kWh, heures creuses 0,1578 €/kWh, abonnement 300,00 € par an (9 kVA).",
    );
  });

  it("lists each part when the prices changed, in French", () => {
    const m = methodSpans(
      [
        span("2026-01-01", "2026-01-31", { hp: 0.2081, hc: 0.1635, fixedFeeYear: null }),
        span("2026-02-01", "2026-07-31"),
      ],
      prices,
      FR,
      t,
    );
    expect(m.intro).toBe("Les prix ont changé pendant la période.");
    expect(m.items.map(n)).toEqual([
      "Du 1er au 31 janvier : heures pleines 0,2081 €/kWh, heures creuses 0,1635 €/kWh.",
      "Du 1er février au 31 juillet : heures pleines 0,2065 €/kWh, heures creuses 0,1578 €/kWh, abonnement 235,92 € par an.",
    ]);
  });

  it("lists each part when the prices changed, in English", () => {
    const m = methodSpans(
      [
        span("2026-01-01", "2026-01-31"),
        span("2026-02-01", "2026-07-31"),
        span("2026-12-31", "2026-12-31"),
      ],
      prices,
      EN,
      tEn,
    );
    expect(m.intro).toBe("Prices changed during the period.");
    expect(m.items).toEqual([
      "From January 1 to 31: peak hours €0.2065/kWh, off-peak hours €0.1578/kWh, subscription €235.92 a year.",
      "From February 1 to July 31: peak hours €0.2065/kWh, off-peak hours €0.1578/kWh, subscription €235.92 a year.",
      "On December 31: peak hours €0.2065/kWh, off-peak hours €0.1578/kWh, subscription €235.92 a year.",
    ]);
  });
});

describe("changeMarkers", () => {
  const spans = [
    { from: "2026-01-01", to: "2026-07-15", hp: 0.2, hc: 0.1, fixedFeeYear: null, kva: null },
    { from: "2026-07-16", to: "2026-12-31", hp: 0.3, hc: 0.1, fixedFeeYear: null, kva: null },
  ];

  it("marks each change after the first part, by day or by month, never on the day view", () => {
    expect(changeMarkers("month", spans)).toEqual(["2026-07-16"]);
    expect(changeMarkers("year", spans)).toEqual(["2026-07"]);
    expect(changeMarkers("day", spans)).toEqual([]);
    expect(changeMarkers("month", spans.slice(0, 1))).toEqual([]);
  });
});

// ── Spec 207 — the consumption in kWh ───────────────────────────────────

describe("energyLabel", () => {
  it("names the period after « Électricité consommée »", () => {
    expect(energyLabel("month", "2026-10-03", "2026-11-10", FR, t)).toBe(
      "Électricité consommée en octobre",
    );
    expect(energyLabel("day", "2026-11-09", "2026-11-10", FR, t)).toBe(
      "Électricité consommée le 9 novembre",
    );
    expect(energyLabel("day", "2026-11-10", "2026-11-10", FR, t)).toBe(
      "Électricité consommée aujourd'hui",
    );
    expect(energyLabel("year", "2026-03-01", "2026-11-10", FR, t)).toBe(
      "Électricité consommée en 2026",
    );
    expect(energyLabel("month", "2026-10-03", "2026-11-10", EN, tEn)).toBe(
      "Electricity used in October",
    );
  });
});

describe("energyLines", () => {
  const october = { gridHpWh: 446_000, gridHcWh: 260_000, consumedWh: 920_000 };

  it("gives the three parts and the sentence with production", () => {
    const e = energyLines(october, 214_000, true, FR, t);
    expect(n(e.total)).toBe("920 kWh");
    expect(e.parts.map((p) => [p.key, n(p.value)])).toEqual([
      ["hp", "446 kWh"],
      ["hc", "260 kWh"],
      ["solar", "214 kWh"],
    ]);
    // 214 / 920 = 23.3 %: rounded to the percent.
    expect(n(e.sentence)).toBe(
      "706 kWh achetés au réseau, 214 kWh produits et consommés sur place (23 %).",
    );
    expect(n(energyLines(october, 214_000, true, EN, tEn).sentence)).toBe(
      "706 kWh bought from the grid, 214 kWh produced and used on site (23%).",
    );
  });

  it("leaves the solar part and its half of the sentence out without production", () => {
    const e = energyLines({ ...october, consumedWh: 706_000 }, 0, false, FR, t);
    expect(n(e.total)).toBe("706 kWh");
    expect(e.parts.map((p) => p.key)).toEqual(["hp", "hc"]);
    expect(n(e.sentence)).toBe("706 kWh achetés au réseau.");
  });

  it("shows one decimal below 100 kWh", () => {
    const e = energyLines(
      { gridHpWh: 9_400, gridHcWh: 5_000, consumedWh: 18_600 },
      4_200,
      true,
      FR,
      t,
    );
    expect(n(e.total)).toBe("18,6 kWh");
  });
});

describe("energyComparisonLines", () => {
  const monthWh = (projectedGridWh: number | null, previousYearGridWh: number | null) => ({
    ...month(null, null),
    projectedGridWh,
    previousYearGridWh,
  });

  it("states the same month a year earlier with the change, once the month is over", () => {
    const c = energyComparisonLines(
      monthWh(null, 1_036_000),
      706_000,
      "2026-10-15",
      "2026-11-11",
      FR,
      t,
    );
    expect(n(c!.main)).toBe("Octobre 2025 : 1 036 kWh achetés (−32 %).");
    const en = energyComparisonLines(
      monthWh(null, 1_036_000),
      706_000,
      "2026-10-15",
      "2026-11-11",
      EN,
      tEn,
    );
    expect(n(en!.main)).toBe("October 2025: 1,036 kWh bought (-32%).");
  });

  it("states the pace of the current month, then the previous year without a change", () => {
    const c = energyComparisonLines(
      monthWh(1_120_000, 1_036_000),
      400_000,
      "2026-11-05",
      "2026-11-11",
      FR,
      t,
    );
    expect(n(c!.main)).toBe("Au même rythme, novembre consommera environ 1 120 kWh achetés.");
    expect(n(c!.sub!)).toBe("Novembre 2025 : 1 036 kWh achetés.");
  });

  it("gives no line when the previous year has no data", () => {
    expect(
      energyComparisonLines(monthWh(null, null), 706_000, "2026-10-15", "2026-11-11", FR, t),
    ).toBeNull();
  });

  it("states the 7-day average, in French and in English", () => {
    const c = { ...days(5, 4.2), averageGridWh: 24_100 };
    expect(n(energyComparisonLines(c, 0, "2026-11-10", "2026-11-11", FR, t)!.main)).toBe(
      "Moyenne des 5 jours précédents : 24,1 kWh achetés par jour.",
    );
    expect(n(energyComparisonLines(c, 0, "2026-11-10", "2026-11-11", EN, tEn)!.main)).toBe(
      "Average of the previous 5 days: 24.1 kWh bought a day.",
    );
  });

  it("states the comparable months of the year with the change", () => {
    const c = {
      ...year(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], 0, 0),
      gridWh: 3_210_000,
      previousYearGridWh: 4_012_500,
    };
    expect(n(energyComparisonLines(c, 0, "2026-11-10", "2026-11-11", FR, t)!.main)).toBe(
      "De mai à octobre : 3 210 kWh achetés, contre 4 013 kWh en 2025 (−20 %).",
    );
    expect(n(energyComparisonLines(c, 0, "2026-11-10", "2026-11-11", EN, tEn)!.main)).toBe(
      "May to October: 3,210 kWh bought, against 4,013 kWh in 2025 (-20%).",
    );
  });
});

describe("averagePrice", () => {
  const october = { gridHpWh: 446_000, gridHcWh: 260_000, consumedWh: 920_000 };
  const fee: BilanFee = { total: 20.37, days: 31, daysWithoutFee: 0, kva: 9 };

  it("states the price with and without the fee", () => {
    expect(n(averagePrice(136.86, october, fee, FR, t)!)).toBe(
      "Prix moyen payé : 0,194 €/kWh, 0,223 €/kWh avec l'abonnement.",
    );
    expect(averagePrice(136.86, october, fee, EN, tEn)).toBe(
      "Average price paid: €0.194/kWh, €0.223/kWh with the subscription.",
    );
  });

  it("states one part without a fee", () => {
    expect(n(averagePrice(136.86, october, null, FR, t)!)).toBe("Prix moyen payé : 0,194 €/kWh.");
  });

  it("is null without grid kWh", () => {
    expect(
      averagePrice(0, { gridHpWh: 0, gridHcWh: 0, consumedWh: 12_000 }, fee, FR, t),
    ).toBeNull();
  });
});
