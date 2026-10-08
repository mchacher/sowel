import { describe, it, expect } from "vitest";
import {
  dayKey,
  isRainOnlyWeather,
  rainHistoryFrom,
  readRainLive,
  summarizeRainHistory,
  RAIN_LOOKBACK_DAYS,
} from "./rain-summary";
import type { ComputedDataEntry, DataBindingWithValue, EquipmentWithDetails, HistoryPoint } from "../../types";

// Spec 186 — the rain-only weather tile and its detail sheet.

// Thursday 8 October 2026, 09:30 local time (whatever the runner's zone is).
const NOW = new Date(2026, 9, 8, 9, 30);

function binding(key: string, category: string, value: unknown, alias = key): DataBindingWithValue {
  return {
    id: `b-${key}`,
    equipmentId: "e1",
    deviceDataId: `d-${key}`,
    alias,
    deviceId: "gauge",
    deviceName: "Pluviometre",
    key,
    type: "number",
    category,
    value,
    lastUpdated: "2026-10-08T07:41:34Z",
    lastChanged: "2026-10-08T07:41:34Z",
    stale: false,
  } as DataBindingWithValue;
}

function equipment(
  bindings: DataBindingWithValue[],
  computedData: ComputedDataEntry[] = [],
  type = "weather",
): EquipmentWithDetails {
  return { id: "e1", type, dataBindings: bindings, computedData } as unknown as EquipmentWithDetails;
}

const computed = (alias: string, value: number): ComputedDataEntry => ({
  alias,
  value,
  unit: "mm",
  category: "rain",
  lastUpdated: "2026-10-08T07:41:39Z",
});

/** Daily point stamped at LOCAL midnight `daysAgo` days before NOW (post-#1024 buckets). */
function localDay(daysAgo: number, value: number): HistoryPoint {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo);
  return { time: d.toISOString(), value };
}

/** Daily point stamped at UTC midnight of the same calendar day (pre-#1024 buckets). */
function utcDay(daysAgo: number, value: number): HistoryPoint {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { time: `${key}T00:00:00Z`, value };
}

/** A gauge running for `days` days: 0 every day, then the given rainy days. */
function dryRun(days: number, rainy: Record<number, number> = {}): HistoryPoint[] {
  return Array.from({ length: days }, (_, i) => utcDay(i, rainy[i] ?? 0));
}

describe("isRainOnlyWeather", () => {
  it("is false for a station with temperature and rain", () => {
    expect(
      isRainOnlyWeather(equipment([binding("temperature", "temperature_outdoor", 12), binding("rain", "rain", 0)])),
    ).toBe(false);
  });

  it("is true for rain bindings only", () => {
    expect(
      isRainOnlyWeather(equipment([binding("rain", "rain", 0), binding("battery", "battery", 100)])),
    ).toBe(true);
  });

  it("is true with computed rain_24h only", () => {
    expect(isRainOnlyWeather(equipment([binding("battery", "battery", 90)], [computed("rain_24h", 1)]))).toBe(true);
  });

  it("is false for a non-weather equipment", () => {
    expect(isRainOnlyWeather(equipment([binding("rain", "rain", 0)], [], "sensor"))).toBe(false);
  });
});

describe("readRainLive", () => {
  it("prefers the sum_rain_24 binding over computed rain_24h", () => {
    const live = readRainLive(
      equipment([binding("sum_rain_24", "rain", 7.37), binding("rain_today", "rain", 5.26)], [computed("rain_24h", 7.4)]),
    );
    expect(live.last24h).toBe(7.37);
    expect(live.today).toBe(5.26);
  });

  it("falls back to computed values when the cumulative bindings are absent", () => {
    const live = readRainLive(equipment([binding("rain", "rain", 0)], [computed("rain_24h", 3.1), computed("rain_1h", 0.5)]));
    expect(live.last24h).toBe(3.1);
    expect(live.lastHour).toBe(0.5);
    expect(live.today).toBeNull();
  });

  it("exposes the alias of the per-hour rain series, null when unbound", () => {
    expect(readRainLive(equipment([binding("rain", "rain", 0, "rain_2")])).historyAlias).toBe("rain_2");
    expect(readRainLive(equipment([binding("sum_rain_24", "rain", 1)])).historyAlias).toBeNull();
  });
});

describe("dayKey", () => {
  it("reads a UTC-midnight stamp as its UTC date", () => {
    expect(dayKey("2026-10-07T00:00:00Z")).toBe("2026-10-07");
  });

  it("reads any other stamp as its local date", () => {
    const localMidnight = new Date(2026, 9, 7).toISOString();
    expect(dayKey(localMidnight)).toBe("2026-10-07");
  });
});

