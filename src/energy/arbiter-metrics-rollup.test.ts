import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArbiterMetricsRollup, localMidnight, ROLLUP_ROW_CAP } from "./arbiter-metrics-rollup.js";
import type { ArbiterJournalStore } from "./arbiter-journal-store.js";
import type { ArbiterSurplusStore } from "./arbiter-surplus-store.js";
import type { ArbiterMetricsStore, MetricsTick } from "./arbiter-metrics-store.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { Logger } from "../core/logger.js";
import type { ArbiterDecision, Equipment } from "../shared/types.js";

// Spec 158 — the scheduler and glue. The arithmetic is covered by
// arbiter-metrics.test.ts; what matters here is which days are recomputed,
// that the read is capped and reported, and that nothing it does can throw
// into the process.

interface MockLogger {
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: () => MockLogger;
}

function makeLogger(): MockLogger {
  const self: MockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => self,
  };
  return self;
}

function makeEquipment(over: Partial<Equipment> = {}): Equipment {
  return {
    id: "pump",
    name: "Pool pump",
    type: "pool_pump",
    energyProfile: {
      class: "deferrable",
      nominalPowerW: 600,
      minOnS: 3600,
      minOffS: 600,
    },
    ...over,
  } as Equipment;
}

interface Harness {
  rollup: ArbiterMetricsRollup;
  upserts: MetricsTick[][];
  journalRange: ReturnType<typeof vi.fn>;
  logger: MockLogger;
}

function harness(opts: { decisions?: ArbiterDecision[]; equipments?: Equipment[] } = {}): Harness {
  const upserts: MetricsTick[][] = [];
  const journalRange = vi.fn(() => opts.decisions ?? []);

  const journalStore = { range: journalRange } as unknown as ArbiterJournalStore;
  const surplusStore = { range: vi.fn(() => []) } as unknown as ArbiterSurplusStore;
  const metricsStore = {
    upsertTick: vi.fn((ticks: MetricsTick[]) => upserts.push(ticks)),
  } as unknown as ArbiterMetricsStore;
  const equipments = {
    getAll: () => opts.equipments ?? [makeEquipment()],
  } as unknown as EquipmentManager;
  const settings = { get: () => undefined } as unknown as SettingsManager;
  const logger = makeLogger();

  return {
    rollup: new ArbiterMetricsRollup(
      journalStore,
      surplusStore,
      metricsStore,
      equipments,
      settings,
      logger as unknown as Logger,
    ),
    upserts,
    journalRange,
    logger,
  };
}

describe("ArbiterMetricsRollup", () => {
  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T14:30:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recomputes today and yesterday on a tick, in one upsert", () => {
    const h = harness();
    h.rollup.run();

    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0].map((t) => t.day)).toEqual(["2026-08-19", "2026-08-20"]);
  });

  it("clamps today's window to now, so a live grant is not counted to midnight", () => {
    const h = harness({
      decisions: [
        {
          atIso: new Date("2026-08-20T13:30:00").toISOString(),
          kind: "granted",
          equipmentId: "pump",
        },
      ],
    });
    h.rollup.run();

    const today = h.upserts[0].find((t) => t.day === "2026-08-20");
    // 13:30 to 14:30 (now), not 13:30 to midnight.
    expect(today?.loads[0].grantedS).toBe(3600);
  });

  it("is idempotent across ticks", () => {
    const h = harness();
    h.rollup.run();
    h.rollup.run();

    expect(h.upserts).toHaveLength(2);
    expect(h.upserts[0]).toEqual(h.upserts[1]);
  });

  it("caps the decision read per day and says so", () => {
    const many: ArbiterDecision[] = Array.from({ length: ROLLUP_ROW_CAP }, (_, i) => ({
      atIso: new Date("2026-08-20T10:00:00").toISOString(),
      kind: i % 2 === 0 ? "granted" : "revoked",
      equipmentId: "pump",
    }));
    const h = harness({ decisions: many });
    h.rollup.run();

    expect(h.journalRange).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      ROLLUP_ROW_CAP,
    );
    // Truncation must never pass as a complete rollup.
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("does not warn on a normal day", () => {
    const h = harness({
      decisions: [
        {
          atIso: new Date("2026-08-20T10:00:00").toISOString(),
          kind: "granted",
          equipmentId: "pump",
        },
      ],
    });
    h.rollup.run();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it("ignores equipments with no energy profile", () => {
    const h = harness({
      equipments: [makeEquipment(), makeEquipment({ id: "lamp", energyProfile: undefined })],
    });
    h.rollup.run();

    const day = h.upserts[0][0];
    expect(day.loads.map((l) => l.equipmentId)).toEqual(["pump"]);
  });

  it("survives a store that throws, and keeps the timer alive", () => {
    const h = harness();
    const throwing = new ArbiterMetricsRollup(
      {
        range: () => {
          throw new Error("db gone");
        },
      } as unknown as ArbiterJournalStore,
      { range: () => [] } as unknown as ArbiterSurplusStore,
      { upsertTick: vi.fn() } as unknown as ArbiterMetricsStore,
      { getAll: () => [makeEquipment()] } as unknown as EquipmentManager,
      { get: () => undefined } as unknown as SettingsManager,
      h.logger as unknown as Logger,
    );

    expect(() => throwing.start()).not.toThrow();
    expect(h.logger.error).toHaveBeenCalled();
    throwing.stop();
  });

  it("runs once immediately on start, then on the next hour boundary", () => {
    const h = harness();
    h.rollup.start();
    expect(h.upserts).toHaveLength(1); // startup catch-up

    vi.advanceTimersByTime(30 * 60_000); // 15:00 local
    expect(h.upserts).toHaveLength(2);

    vi.advanceTimersByTime(60 * 60_000); // 16:00
    expect(h.upserts).toHaveLength(3);

    h.rollup.stop();
    vi.advanceTimersByTime(3 * 60 * 60_000);
    expect(h.upserts).toHaveLength(3); // stopped means stopped
  });
});

describe("localMidnight", () => {
  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  it("returns the local midnight of the day containing the instant", () => {
    const noon = new Date("2026-08-20T12:34:56").getTime();
    expect(new Date(localMidnight(noon)).getHours()).toBe(0);
    expect(new Date(localMidnight(noon)).getDate()).toBe(20);
  });

  it("is stable across a DST boundary", () => {
    // 2026-10-25 is a 25 h day in Europe/Paris.
    const during = new Date("2026-10-25T12:00:00").getTime();
    const start = localMidnight(during);
    const next = localMidnight(start + 25 * 3_600_000);
    expect(next - start).toBe(25 * 3_600_000);
  });
});
