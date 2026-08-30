import { describe, expect, it } from "vitest";
import type {
  DataBindingWithValue,
  EquipmentStatus,
  EquipmentWithDetails,
} from "../../types";
import { pickSubmeterColor, SUBMETER_PALETTE } from "./submeterPalette";
import {
  buildSubmeterRows,
  computeOther,
  displayedPower,
  readSubmeterReading,
  sharePercent,
} from "./submeter-helpers";
// Imported from shared/ rather than re-exported through the helper: one name,
// one module, so a signature change here cannot masquerade as compatible
// (#832 review).
import {
  parseReadingTime,
  SUBMETER_FRESHNESS_MS,
  SUBMETER_FRESHNESS_SLOW_MS,
} from "../../../../src/shared/reading-freshness";

/**
 * Fixed clock. Every reading's age is stated by the test rather than inherited
 * from whenever the suite happens to run, which matters now that age is what
 * decides whether a value is shown at all (#744).
 */
const NOW = Date.parse("2026-05-27T08:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function makeBinding(
  partial: Partial<DataBindingWithValue> & { alias: string },
): DataBindingWithValue {
  return {
    id: "b-" + partial.alias,
    equipmentId: "eq",
    deviceDataId: "dd",
    deviceId: "d1",
    deviceName: "Device",
    key: partial.alias,
    type: "number",
    category: "power",
    value: 0,
    lastUpdated: ago(5_000),
    lastChanged: ago(5_000),
    stale: false,
    ...partial,
  };
}

function makeEquipment(
  id: string,
  name: string,
  opts: {
    type?: EquipmentWithDetails["type"];
    status?: EquipmentStatus;
    power?: number | null;
    offlineSince?: string | null;
    /** Age of the power reading. Defaults to a few seconds, i.e. fresh. */
    readingAgeMs?: number;
    /** Force `lastUpdated` outright, including to null or to something unparseable. */
    lastUpdated?: string | null;
  } = {},
): EquipmentWithDetails {
  const bindings: DataBindingWithValue[] = [];
  if (opts.power !== undefined && opts.power !== null) {
    bindings.push(
      makeBinding({
        alias: "power",
        value: opts.power,
        lastUpdated:
          opts.lastUpdated !== undefined
            ? opts.lastUpdated
            : ago(opts.readingAgeMs ?? 5_000),
      }),
    );
  }
  return {
    id,
    name,
    zoneId: "z",
    type: opts.type ?? "energy_meter",
    enabled: true,
    createdAt: "2026-05-01 00:00:00Z",
    updatedAt: "2026-05-01 00:00:00Z",
    dataBindings: bindings,
    orderBindings: [],
    status: opts.status ?? "online",
    statusReason:
      opts.status && opts.status !== "online"
        ? {
            offlineDevices: [],
            staleBindings: [],
            offlineSince: opts.offlineSince ?? null,
          }
        : undefined,
  };
}

/** buildSubmeterRows, pinned to the fixed clock. */
const buildRows = (
  eqs: EquipmentWithDetails[],
  labels?: Map<string, string>,
): ReturnType<typeof buildSubmeterRows> => buildSubmeterRows(eqs, labels, NOW);

describe("pickSubmeterColor", () => {
  it("returns the palette color at the given index", () => {
    expect(pickSubmeterColor(0)).toBe(SUBMETER_PALETTE[0]);
    expect(pickSubmeterColor(5)).toBe(SUBMETER_PALETTE[5]);
    expect(pickSubmeterColor(7)).toBe(SUBMETER_PALETTE[7]);
  });

  it("wraps modulo the palette length", () => {
    expect(pickSubmeterColor(8)).toBe(SUBMETER_PALETTE[0]);
    expect(pickSubmeterColor(17)).toBe(SUBMETER_PALETTE[1]);
  });
});

