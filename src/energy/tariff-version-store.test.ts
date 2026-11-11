import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../core/logger.js";
import { createMigratedTestDb } from "../test-helpers/migrations.js";
import type { TariffConfig } from "../shared/types.js";
import { TariffVersionError, TariffVersionStore, isLocalDate } from "./tariff-version-store.js";

// Spec 202 — the dated price versions and their rules.

const logger = createLogger("silent").logger;

const TARIFF: TariffConfig = {
  schedules: [],
  prices: { hp: 0.2081, hc: 0.1635 },
};

let now: Date;
let store: TariffVersionStore;

beforeEach(() => {
  process.env.TZ = "Europe/Paris";
  now = new Date(2026, 10, 11, 12, 0);
  store = new TariffVersionStore(createMigratedTestDb(), logger, () => now);
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof TariffVersionError) return err.code;
    throw err;
  }
  return "no error";
}

describe("seedFromSetting", () => {
  it("creates the first version, without a date, from the setting's prices", () => {
    expect(store.seedFromSetting(TARIFF)).toBe(true);
    expect(store.all()).toMatchObject([
      {
        startDate: null,
        prices: { hp: 0.2081, hc: 0.1635 },
        fixedFeeYear: null,
        kva: null,
        origin: "migration",
      },
    ]);
  });

  it("creates nothing from prices 0/0, from no setting or from broken prices", () => {
    expect(store.seedFromSetting({ schedules: [], prices: { hp: 0, hc: 0 } })).toBe(false);
    expect(store.seedFromSetting(null)).toBe(false);
    expect(store.seedFromSetting({ schedules: [], prices: { hp: Number.NaN, hc: 0.1 } })).toBe(
      false,
    );
    expect(store.all()).toEqual([]);
  });

  it("creates nothing when a version exists", () => {
    store.create({ prices: { hp: 0.3, hc: 0.2 } }, "manual");
    expect(store.seedFromSetting(TARIFF)).toBe(false);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].prices).toEqual({ hp: 0.3, hc: 0.2 });
  });
});

describe("create", () => {
  it("stores the first version without a date, whatever is sent", () => {
    const first = store.create({ startDate: "2026-02-01", prices: { hp: 0.2, hc: 0.1 } }, "manual");
    expect(first.startDate).toBeNull();
    expect(first.origin).toBe("manual");
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lists the versions oldest first, the one without a date first", () => {
    store.seedFromSetting(TARIFF);
    store.create({ startDate: "2026-08-01", prices: { hp: 0.2142, hc: 0.1589 } }, "manual");
    store.create(
      { startDate: "2026-02-01", prices: { hp: 0.2065, hc: 0.1578 }, fixedFeeYear: 188.24, kva: 6 },
      "manual",
    );
    expect(store.all().map((v) => v.startDate)).toEqual([null, "2026-02-01", "2026-08-01"]);
    expect(store.all()[1]).toMatchObject({ fixedFeeYear: 188.24, kva: 6 });
  });

  it("accepts a start date in the future", () => {
    store.seedFromSetting(TARIFF);
    expect(
      store.create({ startDate: "2027-02-01", prices: { hp: 0.22, hc: 0.16 } }, "manual").startDate,
    ).toBe("2027-02-01");
  });

  it("refuses a second version on a used date", () => {
    store.seedFromSetting(TARIFF);
    store.create({ startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 } }, "manual");
    expect(
      code(() => store.create({ startDate: "2026-08-01", prices: { hp: 0.3, hc: 0.1 } }, "manual")),
    ).toBe("DuplicateStartDate");
  });

  it("refuses a dated version without a real date", () => {
    store.seedFromSetting(TARIFF);
    for (const startDate of [undefined, null, "2026-02-30", "01/08/2026", "2026-8-1"]) {
      expect(code(() => store.create({ startDate, prices: { hp: 0.2, hc: 0.1 } }, "manual"))).toBe(
        "Invalid",
      );
    }
  });

  it("refuses prices, a fee or a power out of range", () => {
    store.seedFromSetting(TARIFF);
    const base = { startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 } };
    expect(code(() => store.create({ ...base, prices: { hp: -0.01, hc: 0.1 } }, "manual"))).toBe(
      "Invalid",
    );
    expect(code(() => store.create({ ...base, prices: { hp: 5.01, hc: 0.1 } }, "manual"))).toBe(
      "Invalid",
    );
    expect(code(() => store.create({ ...base, fixedFeeYear: -1 }, "manual"))).toBe("Invalid");
    expect(code(() => store.create({ ...base, kva: 0 }, "manual"))).toBe("Invalid");
    expect(store.all()).toHaveLength(1);
  });
});

