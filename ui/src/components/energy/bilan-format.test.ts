import { describe, it, expect, beforeAll } from "vitest";
import i18n from "../../i18n";
import type { BilanArbiter, BilanFee, BilanPriceSpan } from "../../types";
import {
  arbiterTileText,
  billLabel,
  changeMarkers,
  comparisonLines,
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

describe("comparisonLines", () => {
  it("states the average of the previous days", () => {
    const c = comparisonLines({ kind: "days", days: 7, averageBill: 4.2 }, "2026-11-10", FR, t);
    expect(n(c!.main)).toBe("Moyenne des 7 jours précédents : 4,20 € par jour.");
  });

  it("states the projection, then the same month a year earlier", () => {
    const c = comparisonLines(
      { kind: "month", projectedBill: 127.3, previousYearBill: 241.6 },
      "2026-11-10",
      FR,
      t,
    );
    expect(n(c!.main)).toBe("Au même rythme, novembre coûtera environ 127,30 €.");
    expect(n(c!.sub!)).toBe("Novembre 2025 : 241,60 €.");
  });

  it("keeps the previous year alone for a past month, and nothing without data", () => {
    expect(
      n(
        comparisonLines(
          { kind: "month", projectedBill: null, previousYearBill: 100 },
          "2026-10-10",
          FR,
          t,
        )!.main,
      ),
    ).toBe("Octobre 2025 : 100,00 €.");
    expect(
      comparisonLines(
        { kind: "month", projectedBill: null, previousYearBill: null },
        "2026-10-10",
        FR,
        t,
      ),
    ).toBeNull();
  });

  it("names a range of contiguous months with the change in percent", () => {
    const c = comparisonLines(
      {
        kind: "year",
        months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
        bill: 474,
        previousYearBill: 948,
      },
      "2026-11-10",
      FR,
      t,
    );
    expect(n(c!.main)).toBe("De mai à octobre : 474,00 €, contre 948,00 € en 2025 (−50 %).");
  });

  it("elides « de » before a month that starts with a vowel", () => {
    const c = comparisonLines(
      { kind: "year", months: ["2026-04", "2026-05"], bill: 100, previousYearBill: 100 },
      "2026-11-10",
      FR,
      t,
    );
    expect(n(c!.main)).toBe("D'avril à mai : 100,00 €, contre 100,00 € en 2025 (0 %).");
  });

  it("counts the months when they are not contiguous", () => {
    const c = comparisonLines(
      { kind: "year", months: ["2026-05", "2026-07"], bill: 120, previousYearBill: 100 },
      "2026-11-10",
      FR,
      t,
    );
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
      [span("2026-10-01", "2026-10-31", { fixedFeeYear: 239.84 })],
      prices,
      FR,
      t,
    );
    expect(n(one.intro)).toBe(
      "Tarif : heures pleines 0,2142 €/kWh, heures creuses 0,1589 €/kWh, abonnement 239,84 € par an (9 kVA).",
    );
    expect(one.items).toEqual([]);
    const noFee = methodSpans(
      [span("2026-10-01", "2026-10-31", { fixedFeeYear: null })],
      prices,
      FR,
      t,
    );
    expect(n(noFee.intro)).toBe(
      "Tarif : heures pleines 0,2142 €/kWh, heures creuses 0,1589 €/kWh.",
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
      "From January 1 to 31: peak €0.2065/kWh, off-peak €0.1578/kWh, subscription €235.92 a year.",
      "From February 1 to July 31: peak €0.2065/kWh, off-peak €0.1578/kWh, subscription €235.92 a year.",
      "On December 31: peak €0.2065/kWh, off-peak €0.1578/kWh, subscription €235.92 a year.",
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
