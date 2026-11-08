import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import fr from "../i18n/locales/fr.json";
import type { ActivityItem } from "../types";
import {
  dayPart,
  displayValue,
  groupActivityLog,
  logPeriodLabel,
  logSpanLabel,
} from "./activity-log";

// Spec 196, slice 7c — the activity panel is one log, newest first, with a
// separator label where it crosses into another part of the day.

/** Local time, so the parts of the day do not depend on the test's TZ. */
const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

function item(id: string, timestamp: number): ActivityItem {
  return {
    id,
    timestamp,
    category: "sunlight",
    zoneId: null,
    message: { template: "sunlight.sunset", params: {} },
  };
}

function translator(dict: Record<string, string>) {
  return (key: string, opts?: Record<string, unknown>) =>
    (dict[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k] ?? ""));
}

// Saturday 7 November 2026, 17:50.
const NOW = new Date(2026, 10, 7, 17, 50);

describe("dayPart", () => {
  it("cuts the day at 6, 12 and 18 h", () => {
    expect([0, 5, 6, 11, 12, 17, 18, 23].map(dayPart)).toEqual([
      "night",
      "night",
      "morning",
      "morning",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
    ]);
  });
});

describe("groupActivityLog", () => {
  it("lists newest first even when the items come unordered", () => {
    const groups = groupActivityLog(
      [
        item("a", at(2026, 11, 7, 14, 10)),
        item("b", at(2026, 11, 7, 17, 42)),
        item("c", at(2026, 11, 7, 7, 54)),
      ],
      NOW,
    );
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(["b", "a", "c"]);
  });

  it("puts no label above the current part of today, one above each other part", () => {
    const groups = groupActivityLog(
      [
        item("1742", at(2026, 11, 7, 17, 42)),
        item("1410", at(2026, 11, 7, 14, 10)),
        item("0754", at(2026, 11, 7, 7, 54)),
        item("0658", at(2026, 11, 7, 6, 58)),
        item("0310", at(2026, 11, 7, 3, 10)),
        item("y2130", at(2026, 11, 6, 21, 30)),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.key, g.labelled, g.items.length])).toEqual([
      ["0-afternoon", false, 2],
      ["0-morning", true, 2],
      ["0-night", true, 1],
      ["1-evening", true, 1],
    ]);
  });

  it("labels the first group when nothing happened yet in the current part", () => {
    const groups = groupActivityLog([item("x", at(2026, 11, 7, 9, 0))], NOW);
    expect(groups[0].labelled).toBe(true);
  });

  it("treats an event newer than the last clock read as now", () => {
    // The clock was read at 11:59; an event at 12:00 starts the afternoon.
    const groups = groupActivityLog(
      [item("noon", at(2026, 11, 7, 12, 0)), item("am", at(2026, 11, 7, 11, 30))],
      new Date(2026, 10, 7, 11, 59),
    );
    expect(groups.map((g) => [g.key, g.labelled])).toEqual([
      ["0-afternoon", false],
      ["0-morning", true],
    ]);
  });

  it("is empty for no items", () => {
    expect(groupActivityLog([], NOW)).toEqual([]);
  });
});

describe("logPeriodLabel", () => {
  const groups = groupActivityLog(
    [
      item("today", at(2026, 11, 7, 8, 0)),
      item("yesterday", at(2026, 11, 6, 20, 0)),
      item("monday", at(2026, 11, 2, 15, 0)),
      item("old", at(2026, 10, 30, 3, 0)),
    ],
    NOW,
  );
  const periods = groups.map((g) => g.period);

  it("names the parts of the day in French", () => {
    const t = translator(fr as Record<string, string>);
    expect(periods.map((p) => logPeriodLabel(p, t, "fr-FR"))).toEqual([
      "Ce matin",
      "Hier soir",
      "Lundi après-midi",
      "30 octobre, dans la nuit",
    ]);
  });

  it("names them in English", () => {
    const t = translator(en as Record<string, string>);
    expect(periods.map((p) => logPeriodLabel(p, t, "en-GB"))).toEqual([
      "This morning",
      "Yesterday evening",
      "Monday afternoon",
      "30 October, overnight",
    ]);
  });
});

// The subtitle says how far back the shown log reaches (it is a count of events, not a window).
describe("logSpanLabel", () => {
  const t = (k: string, o?: Record<string, unknown>) => `${k}|${JSON.stringify(o ?? {})}`;
  const at = (iso: string) => ({ timestamp: new Date(iso).getTime() }) as ActivityItem;
  const now = new Date("2026-11-07T20:00:00");

  it("is null without items", () => {
    expect(logSpanLabel([], now, t, "fr-FR")).toBeNull();
  });
  it("names the oldest shown item's time today", () => {
    expect(
      logSpanLabel([at("2026-11-07T19:30:00"), at("2026-11-07T14:05:00")], now, t, "fr-FR"),
    ).toBe('activity.since.today|{"time":"14:05"}');
  });
  it("writes the time on the rows' 24-hour clock in English too (#1151)", () => {
    expect(logSpanLabel([at("2026-11-07T00:30:00")], now, t, "en-US")).toBe(
      'activity.since.today|{"time":"00:30"}',
    );
  });
  it("says yesterday, then a weekday, then a date", () => {
    expect(logSpanLabel([at("2026-11-06T18:12:00")], now, t, "fr-FR")).toBe(
      'activity.since.yesterday|{"time":"18:12"}',
    );
    expect(logSpanLabel([at("2026-11-02T07:30:00")], now, t, "fr-FR")).toBe(
      'activity.since.weekday|{"day":"lundi","time":"07:30"}',
    );
    expect(logSpanLabel([at("2026-10-28T07:30:00")], now, t, "fr-FR")).toBe(
      'activity.since.date|{"date":"28 octobre"}',
    );
  });
});

describe("displayValue", () => {
  const t = translator(fr as Record<string, string>);

  it("writes a VMC speed as the equipment card does (#1122)", () => {
    expect(displayValue("v1", "speed", t)).toBe("V1");
    expect(displayValue("v2", "speed", t)).toBe("V2");
    expect(displayValue("off", "speed", t)).toBe(fr["controls.off"]);
  });
});
