import { describe, expect, it } from "vitest";
import type { DataBindingWithValue, EquipmentStatus, EquipmentWithDetails } from "../../types";
import { detectLiveStaleness } from "./live-staleness";
import {
  FROZEN_READING_MS,
  SUBMETER_FRESHNESS_MS,
  SUBMETER_FRESHNESS_SLOW_MS,
} from "../../../../src/shared/reading-freshness";

/**
 * Fixed clock: every reading's age is stated by the test rather than inherited
 * from whenever the suite happens to run.
 */
const NOW = Date.parse("2026-08-30T15:17:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const FRESH_MS = 5_000;
/** Past the silence budget: nothing has arrived for a while. */
const LATE_MS = SUBMETER_FRESHNESS_SLOW_MS + 60_000;
/**
 * The cadence of every polled source in the registry (legrand_energy's 300 s
 * default, the APsystems bridge's Tasmota `TelePeriod`), and the case #881 is
 * about: three minutes past the OLD two-minute window, well inside the new one.
 */
const POLLED_CADENCE_MS = SUBMETER_FRESHNESS_MS + 60_000;

function makeMeter(
  id: string,
  type: "main_energy_meter" | "energy_production_meter",
  opts: {
    status?: EquipmentStatus;
    /** Age of the `power` reading. Defaults to fresh. */
    readingAgeMs?: number;
    /** Age of the last full-precision value CHANGE. Defaults to the reading's own age. */
    changedAgeMs?: number;
    /** The `power` value itself. Defaults to a non-zero draw. */
    value?: number;
    /** Omit the `power` binding entirely. */
    noPower?: boolean;
    offlineSince?: string | null;
    /** Extra bindings, e.g. a `voltage` this page never draws. */
    extra?: Partial<DataBindingWithValue>[];
    staleBindings?: string[];
  } = {},
): EquipmentWithDetails {
  const base: DataBindingWithValue = {
    id: "b-" + id,
    equipmentId: id,
    deviceDataId: "dd",
    deviceId: "d-" + id,
    deviceName: "Shelly",
    key: "power",
    alias: "power",
    type: "number",
    category: "power",
    value: opts.value ?? 1000,
    lastUpdated: ago(opts.readingAgeMs ?? FRESH_MS),
    lastChanged: ago(opts.changedAgeMs ?? opts.readingAgeMs ?? FRESH_MS),
    stale: false,
  };
  const dataBindings: DataBindingWithValue[] = opts.noPower ? [] : [base];
  for (const extra of opts.extra ?? []) {
    dataBindings.push({ ...base, id: "b-" + id + "-" + extra.alias, ...extra });
  }
  const status = opts.status ?? "online";
  return {
    id,
    name: id,
    zoneId: "z",
    type,
    enabled: true,
    createdAt: "2026-08-01 00:00:00Z",
    updatedAt: "2026-08-01 00:00:00Z",
    dataBindings,
    orderBindings: [],
    status,
    statusReason:
      status === "online"
        ? undefined
        : {
            offlineDevices: [],
            staleBindings: opts.staleBindings ?? [],
            offlineSince: opts.offlineSince ?? null,
          },
  };
}

const detect = (grid: EquipmentWithDetails[], solar: EquipmentWithDetails[]) =>
  detectLiveStaleness(grid, solar, NOW);

describe("detectLiveStaleness", () => {
  it("returns no entry when there is no meter at all", () => {
    expect(detect([], [])).toEqual([]);
  });

  it("returns no entry when both readings are current", () => {
    const grid = makeMeter("grid", "main_energy_meter");
    const solar = makeMeter("solar", "energy_production_meter");
    expect(detect([grid], [solar])).toEqual([]);
  });

  it("names the production meter when only its reading is frozen (#854)", () => {
    const grid = makeMeter("grid", "main_energy_meter");
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    expect(detect([grid], [solar])).toEqual([
      { source: "solar", mode: "stale", since: ago(LATE_MS) },
    ]);
  });

  it("names the grid meter when only its reading is frozen", () => {
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    const solar = makeMeter("solar", "energy_production_meter");
    expect(detect([grid], [solar])).toEqual([
      { source: "grid", mode: "stale", since: ago(LATE_MS) },
    ]);
  });

  it("dates each source from its own reading, grid first", () => {
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS * 3,
      staleBindings: ["power"],
    });
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    expect(detect([grid], [solar])).toEqual([
      { source: "grid", mode: "stale", since: ago(LATE_MS * 3) },
      { source: "solar", mode: "stale", since: ago(LATE_MS) },
    ]);
  });

  it("does not flag a meter degraded only by a binding this page never draws", () => {
    // The reported production meter: `power` arriving normally, `voltage` past
    // its own 5 min window, whole-equipment status degraded. The diagram draws
    // watts, and the watts are current.
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      staleBindings: ["voltage"],
      extra: [
        {
          alias: "voltage",
          key: "voltage",
          category: "voltage",
          value: 230.7,
          lastUpdated: ago(6 * 60_000),
        },
      ],
    });
    const grid = makeMeter("grid", "main_energy_meter");
    expect(detect([grid], [solar])).toEqual([]);
  });

  it("reports a disconnected meter as offline, dated from the disconnection", () => {
    const offlineSince = ago(20 * 60_000);
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "offline",
      offlineSince,
      readingAgeMs: FRESH_MS,
    });
    expect(detect([grid], [])).toEqual([{ source: "grid", mode: "offline", since: offlineSince }]);
  });

  it("keeps an offline meter and a merely late one apart, each with its own age", () => {
    // Folded into one sentence, the grid's 20 minutes would be lent to a
    // production figure that is 3 minutes old (review of the first draft).
    const offlineSince = ago(20 * 60_000);
    const grid = makeMeter("grid", "main_energy_meter", { status: "offline", offlineSince });
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    expect(detect([grid], [solar])).toEqual([
      { source: "grid", mode: "offline", since: offlineSince },
      { source: "solar", mode: "stale", since: ago(LATE_MS) },
    ]);
  });

  it("ignores a meter that has no power binding to freeze, offline or not", () => {
    const grid = makeMeter("grid", "main_energy_meter", { noPower: true, status: "degraded" });
    const dead = makeMeter("dead", "main_energy_meter", { noPower: true, status: "offline" });
    expect(detect([grid, dead], [])).toEqual([]);
  });

  it("keeps the worst meter when several feed one side: offline over late", () => {
    const offlineSince = ago(9 * 60_000);
    const late = makeMeter("grid-a", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    const dead = makeMeter("grid-b", "main_energy_meter", { status: "offline", offlineSince });
    expect(detect([late, dead], [])).toEqual([
      { source: "grid", mode: "offline", since: offlineSince },
    ]);
  });

  it("keeps the oldest reading when several meters on one side are late", () => {
    const recent = makeMeter("grid-a", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    const older = makeMeter("grid-b", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS * 4,
      staleBindings: ["power"],
    });
    expect(detect([recent, older], [])).toEqual([
      { source: "grid", mode: "stale", since: ago(LATE_MS * 4) },
    ]);
  });

  it("flags the source when one of several meters on that side is frozen", () => {
    const a = makeMeter("grid-a", "main_energy_meter");
    const b = makeMeter("grid-b", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    expect(detect([a, b], [])).toEqual([{ source: "grid", mode: "stale", since: ago(LATE_MS) }]);
  });

  it("says nothing about a meter reporting on a 300 s cadence (#881)", () => {
    // The report: a healthy meter polled every five minutes spent three
    // minutes out of every five under a "reading frozen" banner, because the
    // window was two minutes. Both meters here are three minutes into their
    // normal cadence, and their values moved on the last report.
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: POLLED_CADENCE_MS,
      staleBindings: ["power"],
    });
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      readingAgeMs: POLLED_CADENCE_MS,
      staleBindings: ["power"],
    });
    expect(detect([grid], [solar])).toEqual([]);
  });

  it("flags a source still reporting whose value stopped moving, dated from the change", () => {
    // The failure no clock can see: messages arriving every few seconds, and
    // the same full-precision watts in every one of them.
    const solar = makeMeter("solar", "energy_production_meter", {
      changedAgeMs: FROZEN_READING_MS + 60_000,
    });
    expect(detect([], [solar])).toEqual([
      { source: "solar", mode: "frozen", since: ago(FROZEN_READING_MS + 60_000) },
    ]);
  });

  it("does not call an unchanging zero frozen", () => {
    // A production meter at night and a stuck one both read 0 W forever, and
    // nothing in the value tells them apart. Silence is what judges this one.
    const solar = makeMeter("solar", "energy_production_meter", {
      value: 0,
      changedAgeMs: FROZEN_READING_MS * 10,
    });
    expect(detect([], [solar])).toEqual([]);
  });

  it("reports silence rather than a stuck value when both are true", () => {
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      changedAgeMs: FROZEN_READING_MS * 3,
      staleBindings: ["power"],
    });
    expect(detect([grid], [])).toEqual([{ source: "grid", mode: "stale", since: ago(LATE_MS) }]);
  });

  it("keeps the misleading meter over the merely late one on the same side", () => {
    const late = makeMeter("grid-a", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    const stuck = makeMeter("grid-b", "main_energy_meter", {
      changedAgeMs: FROZEN_READING_MS + 60_000,
    });
    expect(detect([late, stuck], [])).toEqual([
      { source: "grid", mode: "frozen", since: ago(FROZEN_READING_MS + 60_000) },
    ]);
  });

  it("compares SQLite-flavoured timestamps by instant, not by string order", () => {
    // The API emits both `2026-08-30T15:49:01Z` and the SQLite-flavoured
    // `2026-08-30 15:49:01Z`. A lexicographic `<` sorts the space before the
    // `T` whatever the instants are, so here it would keep the NEWER reading.
    const older = makeMeter("grid-a", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: 30 * 60_000, // ISO, 14:47
      staleBindings: ["power"],
    });
    const newer = makeMeter("grid-b", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: LATE_MS,
      staleBindings: ["power"],
    });
    newer.dataBindings[0].lastUpdated = "2026-08-30 15:06:00Z"; // 11 min old
    expect(detect([older, newer], [])[0].since).toBe(ago(30 * 60_000));
  });
});
