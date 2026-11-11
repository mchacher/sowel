import { describe, it, expect } from "vitest";
import {
  TariffClassifier,
  slotRanges,
  isWithinSlot,
  isSummer,
  schedulesOn,
  SUMMER_DEFAULT,
} from "./tariff-classifier.js";
import { createLogger } from "../core/logger.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { TariffConfig } from "../shared/types.js";

const logger = createLogger("silent").logger;

function makeClassifier(config: TariffConfig | null | string): TariffClassifier {
  const raw =
    typeof config === "string" ? config : config === null ? undefined : JSON.stringify(config);
  const settings = { get: () => raw } as unknown as SettingsManager;
  return new TariffClassifier(settings, logger);
}

/** Epoch seconds for a local wall-clock time on a known weekday. */
function epochAt(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

// 2026-08-10 is a Monday (day 1).
const MONDAY = "2026-08-10";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

describe("slotRanges", () => {
  it("returns a single range for an ordinary slot", () => {
    expect(slotRanges({ start: "06:00", end: "22:00", tariff: "hp" })).toEqual([[360, 1320]]);
  });

  it("reads an end of 00:00 as midnight at the end of the day", () => {
    expect(slotRanges({ start: "22:00", end: "00:00", tariff: "hc" })).toEqual([[1320, 1440]]);
  });

  it("splits a slot that wraps past midnight into two ranges", () => {
    expect(slotRanges({ start: "22:00", end: "06:00", tariff: "hc" })).toEqual([
      [1320, 1440],
      [0, 360],
    ]);
  });

  it("treats a zero-length slot as wrapping the whole day", () => {
    expect(slotRanges({ start: "08:00", end: "08:00", tariff: "hc" })).toEqual([
      [480, 1440],
      [0, 480],
    ]);
  });
});

describe("isWithinSlot", () => {
  const night = { start: "22:00", end: "06:00", tariff: "hc" } as const;

  it("includes the start and excludes the end", () => {
    expect(isWithinSlot(1320, night)).toBe(true); // 22:00
    expect(isWithinSlot(360, night)).toBe(false); // 06:00
  });

  it("covers both sides of the midnight wrap", () => {
    expect(isWithinSlot(1400, night)).toBe(true); // 23:20
    expect(isWithinSlot(60, night)).toBe(true); // 01:00
    expect(isWithinSlot(720, night)).toBe(false); // 12:00
  });
});

describe("TariffClassifier.classify", () => {
  const nightAndDay: TariffConfig = {
    schedules: [
      {
        days: ALL_DAYS,
        slots: [
          { start: "22:00", end: "06:00", tariff: "hc" },
          { start: "06:00", end: "22:00", tariff: "hp" },
        ],
      },
    ],
    prices: { hp: 0.2516, hc: 0.2068 },
  };

  it("bills everything as HP when no tariff is configured", () => {
    const c = makeClassifier(null);
    expect(c.classify(1000, epochAt(`${MONDAY}T03:00:00`))).toEqual({ hp: 1000, hc: 0 });
  });

  it("bills everything as HP when the settings value is unparseable", () => {
    const c = makeClassifier("{ not json");
    expect(c.classify(1000, epochAt(`${MONDAY}T03:00:00`))).toEqual({ hp: 1000, hc: 0 });
  });

  it("attributes a window fully inside the off-peak wrap to HC", () => {
    const c = makeClassifier(nightAndDay);
    expect(c.classify(1000, epochAt(`${MONDAY}T03:00:00`))).toEqual({ hp: 0, hc: 1000 });
    expect(c.classify(1000, epochAt(`${MONDAY}T23:00:00`))).toEqual({ hp: 0, hc: 1000 });
  });

  it("attributes a daytime window fully to HP", () => {
    const c = makeClassifier(nightAndDay);
    expect(c.classify(1000, epochAt(`${MONDAY}T14:00:00`))).toEqual({ hp: 1000, hc: 0 });
  });

  it("prorates a window straddling a tariff transition", () => {
    const c = makeClassifier(nightAndDay);
    // 05:45 → 06:15: 15 min HC then 15 min HP.
    expect(c.classify(1000, epochAt(`${MONDAY}T05:45:00`))).toEqual({ hp: 500, hc: 500 });
    // 21:50 → 22:20: 10 min HP then 20 min HC.
    expect(c.classify(600, epochAt(`${MONDAY}T21:50:00`))).toEqual({ hp: 200, hc: 400 });
  });

  it("honours the window duration instead of assuming 30 minutes", () => {
    const c = makeClassifier(nightAndDay);
    // A per-minute bucket at 05:45 is entirely off-peak: only the minute that
    // actually straddles 06:00 may be prorated.
    expect(c.classify(1000, epochAt(`${MONDAY}T05:45:00`), 60)).toEqual({ hp: 0, hc: 1000 });
    expect(c.classify(1000, epochAt(`${MONDAY}T05:59:00`), 60)).toEqual({ hp: 0, hc: 1000 });
    expect(c.classify(1000, epochAt(`${MONDAY}T06:00:00`), 60)).toEqual({ hp: 1000, hc: 0 });
  });

  it("falls back to HP for a day with no schedule", () => {
    const c = makeClassifier({
      schedules: [{ days: [0], slots: [{ start: "22:00", end: "06:00", tariff: "hc" }] }],
      prices: { hp: 0.25, hc: 0.2 },
    });
    // Monday is not covered by the Sunday-only schedule.
    expect(c.classify(1000, epochAt(`${MONDAY}T03:00:00`))).toEqual({ hp: 1000, hc: 0 });
  });

  it("falls back to HP when the day's slots cover none of the window", () => {
    const c = makeClassifier({
      schedules: [{ days: ALL_DAYS, slots: [{ start: "01:00", end: "02:00", tariff: "hc" }] }],
      prices: { hp: 0.25, hc: 0.2 },
    });
    expect(c.classify(800, epochAt(`${MONDAY}T14:00:00`))).toEqual({ hp: 800, hc: 0 });
  });
});

// Spec 204 — seasonal off-peak hours.
describe("seasonal schedules", () => {
  // Winter: HP 06–22, HC at night. Summer: HC 12–15 added in the afternoon.
  const seasonal: TariffConfig = {
    schedules: [
      {
        days: ALL_DAYS,
        slots: [
          { start: "22:00", end: "06:00", tariff: "hc" },
          { start: "06:00", end: "22:00", tariff: "hp" },
        ],
      },
    ],
    summer: {
      ...SUMMER_DEFAULT,
      schedules: [
        {
          days: ALL_DAYS,
          slots: [
            { start: "02:00", end: "06:00", tariff: "hc" },
            { start: "06:00", end: "12:00", tariff: "hp" },
            { start: "12:00", end: "15:00", tariff: "hc" },
            { start: "15:00", end: "02:00", tariff: "hp" },
          ],
        },
      ],
    },
    prices: { hp: 0.2516, hc: 0.2068 },
  };
  const c = makeClassifier(seasonal);

  it("splits a 15 July window with the summer slots", () => {
    expect(c.classify(1000, epochAt("2026-07-15T13:00:00"))).toEqual({ hp: 0, hc: 1000 });
  });

  it("splits a 15 January window with the winter slots", () => {
    expect(c.classify(1000, epochAt("2026-01-15T13:00:00"))).toEqual({ hp: 1000, hc: 0 });
  });

  it("puts 31 March in winter and 1 April in summer", () => {
    expect(c.classify(1000, epochAt("2027-03-31T13:00:00"))).toEqual({ hp: 1000, hc: 0 });
    expect(c.classify(1000, epochAt("2027-04-01T13:00:00"))).toEqual({ hp: 0, hc: 1000 });
  });

  it("puts 31 October in summer and 1 November in winter", () => {
    expect(c.classify(1000, epochAt("2026-10-31T13:00:00"))).toEqual({ hp: 0, hc: 1000 });
    expect(c.classify(1000, epochAt("2026-11-01T13:00:00"))).toEqual({ hp: 1000, hc: 0 });
  });

  it("uses the summer schedule for the whole window starting 31 October 23:30", () => {
    // Summer at 23:30 is HP (15:00–02:00); winter would be HC (22:00–06:00).
    expect(c.classify(1000, epochAt("2026-10-31T23:30:00"))).toEqual({ hp: 1000, hc: 0 });
  });

  it("books everything to peak on a summer day without a schedule", () => {
    const weekdaysOnly = makeClassifier({
      ...seasonal,
      summer: {
        ...SUMMER_DEFAULT,
        schedules: [
          { days: [1, 2, 3, 4, 5], slots: [{ start: "00:00", end: "00:00", tariff: "hc" }] },
        ],
      },
    });
    // 2026-07-18 is a Saturday.
    expect(weekdaysOnly.classify(1000, epochAt("2026-07-18T13:00:00"))).toEqual({
      hp: 1000,
      hc: 0,
    });
  });

  it("follows a config changed from single to seasonal", () => {
    const single: TariffConfig = { schedules: seasonal.schedules, prices: seasonal.prices };
    let raw = JSON.stringify(single);
    const settings = { get: () => raw } as unknown as SettingsManager;
    const classifier = new TariffClassifier(settings, logger);
    const july = epochAt("2026-07-15T13:00:00");
    expect(classifier.classify(1000, july)).toEqual({ hp: 1000, hc: 0 });
    raw = JSON.stringify(seasonal);
    expect(classifier.classify(1000, july)).toEqual({ hp: 0, hc: 1000 });
  });

  it("reads the whole-year schedule when there is no summer", () => {
    const single: TariffConfig = { schedules: seasonal.schedules, prices: seasonal.prices };
    expect(schedulesOn(single, new Date("2026-07-15T13:00:00"))).toBe(single.schedules);
    expect(schedulesOn(seasonal, new Date("2026-07-15T13:00:00"))).toBe(seasonal.summer!.schedules);
    expect(schedulesOn(seasonal, new Date("2026-12-15T13:00:00"))).toBe(seasonal.schedules);
  });
});

describe("isSummer", () => {
  const custom = { from: "05-15", to: "09-15" };

  it("is inclusive at both ends of a custom season", () => {
    expect(isSummer(custom, new Date("2026-05-14T12:00:00"))).toBe(false);
    expect(isSummer(custom, new Date("2026-05-15T00:00:00"))).toBe(true);
    expect(isSummer(custom, new Date("2026-09-15T23:59:00"))).toBe(true);
    expect(isSummer(custom, new Date("2026-09-16T00:00:00"))).toBe(false);
  });

  it("reads the local day", () => {
    expect(isSummer(SUMMER_DEFAULT, new Date(2026, 9, 31, 23, 59))).toBe(true);
    expect(isSummer(SUMMER_DEFAULT, new Date(2026, 10, 1, 0, 0))).toBe(false);
  });
});
