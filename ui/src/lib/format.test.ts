import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import {
  displayedWatts,
  formatBytes,
  formatCurrency,
  formatDataValue,
  formatDay,
  formatClockTime,
  formatRelativeTime,
  formatDuration,
  formatEnergy,
  formatEnergyParts,
  formatNumber,
  formatPercent,
  formatPower,
  formatPowerParts,
  formatRange,
  formatTemperature,
  formatWithUnit,
  roundTo,
} from "./format";

// Spec 196, FR-3. The expectations spell the spaces out: « ␣ » is U+202F (thin
// no-break space), « · » is U+00A0 (no-break space), « − » is U+2212.
const fr = { locale: "fr-FR" };
const en = { locale: "en-US" };
const show = (s: string) => s.replace(/\u202F/g, "␣").replace(/\u00A0/g, "·");

type Row = [label: string, actual: () => string, expected: string];

function table(rows: Row[]) {
  it.each(rows)("%s", (_label, actual, expected) => {
    expect(show(actual())).toBe(expected);
  });
}

describe("formatNumber", () => {
  table([
    ["fr thousands and decimal", () => formatNumber(1234.5, fr), "1␣234,5"],
    ["en thousands and decimal", () => formatNumber(1234.5, en), "1,234.5"],
    ["fr groups from four digits", () => formatNumber(1022, fr), "1␣022"],
    ["fr negative uses U+2212", () => formatNumber(-0.2, fr), "−0,2"],
    ["en negative keeps the hyphen", () => formatNumber(-0.2, en), "-0.2"],
    ["fr −0 reads 0", () => formatNumber(-0, fr), "0"],
    ["fr a value rounding to zero has no sign", () => formatNumber(-0.004, fr), "0"],
    ["trailing zeros dropped", () => formatNumber(4, fr), "4"],
    ["fixed decimals kept", () => formatNumber(4, { ...fr, decimals: 1 }), "4,0"],
    ["signed positive", () => formatNumber(4.3, { ...fr, signed: true }), "+4,3"],
    ["signed zero has no sign", () => formatNumber(0, { ...fr, signed: true }), "0"],
    ["null", () => formatNumber(null, fr), "—"],
    ["undefined", () => formatNumber(undefined, fr), "—"],
    ["NaN", () => formatNumber(NaN, fr), "—"],
    ["Infinity", () => formatNumber(Infinity, fr), "—"],
  ]);

  it("rounds half away from zero on the decimal digits, like Intl", () => {
    // toFixed(1) gives "1.1" here: the double nearest 1.15 sits below the half.
    expect(roundTo(1.15, 1)).toBe(1.2);
    expect(roundTo(-1.15, 1)).toBe(-1.2);
    expect(Object.is(roundTo(-0.04, 1), 0)).toBe(true);
  });

  it("puts no U+202F anywhere in English", () => {
    const out = [
      formatNumber(1234567.8, en),
      formatPower(3650, en),
      formatEnergy(14.27, en),
      formatPercent(39, en),
      formatTemperature(20.5, en),
      formatDuration(3900, en),
      formatWithUnit(1021.7, "mbar", en),
    ].join(" ");
    expect(out).not.toMatch(/\u202F/);
    expect(out).not.toMatch(/\d,\d{1,2}(?!\d)/); // no decimal comma
  });
});

describe("formatPower — whole W below 1 000 W, then kW with one decimal", () => {
  table([
    ["407 W", () => formatPower(407, fr), "407␣W"],
    ["999.4 W stays in W", () => formatPower(999.4, fr), "999␣W"],
    ["999.6 W rounds into kW, never « 1 000 W »", () => formatPower(999.6, fr), "1␣kW"],
    ["1000 W", () => formatPower(1000, fr), "1␣kW"],
    ["3650 W", () => formatPower(3650, fr), "3,7␣kW"],
    ["en 3650 W", () => formatPower(3650, en), "3.7·kW"],
    ["negative", () => formatPower(-200, { ...fr, unit: "kW" }), "−0,2␣kW"],
    ["signed axis", () => formatPower(4300, { ...fr, unit: "kW", signed: true }), "+4,3␣kW"],
    ["forced W keeps thousands", () => formatPower(1850, { ...fr, unit: "W" }), "1␣850␣W"],
    ["en forced W", () => formatPower(1850, { ...en, unit: "W" }), "1,850·W"],
    ["step 5", () => formatPower(268, { ...fr, step: 5 }), "270␣W"],
    ["step 5 at the boundary", () => formatPower(998, { ...fr, step: 5 }), "1␣kW"],
    ["null", () => formatPower(null, fr), "—"],
  ]);

  it("returns value and unit apart", () => {
    expect(formatPowerParts(1234, fr)).toEqual({ value: "1,2", unit: "kW" });
    expect(formatPowerParts(null, fr)).toEqual({ value: "—", unit: "W" });
  });

  it("displayedWatts is what the label says, in watts", () => {
    expect(displayedWatts(33.5, { step: 5 })).toBe(35);
    expect(displayedWatts(1150, { step: 5 })).toBe(1200); // label « 1,2 kW »
    expect(formatPower(1150, { ...fr, step: 5 })).toBe("1,2\u202FkW");
    expect(displayedWatts(1632.9, { step: 5 })).toBe(1600);
  });
});