describe("rainHistoryFrom", () => {
  it("starts at local midnight, 182 days before today", () => {
    const from = rainHistoryFrom(NOW);
    expect(from.getHours()).toBe(0);
    expect(Math.round((new Date(2026, 9, 8).getTime() - from.getTime()) / 86_400_000)).toBe(RAIN_LOOKBACK_DAYS - 1);
  });
});

describe("summarizeRainHistory", () => {
  it("sums the last 7 and 30 days over a full window", () => {
    const s = summarizeRainHistory(dryRun(60, { 0: 5, 3: 2, 6: 1, 7: 10, 29: 4, 30: 100 }), NOW);
    expect(s.sum7).toBe(8);
    expect(s.sum30).toBe(22);
    expect(s.measured7).toBe(7);
    expect(s.measured30).toBe(30);
    expect(s.today).toBe(5);
    expect(s.bars).toHaveLength(30);
    expect(s.bars[29].mm).toBe(5);
  });

  it("flags a history that started two days ago", () => {
    const s = summarizeRainHistory([utcDay(1, 2.1), utcDay(0, 5.26)], NOW);
    expect(s.measured7).toBe(2);
    expect(s.measured30).toBe(2);
    expect(s.sum7).toBeCloseTo(7.36);
    expect(s.sum30).toBeCloseTo(7.36);
    expect(s.bars.slice(0, 28).every((b) => b.mm === null)).toBe(true);
  });

  it("counts a missing day after the first point as dry, not unmeasured", () => {
    const s = summarizeRainHistory([localDay(3, 1), localDay(0, 2)], NOW);
    expect(s.bars[27].mm).toBe(0);
    expect(s.bars[28].mm).toBe(0);
    expect(s.measured7).toBe(4);
  });

  it("returns today as the last rain when it rains today", () => {
    const s = summarizeRainHistory(dryRun(10, { 0: 5.26, 1: 2.1 }), NOW);
    expect(s.lastRain?.daysAgo).toBe(0);
    expect(s.lastRain?.mm).toBe(5.26);
  });

  it("finds a last rain outside the 30-day bars", () => {
    const s = summarizeRainHistory(dryRun(120, { 47: 9.5, 80: 3 }), NOW);
    expect(s.sum30).toBe(0);
    expect(s.lastRain?.daysAgo).toBe(47);
    expect(s.lastRain?.mm).toBe(9.5);
    expect(s.lastRain?.date.getDate()).toBe(new Date(2026, 9, 8 - 47).getDate());
  });

  it("returns no last rain after six dry months, over a fully covered window", () => {
    const s = summarizeRainHistory(dryRun(RAIN_LOOKBACK_DAYS), NOW);
    expect(s.lastRain).toBeNull();
    expect(s.sum30).toBe(0);
    expect(s.since).toBeNull();
    expect(s.empty).toBe(false);
  });

  it("only claims 'no rain' since the first measured day when the history is shorter", () => {
    // The hourly rain history keeps 90 days: nothing older comes back.
    const s = summarizeRainHistory(dryRun(90), NOW);
    expect(s.lastRain).toBeNull();
    expect(s.since?.getTime()).toBe(new Date(2026, 9, 8 - 89).getTime());
  });

  it("keeps whole days across a daylight-saving change", () => {
    // 15 Nov 2026: the window crosses the 25 Oct change in zones that observe it.
    const nov = new Date(2026, 10, 15, 9, 0);
    const points = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(2026, 10, 15 - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { time: `${key}T00:00:00Z`, value: i === 40 ? 6 : 0 };
    });
    const s = summarizeRainHistory(points, nov);
    expect(s.lastRain?.daysAgo).toBe(40);
    expect(s.lastRain?.date.getDate()).toBe(new Date(2026, 10, 15 - 40).getDate());
    expect(s.measured30).toBe(30);
  });

  it("returns nulls when the history is empty", () => {
    const s = summarizeRainHistory([], NOW);
    expect(s.sum7).toBeNull();
    expect(s.sum30).toBeNull();
    expect(s.measured30).toBe(0);
    expect(s.today).toBeNull();
    expect(s.lastRain).toBeNull();
    expect(s.empty).toBe(true);
    expect(s.since).toBeNull();
    expect(s.bars.every((b) => b.mm === null)).toBe(true);
  });

  it("ignores points older than the lookback window", () => {
    const s = summarizeRainHistory([utcDay(RAIN_LOOKBACK_DAYS, 12), utcDay(RAIN_LOOKBACK_DAYS + 5, 3)], NOW);
    expect(s.lastRain).toBeNull();
    expect(s.measured30).toBe(0);
  });
});
