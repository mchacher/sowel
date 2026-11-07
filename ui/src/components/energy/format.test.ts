import { describe, expect, it } from "vitest";
import { formatEnergyOrCost, formatEur, formatKwhTick, formatKwhTooltip, formatWh } from "./format";

// Spec 196 — the energy screens' helpers sit on lib/format: one rule for kWh
// (three significant digits) instead of five local copies.
const N = "\u202F";

describe("energy/format", () => {
  it("formats a Wh total as kWh with three significant digits", () => {
    expect(formatWh(13_604, "fr-FR")).toBe(`13,6${N}kWh`);
    expect(formatWh(3_224, "fr-FR")).toBe(`3,22${N}kWh`);
    expect(formatWh(4_523_400, "fr-FR")).toBe(`4${N}523${N}kWh`);
    expect(formatWh(13_604, "en-US")).toBe("13.6\u00A0kWh");
  });

  it("drops the zero on axis ticks and leaves the origin bare", () => {
    expect(formatKwhTick(0, "fr-FR")).toBe("0");
    expect(formatKwhTick(4, "fr-FR")).toBe(`4${N}kWh`);
    expect(formatKwhTick(0.5, "fr-FR")).toBe(`0,5${N}kWh`);
  });

  it("shows Wh below a kilowatt-hour in tooltips", () => {
    expect(formatKwhTooltip(0.674, "fr-FR")).toBe(`674${N}Wh`);
    expect(formatKwhTooltip(0, "fr-FR")).toBe(`0${N}Wh`);
    expect(formatKwhTooltip(7.093, "fr-FR")).toBe(`7,09${N}kWh`);
  });

  it("keeps euros at two decimals and reads a missing cost as zero", () => {
    expect(formatEur(2.7, "fr-FR")).toBe(`2,70${N}€`);
    expect(formatEur(NaN, "fr-FR")).toBe(`0,00${N}€`);
    expect(formatEnergyOrCost(14_270, 2.72, "eur", "en-US")).toBe("€2.72");
    expect(formatEnergyOrCost(14_270, 2.72, "wh", "en-US")).toBe("14.3\u00A0kWh");
  });
});