describe("formatEnergy — three significant digits, at most two decimals", () => {
  table([
    ["0.704 kWh", () => formatEnergy(0.704, fr), "0,7␣kWh"],
    ["7.09 kWh", () => formatEnergy(7.09, fr), "7,09␣kWh"],
    ["14.27 kWh", () => formatEnergy(14.27, fr), "14,3␣kWh"],
    ["983.66 kWh", () => formatEnergy(983.66, fr), "984␣kWh"],
    ["4 523 kWh", () => formatEnergy(4523.4, fr), "4␣523␣kWh"],
    ["4.0 kWh drops the zero", () => formatEnergy(4, fr), "4␣kWh"],
    ["boundary 9.994", () => formatEnergy(9.994, fr), "9,99␣kWh"],
    ["boundary 9.995", () => formatEnergy(9.995, fr), "10␣kWh"],
    ["boundary 99.94", () => formatEnergy(99.94, fr), "99,9␣kWh"],
    ["boundary 99.95", () => formatEnergy(99.95, fr), "100␣kWh"],
    ["en", () => formatEnergy(14.27, en), "14.3·kWh"],
    ["auto: Wh below 1 kWh", () => formatEnergy(0.674, { ...fr, unit: "auto" }), "674␣Wh"],
    ["auto: 999.6 Wh becomes kWh", () => formatEnergy(0.9996, { ...fr, unit: "auto" }), "1␣kWh"],
    ["auto: 0 Wh", () => formatEnergy(0, { ...fr, unit: "auto" }), "0␣Wh"],
    ["null", () => formatEnergy(null, fr), "—"],
  ]);

  it("returns value and unit apart", () => {
    expect(formatEnergyParts(14.27, fr)).toEqual({ value: "14,3", unit: "kWh" });
  });
});

describe("formatTemperature — one fixed decimal", () => {
  table([
    ["20 compact", () => formatTemperature(20, { ...fr, style: "compact" }), "20,0°"],
    ["20.5 compact", () => formatTemperature(20.5, { ...fr, style: "compact" }), "20,5°"],
    ["20.5 full", () => formatTemperature(20.5, { ...fr, style: "full" }), "20,5␣°C"],
    ["full by default", () => formatTemperature(8.6, fr), "8,6␣°C"],
    ["below zero", () => formatTemperature(-3.2, { ...fr, style: "compact" }), "−3,2°"],
    ["en full", () => formatTemperature(20.5, en), "20.5·°C"],
    ["null", () => formatTemperature(null, fr), "—"],
  ]);
});

describe("formatPercent", () => {
  table([
    ["fr 39", () => formatPercent(39, fr), "39␣%"],
    ["en 39", () => formatPercent(39, en), "39%"],
    ["rounds to whole", () => formatPercent(45.5, fr), "46␣%"],
    ["signed negative", () => formatPercent(-68, { ...fr, signed: true }), "−68␣%"],
    ["signed positive", () => formatPercent(12, { ...fr, signed: true }), "+12␣%"],
    ["one decimal", () => formatPercent(5.64, { ...fr, decimals: 1 }), "5,6␣%"],
    ["null", () => formatPercent(null, fr), "—"],
  ]);
});

describe("formatCurrency", () => {
  table([
    ["fr", () => formatCurrency(2.72, fr), "2,72␣€"],
    ["fr thousands", () => formatCurrency(1234.5, fr), "1␣234,50␣€"],
    ["fr negative", () => formatCurrency(-1.5, fr), "−1,50␣€"],
    ["en", () => formatCurrency(2.72, en), "€2.72"],
    ["null", () => formatCurrency(null, fr), "—"],
  ]);
});

