import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../core/logger.js";
import type { EngineEvent, PriceFileRow, TariffContract } from "../../shared/types.js";
import { createMigratedTestDb } from "../../test-helpers/migrations.js";
import { TariffVersionStore } from "../tariff-version-store.js";
import { PriceFileError } from "./price-file.js";
import {
  PRICE_FILE_DISMISSED_KEY,
  PRICE_FILE_STATUS_KEY,
  PriceFileSync,
  followsPriceFile,
} from "./price-file-sync.js";

// Spec 203 — the daily read of the price file, with the download replaced.

const logger = createLogger("silent").logger;

const row = (startDate: string, hp: number, hc: number, fee: number, kva = 9): PriceFileRow => ({
  contractType: "hphc",
  kva,
  startDate,
  hp,
  hc,
  fixedFeeYear: fee,
});

const ROWS_9 = [
  row("2025-08-01", 0.2081, 0.1635, 239.84),
  row("2026-02-01", 0.2065, 0.1578, 235.92),
  row("2026-08-01", 0.2142, 0.1589, 239.84),
];

function fileOf(prices: PriceFileRow[], format = 1) {
  return {
    format,
    generatedAt: "2026-11-11",
    suppliers: [
      {
        id: "edf-tarif-bleu",
        name: "EDF, Tarif Bleu (tarif réglementé)",
        source: "CRE",
        sourceUrl: "https://www.cre.fr/documents/open-data",
        // The file's order: contract type, power, date.
        prices: [...prices].sort((a, b) => a.kva - b.kva || a.startDate.localeCompare(b.startDate)),
      },
    ],
  };
}

interface Harness {
  sync: PriceFileSync;
  versions: TariffVersionStore;
  settings: Map<string, string>;
  events: EngineEvent[];
  fetches: () => number;
  setFile: (next: unknown | (() => Promise<unknown>)) => void;
  setContract: (next: Partial<TariffContract>) => void;
  setNow: (iso: string) => void;
  /** A second sync on the same settings and versions, as after a restart. */
  restart: () => PriceFileSync;
}

function harness(): Harness {
  const versions = new TariffVersionStore(createMigratedTestDb(), logger);
  const settings = new Map<string, string>();
  const events: EngineEvent[] = [];
  let contract: TariffContract = {
    supplier: "edf-tarif-bleu",
    contractType: "hphc",
    kva: 9,
    autoUpdate: true,
  };
  let file: unknown | (() => Promise<unknown>) = fileOf(ROWS_9);
  let fetches = 0;
  let now = new Date("2026-11-11T08:00:00.000Z");
  const build = () =>
    new PriceFileSync({
      settings: {
        get: (key: string) => settings.get(key),
        set: (key: string, value: string) => void settings.set(key, value),
      },
      versions,
      contract: () => contract,
      eventBus: { emit: (event: EngineEvent) => void events.push(event) },
      logger,
      fetchFile: async () => {
        fetches++;
        return typeof file === "function" ? (file as () => Promise<unknown>)() : file;
      },
      now: () => now,
    });
  return {
    sync: build(),
    versions,
    settings,
    events,
    fetches: () => fetches,
    setFile: (next) => {
      file = next;
    },
    setContract: (next) => {
      contract = { ...contract, ...next };
    },
    setNow: (iso) => {
      now = new Date(iso);
    },
    restart: build,
  };
}

/** An upgraded instance: the version without a date that spec 202 seeded. */
function seeded(h: Harness): void {
  h.versions.create({ prices: { hp: 0.246, hc: 0.1828 } }, "migration");
}

let h: Harness;
beforeEach(() => {
  process.env.TZ = "Europe/Paris";
  h = harness();
});

describe("followsPriceFile", () => {
  const base: TariffContract = {
    supplier: "edf-tarif-bleu",
    contractType: "hphc",
    kva: 9,
    autoUpdate: true,
  };
  it("needs a supplier of the file, the option on and a power", () => {
    expect(followsPriceFile(base)).toBe(true);
    expect(followsPriceFile({ ...base, supplier: "other" })).toBe(false);
    expect(followsPriceFile({ ...base, autoUpdate: false })).toBe(false);
    expect(followsPriceFile({ ...base, kva: null })).toBe(false);
  });
});

describe("check — when nothing is read", () => {
  it.each<[string, Partial<TariffContract>]>([
    ["another supplier", { supplier: "other" }],
    ["the option off", { autoUpdate: false }],
    ["no power", { kva: null }],
  ])("makes no download with %s", async (_label, contract) => {
    seeded(h);
    h.setContract(contract);
    const status = await h.sync.check();
    expect(h.fetches()).toBe(0);
    expect(status).toMatchObject({ following: false, pending: [], lastCheckAt: null });
    expect(h.versions.all()).toHaveLength(1);
  });
});