describe("readSubmeterReading", () => {
  it("returns the power binding value for an online equipment", () => {
    const eq = makeEquipment("a", "PAC", { power: 1200 });
    expect(readSubmeterReading(eq, NOW).power).toBe(1200);
  });

  it("returns the absolute value when power is negative (clamp wired backwards)", () => {
    const eq = makeEquipment("a", "PAC", { power: -50 });
    expect(readSubmeterReading(eq, NOW).power).toBe(50);
  });

  it("returns null when no power binding exists", () => {
    const eq = makeEquipment("a", "PAC", { power: null });
    expect(readSubmeterReading(eq, NOW).power).toBeNull();
  });

  it("returns null when the equipment is offline, even with a power binding", () => {
    const eq = makeEquipment("a", "PAC", { power: 500, status: "offline" });
    expect(readSubmeterReading(eq, NOW).power).toBeNull();
  });

  it("returns the power for a degraded equipment whose reading is still fresh", () => {
    // Degraded is about the equipment as a whole; this particular reading is
    // current, so it counts.
    const eq = makeEquipment("a", "Piscine", { power: 800, status: "degraded" });
    expect(readSubmeterReading(eq, NOW).power).toBe(800);
  });
});

// ── #744 — a part must not be older than the whole it is a part of ──
//
// The card's total is rebuilt from the grid and solar meters every ~25 s while
// each part carried whatever its own plug last said. On production a water
// heater drawing 560 W was displayed as 0 W because its clamp had last reported
// sixteen minutes earlier, and the reading was folded into a live total at full
// weight. During export the total is a small difference of two large numbers,
// so a stale part can dwarf it: 275 W against a 35 W house read as 776 %.
describe("readSubmeterReading — freshness (#744)", () => {
  it("refuses a reading older than the engine's own power window, on a meter", () => {
    const eq = makeEquipment("a", "Piscine", {
      type: "energy_meter",
      power: 1233,
      readingAgeMs: SUBMETER_FRESHNESS_MS + 1_000,
    });
    const reading = readSubmeterReading(eq, NOW);
    expect(reading.power).toBeNull();
    expect(reading.unknown).toBe("stale");
    expect(reading.lastUpdated).not.toBeNull();
  });

  it("accepts a reading right at the edge of the window", () => {
    const eq = makeEquipment("a", "Piscine", {
      type: "energy_meter",
      power: 1233,
      readingAgeMs: SUBMETER_FRESHNESS_MS,
    });
    expect(readSubmeterReading(eq, NOW).power).toBe(1233);
  });

  it("gives a non-meter type the looser budget, so a 300 s poller never flickers", () => {
    // SmartThings, Legrand, Panasonic Comfort Cloud and MCZ Maestro all default
    // to a 300 s poll. The issue's own production snapshot shows two such rows
    // at an age of 270 s with nothing wrong; under the tight window they would
    // have read "outdated" for three minutes out of every five.
    const eq = makeEquipment("a", "Lave-linge", {
      type: "appliance",
      power: 0,
      readingAgeMs: 270 * 1000,
    });
    expect(readSubmeterReading(eq, NOW).unknown).toBeNull();
    expect(SUBMETER_FRESHNESS_SLOW_MS).toBeGreaterThanOrEqual(2 * 300 * 1000);
  });

  it("still refuses the reported case: a 560 W water heater 13.5 minutes behind", () => {
    // The measurement that closed the root-cause question. Whatever the budget,
    // this one has to be caught.
    const eq = makeEquipment("a", "Chauffe-eau", {
      type: "water_heater",
      power: 0,
      readingAgeMs: 944 * 1000,
    });
    expect(readSubmeterReading(eq, NOW).unknown).toBe("stale");
  });

  it("refuses a stale zero, which is the quiet case", () => {
    // A stale 0 W reads as "this appliance is off", a perfectly plausible thing
    // for a water heater to be, so nothing on screen invites doubt.
    const eq = makeEquipment("a", "Chauffe-eau", {
      power: 0,
      readingAgeMs: SUBMETER_FRESHNESS_SLOW_MS + 60_000,
    });
    expect(readSubmeterReading(eq, NOW).unknown).toBe("stale");
  });

  it("does not trust the binding's own stale flag", () => {
    // The backend applies the 2-minute power window only to metering equipment
    // types, so a thermostat or water_heater carrying a power channel reports
    // stale: false however old the value is. The 124-day-old wood stove
    // reading on production had stale: false.
    const eq = makeEquipment("a", "Poele", {
      type: "thermostat",
      power: 0,
      readingAgeMs: 124 * 24 * 60 * 60 * 1000,
    });
    expect(eq.dataBindings[0].stale).toBe(false);
    expect(readSubmeterReading(eq, NOW).unknown).toBe("stale");
  });

  it("treats an absent timestamp as no evidence of age, not as old", () => {
    // Same reading as the backend: a binding with lastUpdated === null has
    // never reported, and is not therefore stale.
    const eq = makeEquipment("a", "PAC", { power: 300, lastUpdated: null });
    expect(readSubmeterReading(eq, NOW).power).toBe(300);
  });

  it("treats an unparseable timestamp the same way", () => {
    const eq = makeEquipment("a", "PAC", { power: 300, lastUpdated: "not-a-date" });
    expect(readSubmeterReading(eq, NOW).power).toBe(300);
  });

  it("accepts the SQLite-flavoured timestamp the API also emits", () => {
    expect(parseReadingTime("2026-05-27 08:00:00Z")).toBe(
      parseReadingTime("2026-05-27T08:00:00Z"),
    );
    expect(parseReadingTime(null)).toBeNull();
    expect(parseReadingTime("nope")).toBeNull();
  });

  it("reports offline before stale, since offline is the more specific fact", () => {
    const eq = makeEquipment("a", "Piscine", {
      power: 275,
      status: "offline",
      readingAgeMs: 60 * 60 * 1000,
    });
    expect(readSubmeterReading(eq, NOW).unknown).toBe("offline");
  });
});