describe("formatWithUnit — the rule follows the unit", () => {
  table([
    ["V mains, whole", () => formatWithUnit(225.4, "V", fr), "225␣V"],
    ["V below 100, one decimal", () => formatWithUnit(12.64, "V", fr), "12,6␣V"],
    ["V below 100 drops the zero", () => formatWithUnit(24.0, "V", fr), "24␣V"],
    ["V 99.96 rounds to 100", () => formatWithUnit(99.96, "V", fr), "100␣V"],
    ["A drops the zero", () => formatWithUnit(0, "A", fr), "0␣A"],
    ["A keeps one decimal", () => formatWithUnit(12.5, "A", fr), "12,5␣A"],
    ["A above 1, one decimal", () => formatWithUnit(6.54, "A", fr), "6,5␣A"],
    ["A below 1, two decimals", () => formatWithUnit(0.074, "A", fr), "0,07␣A"],
    ["A below 1 drops zeros", () => formatWithUnit(0.5, "A", fr), "0,5␣A"],
    ["A null", () => formatWithUnit(null, "A", fr), "—"],
    ["m/s one decimal", () => formatWithUnit(3.46, "m/s", fr), "3,5␣m/s"],
    ["m/s drops the zero", () => formatWithUnit(4, "m/s", fr), "4␣m/s"],
    ["mbar", () => formatWithUnit(1021.7, "mbar", fr), "1␣022␣mbar"],
    ["hPa", () => formatWithUnit(1013.2, "hPa", fr), "1␣013␣hPa"],
    ["mm", () => formatWithUnit(0.4, "mm", fr), "0,4␣mm"],
    ["mm zero", () => formatWithUnit(0, "mm", fr), "0␣mm"],
    ["km/h", () => formatWithUnit(16.3, "km/h", fr), "16␣km/h"],
    ["dB", () => formatWithUnit(43.2, "dB", fr), "43␣dB"],
    ["lx", () => formatWithUnit(1288, "lx", fr), "1␣288␣lx"],
    ["ppm", () => formatWithUnit(612.4, "ppm", fr), "612␣ppm"],
    ["km", () => formatWithUnit(23582.4, "km", fr), "23␣582␣km"],
    ["°C full by default", () => formatWithUnit(22.3, "°C", fr), "22,3␣°C"],
    ["°C compact", () => formatWithUnit(22.3, "°C", { ...fr, style: "compact" }), "22,3°"],
    ["%", () => formatWithUnit(85, "%", fr), "85␣%"],
    ["W", () => formatWithUnit(639, "W", fr), "639␣W"],
    ["kW below 1 kW reads in W", () => formatWithUnit(0.35, "kW", fr), "350␣W"],
    ["kW", () => formatWithUnit(3.65, "kW", fr), "3,7␣kW"],
    ["Wh", () => formatWithUnit(674, "Wh", fr), "674␣Wh"],
    ["Wh above 1 kWh", () => formatWithUnit(14250, "Wh", fr), "14,3␣kWh"],
    ["kWh", () => formatWithUnit(983.66, "kWh", fr), "984␣kWh"],
    ["€", () => formatWithUnit(2.72, "€", fr), "2,72␣€"],
    ["unknown unit kept verbatim", () => formatWithUnit(3.24, "xyz", fr), "3,2␣xyz"],
    ["unknown unit in English", () => formatWithUnit(3.24, "Xyz/s", en), "3.2·Xyz/s"],
    ["no unit", () => formatWithUnit(3.24, undefined, fr), "3,2"],
    ["null with a unit", () => formatWithUnit(null, "lx", fr), "—"],
  ]);
});

describe("formatDuration", () => {
  table([
    ["0 s", () => formatDuration(0, fr), "0␣s"],
    ["59 s", () => formatDuration(59, fr), "59␣s"],
    ["60 s", () => formatDuration(60, fr), "1␣min"],
    ["132 s", () => formatDuration(132, fr), "2␣min␣12␣s"],
    ["599 s keeps its seconds", () => formatDuration(599, fr), "9␣min␣59␣s"],
    ["600 s", () => formatDuration(600, fr), "10␣min"],
    ["2 104 s drops the seconds above ten minutes", () => formatDuration(2104, fr), "35␣min"],
    ["3 599 s", () => formatDuration(3599, fr), "59␣min"],
    ["3 600 s", () => formatDuration(3600, fr), "1␣h"],
    ["3 900 s", () => formatDuration(3900, fr), "1␣h␣05"],
    ["15 h 19", () => formatDuration(15 * 3600 + 19 * 60 + 40, fr), "15␣h␣19"],
    ["86 400 s", () => formatDuration(86400, fr), "1␣j"],
    ["3 j 4 h", () => formatDuration(3 * 86400 + 4 * 3600, fr), "3␣j␣4␣h"],
    ["en days", () => formatDuration(86400, en), "1·d"],
    ["en 132 s", () => formatDuration(132, en), "2·min·12·s"],
    ["clock m:ss", () => formatDuration(754, { ...fr, style: "clock" }), "12:34"],
    ["clock h:mm:ss", () => formatDuration(3723, { ...fr, style: "clock" }), "1:02:03"],
    ["null", () => formatDuration(null, fr), "—"],
  ]);
});