describe("check — the retroactive fill", () => {
  it("holds every past price of an upgraded instance, with one standing notice", async () => {
    seeded(h);
    const status = await h.sync.check();
    expect(h.versions.all()).toHaveLength(1); // nothing added by itself
    expect(status.pending.map((r) => r.startDate)).toEqual([
      "2026-08-01",
      "2026-02-01",
      "2025-08-01",
    ]); // newest first
    expect(status).toMatchObject({
      following: true,
      error: null,
      latestStartDate: "2026-08-01",
      noPriceForContract: false,
      lastCheckAt: "2026-11-11T08:00:00.000Z",
      lastSuccessAt: "2026-11-11T08:00:00.000Z",
    });
    const raised = h.events.filter((e) => e.type === "system.alarm.raised");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ alarmId: "price-file.pending", source: "price-file" });

    // A second read says nothing more.
    await h.sync.check();
    expect(h.events.filter((e) => e.type === "system.alarm.raised")).toHaveLength(1);
  });

  it("adds the held prices oldest first, from the file, and leaves the first version alone", async () => {
    seeded(h);
    const { pending } = await h.sync.check();
    const created = h.sync.apply(pending.map((r) => r.startDate));

    expect(created.map((v) => v.startDate)).toEqual(["2025-08-01", "2026-02-01", "2026-08-01"]);
    expect(created.every((v) => v.origin === "file:edf-tarif-bleu")).toBe(true);
    expect(created[2]).toMatchObject({
      prices: { hp: 0.2142, hc: 0.1589 },
      fixedFeeYear: 239.84,
      kva: 9,
    });
    const [first] = h.versions.all();
    expect(first).toMatchObject({ startDate: null, prices: { hp: 0.246, hc: 0.1828 } });
    expect(h.sync.status().pending).toEqual([]);
    expect(h.events.at(-1)).toMatchObject({
      type: "system.alarm.resolved",
      alarmId: "price-file.pending",
    });
  });

  it("makes the oldest row the version without a date on an instance that has none", async () => {
    const { pending } = await h.sync.check();
    h.sync.apply(pending.map((r) => r.startDate));
    expect(h.versions.all().map((v) => v.startDate)).toEqual([null, "2026-02-01", "2026-08-01"]);
    expect(h.versions.all()[0].prices).toEqual({ hp: 0.2081, hc: 0.1635 });
  });

  it("refuses a date that is not waiting, and creates nothing", async () => {
    seeded(h);
    await h.sync.check();
    expect(() => h.sync.apply(["2026-08-01", "2024-01-01"])).toThrow(PriceFileError);
    expect(h.versions.all()).toHaveLength(1);
  });
});

describe("check — a new period", () => {
  beforeEach(async () => {
    seeded(h);
    const { pending } = await h.sync.check();
    h.sync.apply(pending.map((r) => r.startDate));
    h.events.length = 0;
  });

  it("adds it by itself, with one notification that is not a standing alarm", async () => {
    h.setFile(fileOf([...ROWS_9, row("2027-02-01", 0.2201, 0.1612, 243.1)]));
    const status = await h.sync.check();
    const latest = h.versions.all().at(-1);
    expect(latest).toMatchObject({
      startDate: "2027-02-01",
      prices: { hp: 0.2201, hc: 0.1612 },
      origin: "file:edf-tarif-bleu",
    });
    expect(status.pending).toEqual([]);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      type: "system.alarm.resolved",
      alarmId: "price-file.added.2027-02-01",
      source: "price-file",
    });

    // Read again: nothing more is added, nothing more is said.
    await h.sync.check();
    expect(h.versions.all()).toHaveLength(5);
    expect(h.events).toHaveLength(1);
  });

  it("holds a jump of 30 % instead of adding it", async () => {
    h.setFile(fileOf([...ROWS_9, row("2027-02-01", 0.29, 0.17, 243.1)]));
    const status = await h.sync.check();
    expect(h.versions.all()).toHaveLength(4);
    expect(status.pending.map((r) => r.startDate)).toEqual(["2027-02-01"]);
    expect(h.events[0]).toMatchObject({ type: "system.alarm.raised" });
  });

  it("never changes a version that exists, whatever the file says for its date", async () => {
    const before = h.versions.all();
    h.setFile(fileOf(ROWS_9.map((r) => ({ ...r, hp: r.hp + 0.01, fixedFeeYear: 1 }))));
    await h.sync.check();
    expect(h.versions.all()).toEqual(before);
    expect(h.sync.status().pending).toEqual([]);
  });
});