describe("buildSubmeterRows", () => {
  it("filters main/production meters out", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 100 }),
      makeEquipment("b", "Shelly Grid", { type: "main_energy_meter", power: 200 }),
      makeEquipment("c", "Shelly Solar", { type: "energy_production_meter", power: 300 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["PAC"]);
  });

  it("includes metering switches, excludes bare relays (spec 129)", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 100 }),
      makeEquipment("b", "Prise Bureau", { type: "switch", power: 40 }),
      makeEquipment("c", "Relais nu", { type: "switch", power: null }),
    ]);
    // PAC (100) + metering switch (40), sorted by power desc; bare relay excluded.
    expect(rows.map((r) => r.name)).toEqual(["PAC", "Prise Bureau"]);
  });

  it("assigns colors by sorted-id index (stable across power reorders)", () => {
    const a = makeEquipment("aaa-id", "Z-last", { power: 100 });
    const b = makeEquipment("bbb-id", "A-first", { power: 9999 });
    const rows = buildRows([b, a]);
    const rowA = rows.find((r) => r.id === "aaa-id");
    const rowB = rows.find((r) => r.id === "bbb-id");
    expect(rowA?.color).toBe(SUBMETER_PALETTE[0]);
    expect(rowB?.color).toBe(SUBMETER_PALETTE[1]);
  });

  it("sorts rows by power descending for display", () => {
    const rows = buildRows([
      makeEquipment("a", "Low", { power: 50 }),
      makeEquipment("b", "High", { power: 2000 }),
      makeEquipment("c", "Mid", { power: 500 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("places offline (null-power) rows last", () => {
    const rows = buildRows([
      makeEquipment("a", "Online1", { power: 100 }),
      makeEquipment("b", "OfflineOne", { power: 500, status: "offline" }),
      makeEquipment("c", "Online2", { power: 50 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Online1", "Online2", "OfflineOne"]);
    expect(rows[2].power).toBeNull();
  });

  it("drops online submeters with no power measurement (#560)", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 100 }),
      makeEquipment("b", "Lave-linge", { power: null }),
    ]);
    // The washing machine has no power binding while online → omitted.
    expect(rows.map((r) => r.name)).toEqual(["PAC"]);
  });

  it("keeps offline submeters even without a power value (#560)", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 100 }),
      makeEquipment("b", "Piscine", { power: null, status: "offline" }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["PAC", "Piscine"]);
    expect(rows[1].power).toBeNull();
  });

  it("wraps palette when more than 8 submeters", () => {
    const inputs = Array.from({ length: 9 }, (_, i) =>
      makeEquipment(`id-${i}`, `S${i}`, { power: 100 - i }),
    );
    const rows = buildRows(inputs);
    const ninth = rows.find((r) => r.id === "id-8");
    expect(ninth?.color).toBe(SUBMETER_PALETTE[0]);
  });

  it("returns an empty array when no submeters exist", () => {
    expect(buildRows([])).toEqual([]);
  });

  it("keeps a submeter whose reading aged out, with no number (#744)", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 100 }),
      makeEquipment("b", "Chauffe-eau", {
        type: "water_heater",
        power: 560,
        readingAgeMs: 16 * 60 * 1000,
      }),
    ]);
    // It stays, because "we do not know" is information. What it does not do
    // is contribute 560 W to a total measured 25 seconds ago.
    expect(rows.map((r) => r.name)).toEqual(["PAC", "Chauffe-eau"]);
    const stale = rows[1];
    expect(stale.power).toBeNull();
    expect(stale.unknown).toBe("stale");
    expect(stale.staleSince).not.toBeNull();
  });

  it("still drops a submeter that was never bound (#560)", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 100 }),
      makeEquipment("b", "Lave-linge", { power: null }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["PAC"]);
  });

  it("sorts stale rows after every row that has a number", () => {
    const rows = buildRows([
      makeEquipment("a", "Stale", { power: 9999, readingAgeMs: 60 * 60 * 1000 }),
      makeEquipment("b", "Small", { power: 5 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Small", "Stale"]);
  });

  it("keeps a stale reading out of the residual (#744)", () => {
    // This is the arithmetic the household actually sees: before the fix the
    // 560 W leftover was subtracted from the house total as if it were current.
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 1200 }),
      makeEquipment("b", "Chauffe-eau", {
        type: "water_heater",
        power: 560,
        readingAgeMs: 16 * 60 * 1000,
      }),
    ]);
    expect(computeOther(2000, rows)).toBe(800);
  });
});