describe("formatRange", () => {
  table([
    ["fr", () => formatRange("07:22", "17:17", fr), "07:22␣–␣17:17"],
    ["en", () => formatRange("07:22", "17:17", en), "07:22 – 17:17"],
  ]);
});

describe("formatWithUnit — a duration in seconds (spec 196, slice 3b)", () => {
  table([
    ["6 353 s reads as a duration", () => formatWithUnit(6353, "s", fr), "1␣h␣45"],
    ["45 s", () => formatWithUnit(45, "s", fr), "45␣s"],
  ]);
});

describe("formatCurrency — fixed decimals", () => {
  table([
    [
      "price per kWh, three decimals",
      () => formatCurrency(0.2068, { ...fr, decimals: 3 }),
      "0,207␣€",
    ],
    ["default two decimals", () => formatCurrency(2.718, fr), "2,72␣€"],
  ]);
});

describe("formatBytes — French units", () => {
  table([
    ["bytes", () => formatBytes(512, fr), "512␣o"],
    ["5,9 Mo", () => formatBytes(5.9 * 1024 * 1024, fr), "5,9␣Mo"],
    ["en MB", () => formatBytes(5.9 * 1024 * 1024, en), "5.9·MB"],
    ["1 023,96 ko reads 1 Mo", () => formatBytes(1024 * 1024 - 40, fr), "1␣Mo"],
    ["null", () => formatBytes(null, fr), "—"],
  ]);
});

describe("formatDataValue — numbers by their unit's rule", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("formats a weather station's readings the French way", async () => {
    await i18n.changeLanguage("fr");
    expect(show(formatDataValue(1020.7, "mbar"))).toBe("1␣021␣mbar");
    expect(show(formatDataValue(0, "mm"))).toBe("0␣mm");
    expect(show(formatDataValue(0.8, "kWh"))).toBe("0,8␣kWh");
    expect(show(formatDataValue(6353, "s"))).toBe("1␣h␣45");
  });

  it("is a dash when missing", () => {
    expect(formatDataValue(null)).toBe("—");
  });
});

describe("formatRelativeTime — Sowel's language", () => {
  const NOW = Date.parse("2026-11-07T12:00:00Z");
  const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

  afterEach(async () => {
    vi.useRealTimers();
    await i18n.changeLanguage("en");
  });

  it("reads French in French", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await i18n.changeLanguage("fr");
    expect(show(formatRelativeTime(ago(2)))).toBe("à l'instant");
    expect(show(formatRelativeTime(ago(17)))).toBe("il y a 15␣s");
    expect(show(formatRelativeTime(ago(12 * 60 + 30)))).toBe("il y a 12␣min");
    expect(show(formatRelativeTime(ago(3 * 3600 + 5 * 60)))).toBe("il y a 3␣h␣05");
  });

  it("reads English in English", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await i18n.changeLanguage("en");
    expect(show(formatRelativeTime(ago(2)))).toBe("just now");
    expect(show(formatRelativeTime(ago(12 * 60)))).toBe("12·min ago");
  });

  it("is a dash without a timestamp", () => {
    expect(formatRelativeTime(null)).toBe("—");
  });
});

// #1151 — the Activity panel read « since 12:30 AM » over rows at « 00:30 ».
describe("formatClockTime — one 24-hour clock in every language", () => {
  const halfPastMidnight = new Date(2026, 10, 7, 0, 30);
  const afternoon = new Date(2026, 10, 7, 14, 5);

  it("reads 00:30 and 14:05 in English and French alike", () => {
    for (const locale of ["en-US", "en-GB", "fr-FR"]) {
      expect(formatClockTime(halfPastMidnight, { locale })).toBe("00:30");
      expect(formatClockTime(afternoon.getTime(), { locale })).toBe("14:05");
    }
  });

  it("follows Sowel's language by default", async () => {
    await i18n.changeLanguage("en");
    expect(formatClockTime(halfPastMidnight)).toBe("00:30");
  });
});

// Spec 202 — the price history lists local days.
describe("formatDay — a local day as a short numeric date", () => {
  it("reads day first in French and month first in English", () => {
    expect(formatDay("2026-08-01", fr)).toBe("01/08/2026");
    expect(formatDay("2026-08-01", en)).toBe("08/01/2026");
  });

  it("reads a missing or broken day as a dash", () => {
    expect(formatDay(null)).toBe("—");
    expect(formatDay("not-a-date")).toBe("—");
  });
});
