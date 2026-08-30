import { describe, expect, it } from "vitest";
import type {
  DataBindingWithValue,
  EquipmentStatus,
  EquipmentWithDetails,
} from "../../types";
import { detectLiveStaleness } from "./live-staleness";
import { SUBMETER_FRESHNESS_MS } from "../../../../src/shared/reading-freshness";

/**
 * Fixed clock: every reading's age is stated by the test rather than inherited
 * from whenever the suite happens to run.
 */
const NOW = Date.parse("2026-08-30T15:17:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const FRESH_MS = 5_000;
const FROZEN_MS = SUBMETER_FRESHNESS_MS + 60_000; // 3 min, the reported case

function makeMeter(
  id: string,
  type: "main_energy_meter" | "energy_production_meter",
  opts: {
    status?: EquipmentStatus;
    /** Age of the `power` reading. Defaults to fresh. */
    readingAgeMs?: number;
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
    value: 1000,
    lastUpdated: ago(opts.readingAgeMs ?? FRESH_MS),
    lastChanged: ago(opts.readingAgeMs ?? FRESH_MS),
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
  it("returns null when there is no meter at all", () => {
    expect(detect([], [])).toBeNull();
  });

  it("returns null when both readings are current", () => {
    const grid = makeMeter("grid", "main_energy_meter");
    const solar = makeMeter("solar", "energy_production_meter");
    expect(detect([grid], [solar])).toBeNull();
  });

  it("names the production meter when only its reading is frozen (#854)", () => {
    const grid = makeMeter("grid", "main_energy_meter");
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      readingAgeMs: FROZEN_MS,
      staleBindings: ["power"],
    });
    expect(detect([grid], [solar])).toEqual({
      mode: "stale",
      sources: ["solar"],
      since: ago(FROZEN_MS),
    });
  });

  it("names the grid meter when only its reading is frozen", () => {
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: FROZEN_MS,
      staleBindings: ["power"],
    });
    const solar = makeMeter("solar", "energy_production_meter");
    expect(detect([grid], [solar])).toEqual({
      mode: "stale",
      sources: ["grid"],
      since: ago(FROZEN_MS),
    });
  });

  it("lists both sources, grid first, and dates the banner from the oldest reading", () => {
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: FROZEN_MS * 3,
      staleBindings: ["power"],
    });
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      readingAgeMs: FROZEN_MS,
      staleBindings: ["power"],
    });
    expect(detect([grid], [solar])).toEqual({
      mode: "stale",
      sources: ["grid", "solar"],
      since: ago(FROZEN_MS * 3),
    });
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
    expect(detect([grid], [solar])).toBeNull();
  });

  it("reports offline, with its own wording, when every flagged meter is disconnected", () => {
    const offlineSince = ago(20 * 60_000);
    const grid = makeMeter("grid", "main_energy_meter", { status: "offline", offlineSince });
    const solar = makeMeter("solar", "energy_production_meter", { status: "offline", offlineSince });
    expect(detect([grid], [solar])).toEqual({
      mode: "offline",
      sources: ["grid", "solar"],
      since: offlineSince,
    });
  });

  it("prefers the offline meter's disconnection time over its last reading", () => {
    const offlineSince = ago(20 * 60_000);
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "offline",
      offlineSince,
      readingAgeMs: FRESH_MS,
    });
    expect(detect([grid], [])).toEqual({
      mode: "offline",
      sources: ["grid"],
      since: offlineSince,
    });
  });

  it("falls back to the stale wording when one meter is offline and another only late", () => {
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "offline",
      offlineSince: ago(20 * 60_000),
    });
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      readingAgeMs: FROZEN_MS,
      staleBindings: ["power"],
    });
    const result = detect([grid], [solar]);
    expect(result?.mode).toBe("stale");
    expect(result?.sources).toEqual(["grid", "solar"]);
  });

  it("ignores a meter that has no power binding to freeze", () => {
    const grid = makeMeter("grid", "main_energy_meter", { noPower: true, status: "degraded" });
    expect(detect([grid], [])).toBeNull();
  });

  it("flags the source when any of several meters on that side is frozen", () => {
    const a = makeMeter("grid-a", "main_energy_meter");
    const b = makeMeter("grid-b", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: FROZEN_MS,
      staleBindings: ["power"],
    });
    expect(detect([a, b], [])).toEqual({
      mode: "stale",
      sources: ["grid"],
      since: ago(FROZEN_MS),
    });
  });

  it("compares SQLite-flavoured timestamps by instant, not by string order", () => {
    // The API emits both `2026-08-30T15:49:01Z` and the SQLite-flavoured
    // `2026-08-30 15:49:01Z`. A lexicographic `<` sorts the space before the
    // `T` whatever the instants are, so here it would pick the NEWER reading.
    const grid = makeMeter("grid", "main_energy_meter", {
      status: "degraded",
      readingAgeMs: 20 * 60_000, // ISO, 14:57, the genuinely older one
      staleBindings: ["power"],
    });
    const solar = makeMeter("solar", "energy_production_meter", {
      status: "degraded",
      staleBindings: ["power"],
    });
    solar.dataBindings[0].lastUpdated = "2026-08-30 15:14:00Z"; // 3 min old
    expect(detect([grid], [solar])?.since).toBe(ago(20 * 60_000));
  });
});