describe("displayedPower and sharePercent (#744)", () => {
  it("rounds the way formatPower does, so shares match what is on screen", () => {
    // The shape of the reported case: the centre label rounds to the nearest
    // 5 W while the share divided by the raw total, so the two numbers on
    // screen disagreed. Here the raw share is 30 % and the label says 35 W;
    // the reader can only check 10/35, so that is what the row shows.
    expect(displayedPower(33.5)).toBe(35);
    expect(displayedPower(10)).toBe(10);
    expect(Math.round((10 / 33.5) * 100)).toBe(30); // what it used to print
    expect(sharePercent(10, 33.5)).toBe(29); // what the label supports
  });

  it("rounds kilowatts to the displayed decimal", () => {
    expect(displayedPower(1632.9)).toBe(1600);
    expect(displayedPower(999)).toBe(1000);
  });

  it("rounds a half-step the way toFixed(1) does, not the way Math.round does", () => {
    // The binary double nearest 1.15 sits just below the half, so toFixed(1)
    // gives "1.1" while Math.round(1150 / 100) * 100 gives 1200. A 575 W part
    // in a 1150 W house printed 48 % under a label reading 1.1 kW.
    expect(displayedPower(1150)).toBe(1100);
    expect(sharePercent(575, 1150)).toBe(52);
  });

  it("never reports a part larger than the whole", () => {
    // 776 % was what the card actually rendered. A breakdown cannot have one.
    expect(sharePercent(275, 35)).toBe(100);
  });

  it("returns null rather than dividing by nothing", () => {
    expect(sharePercent(100, 0)).toBeNull();
    expect(sharePercent(100, 2)).toBeNull(); // rounds down to a zero whole
  });
});

describe("computeOther", () => {
  it("returns house minus the sum of submeter powers", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 1200 }),
      makeEquipment("b", "Pool", { power: 800 }),
      makeEquipment("c", "EV", { power: 570 }),
    ]);
    expect(computeOther(3200, rows)).toBe(630);
  });

  it("clamps to 0 when the submeters overshoot the house total", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 2000 }),
      makeEquipment("b", "Pool", { power: 1500 }),
    ]);
    expect(computeOther(3200, rows)).toBe(0);
  });

  it("returns 0 when house and submeters are both empty", () => {
    expect(computeOther(0, [])).toBe(0);
  });

  it("returns 0 when submeter sum equals the house value", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 1000 }),
    ]);
    expect(computeOther(1000, rows)).toBe(0);
  });

  it("ignores null-power rows in the sum", () => {
    const rows = buildRows([
      makeEquipment("a", "PAC", { power: 1200 }),
      makeEquipment("b", "Pool", { power: null, status: "offline" }),
    ]);
    expect(computeOther(2000, rows)).toBe(800);
  });
});