describe("update", () => {
  it("moves a dated version to a free date, and refuses a used one", () => {
    store.seedFromSetting(TARIFF);
    const feb = store.create({ startDate: "2026-02-01", prices: { hp: 0.2, hc: 0.1 } }, "manual");
    store.create({ startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 } }, "manual");
    expect(store.update(feb.id, { startDate: "2026-02-02", prices: feb.prices }).startDate).toBe(
      "2026-02-02",
    );
    expect(code(() => store.update(feb.id, { startDate: "2026-08-01", prices: feb.prices }))).toBe(
      "DuplicateStartDate",
    );
  });

  it("keeps a dated version's date when none is sent", () => {
    store.seedFromSetting(TARIFF);
    const feb = store.create({ startDate: "2026-02-01", prices: { hp: 0.2, hc: 0.1 } }, "manual");
    const edited = store.update(feb.id, { prices: { hp: 0.21, hc: 0.11 }, kva: 9 });
    expect(edited).toMatchObject({
      startDate: "2026-02-01",
      prices: { hp: 0.21, hc: 0.11 },
      kva: 9,
    });
  });

  it("edits the version without a date, which keeps none", () => {
    store.seedFromSetting(TARIFF);
    const [first] = store.all();
    const edited = store.update(first.id, {
      startDate: "2020-01-01",
      prices: { hp: 0.18, hc: 0.09 },
    });
    expect(edited).toMatchObject({ startDate: null, prices: { hp: 0.18, hc: 0.09 } });
  });

  it("answers NotFound for an unknown id", () => {
    expect(code(() => store.update("nope", { prices: { hp: 0.2, hc: 0.1 } }))).toBe("NotFound");
  });
});

describe("remove", () => {
  it("deletes a dated version", () => {
    store.seedFromSetting(TARIFF);
    const feb = store.create({ startDate: "2026-02-01", prices: { hp: 0.2, hc: 0.1 } }, "manual");
    store.remove(feb.id);
    expect(store.all().map((v) => v.startDate)).toEqual([null]);
  });

  it("never deletes the version without a date", () => {
    store.seedFromSetting(TARIFF);
    expect(code(() => store.remove(store.all()[0].id))).toBe("UndatedVersionLocked");
    expect(code(() => store.remove("nope"))).toBe("NotFound");
    expect(store.all()).toHaveLength(1);
  });
});

describe("current and upsertCurrentPrices", () => {
  it("gives the version in force today, not one dated in the future", () => {
    store.seedFromSetting(TARIFF);
    store.create({ startDate: "2026-08-01", prices: { hp: 0.2142, hc: 0.1589 } }, "manual");
    store.create({ startDate: "2027-02-01", prices: { hp: 0.3, hc: 0.2 } }, "manual");
    expect(store.current()?.startDate).toBe("2026-08-01");
    now = new Date(2027, 1, 1, 0, 5);
    expect(store.current()?.startDate).toBe("2027-02-01");
  });

  it("edits the version in force in place, keeping its date, fee and power", () => {
    store.seedFromSetting(TARIFF);
    store.create(
      { startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 }, fixedFeeYear: 190.81, kva: 6 },
      "manual",
    );
    const edited = store.upsertCurrentPrices({ hp: 0.2142, hc: 0.1589 });
    expect(edited).toMatchObject({
      startDate: "2026-08-01",
      prices: { hp: 0.2142, hc: 0.1589 },
      fixedFeeYear: 190.81,
      kva: 6,
    });
    expect(store.all()).toHaveLength(2);
    expect(store.all()[0].prices).toEqual(TARIFF.prices);
  });

  it("creates the first version when there is none", () => {
    expect(store.upsertCurrentPrices({ hp: 0.2, hc: 0.1 })).toMatchObject({
      startDate: null,
      origin: "manual",
    });
  });
});

describe("cache", () => {
  it("reads the new state after every write", () => {
    expect(store.all()).toEqual([]);
    store.seedFromSetting(TARIFF);
    expect(store.all()).toHaveLength(1);
    const feb = store.create({ startDate: "2026-02-01", prices: { hp: 0.2, hc: 0.1 } }, "manual");
    expect(store.all()).toHaveLength(2);
    store.update(feb.id, { prices: { hp: 0.25, hc: 0.1 } });
    expect(store.all()[1].prices.hp).toBe(0.25);
    store.remove(feb.id);
    expect(store.all()).toHaveLength(1);
  });
});

describe("isLocalDate", () => {
  it("accepts real days only, written YYYY-MM-DD", () => {
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-2-1")).toBe(false);
    expect(isLocalDate(20260201)).toBe(false);
  });
});