describe("check — a read that fails", () => {
  it.each<[string, unknown | (() => Promise<unknown>)]>([
    ["the download fails", () => Promise.reject(new Error("fetch failed"))],
    ["the file is not a price file", { hello: "world" }],
    ["the file has a newer format", fileOf(ROWS_9, 2)],
    ["a row is out of range", fileOf([row("2026-08-01", 2, 0.1, 1)])],
  ])("changes nothing when %s, and says so", async (_label, file) => {
    seeded(h);
    await h.sync.check(); // a first success
    h.setNow("2026-11-12T08:00:00.000Z");
    h.setFile(file);
    const status = await h.sync.check();
    expect(h.versions.all()).toHaveLength(1);
    expect(status.error).toBeTruthy();
    expect(status.lastCheckAt).toBe("2026-11-12T08:00:00.000Z");
    expect(status.lastSuccessAt).toBe("2026-11-11T08:00:00.000Z");
    // What the last good file held is still offered.
    expect(status.pending).toHaveLength(3);
  });

  it("recovers at the next read", async () => {
    seeded(h);
    h.setFile(() => Promise.reject(new Error("offline")));
    expect((await h.sync.check()).error).toBe("offline");
    h.setFile(fileOf(ROWS_9));
    expect((await h.sync.check()).error).toBeNull();
  });
});

describe("check — one read at a time", () => {
  it("makes one download for two calls made together", async () => {
    seeded(h);
    let release: (value: unknown) => void = () => {};
    h.setFile(() => new Promise((resolve) => (release = resolve)));
    const first = h.sync.check();
    const second = h.sync.check();
    release(fileOf(ROWS_9));
    await Promise.all([first, second]);
    expect(h.fetches()).toBe(1);
  });
});

describe("dismiss", () => {
  it("does not propose a price set aside again, across a restart", async () => {
    seeded(h);
    await h.sync.check();
    h.sync.dismiss(["2025-08-01", "2026-02-01", "2026-08-01"]);
    expect(h.sync.status()).toMatchObject({ pending: [], dismissedCount: 3 });
    expect(h.events.at(-1)).toMatchObject({ type: "system.alarm.resolved" });

    const again = h.restart();
    const status = await again.check();
    expect(status.pending).toEqual([]);
    expect(status.dismissedCount).toBe(3);
    expect(JSON.parse(h.settings.get(PRICE_FILE_DISMISSED_KEY)!)).toContain(
      "edf-tarif-bleu|hphc|9|2026-08-01",
    );
  });

  it("proposes them again when asked, and for another power", async () => {
    seeded(h);
    h.setFile(fileOf([...ROWS_9, row("2026-08-01", 0.2142, 0.1589, 190.81, 6)]));
    await h.sync.check();
    h.sync.dismiss(["2025-08-01", "2026-02-01", "2026-08-01"]);

    h.setContract({ kva: 6 });
    expect(h.sync.status().pending.map((r) => r.kva)).toEqual([6]);

    h.setContract({ kva: 9 });
    h.sync.restoreDismissed();
    expect(h.sync.status().pending).toHaveLength(3);
  });
});

describe("status", () => {
  it("says when the file has no price for the contract", async () => {
    seeded(h);
    h.setContract({ contractType: "base", kva: 18 });
    const status = await h.sync.check();
    expect(status).toMatchObject({
      following: true,
      noPriceForContract: true,
      latestStartDate: null,
      pending: [],
    });
  });

  it("keeps the dates of the last read across a restart", async () => {
    seeded(h);
    await h.sync.check();
    const again = h.restart();
    expect(again.status()).toMatchObject({
      lastCheckAt: "2026-11-11T08:00:00.000Z",
      lastSuccessAt: "2026-11-11T08:00:00.000Z",
      error: null,
      // The file itself is not kept: nothing is offered until the next read.
      pending: [],
    });
    expect(h.settings.has(PRICE_FILE_STATUS_KEY)).toBe(true);
  });

  it("reads broken settings as empty", () => {
    h.settings.set(PRICE_FILE_STATUS_KEY, "{not json");
    h.settings.set(PRICE_FILE_DISMISSED_KEY, "{not json");
    expect(h.sync.status()).toMatchObject({ lastCheckAt: null, dismissedCount: 0 });
  });
});
