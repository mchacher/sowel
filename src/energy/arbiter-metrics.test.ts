import { describe, it, expect } from "vitest";
import { rollupDay, type RollupInput, type RollupLoad } from "./arbiter-metrics.js";
import type { ArbiterDecision, ArbiterDecisionKind } from "../shared/types.js";
import type { SurplusSample } from "./arbiter-surplus-store.js";

// Spec 158 — the pure daily rollup. Every scenario in the spec's test plan
// lands here: no DB, no clock, so the arithmetic is checked directly.

const TZ = "Europe/Paris";

/** Local midnight of a YYYY-MM-DD, in the pinned test timezone. */
function midnight(day: string): number {
  process.env.TZ = TZ;
  const d = new Date(`${day}T00:00:00`);
  return d.getTime();
}

function at(day: string, hhmm: string): number {
  process.env.TZ = TZ;
  return new Date(`${day}T${hhmm}:00`).getTime();
}

function decision(atMs: number, kind: ArbiterDecisionKind, over: Partial<ArbiterDecision> = {}) {
  return {
    atIso: new Date(atMs).toISOString(),
    kind,
    equipmentId: "pump",
    ...over,
  } satisfies ArbiterDecision;
}

function load(over: Partial<RollupLoad> = {}): RollupLoad {
  return { equipmentId: "pump", minOnS: 1800, needW: 700, deferrable: true, ...over };
}

function input(over: Partial<RollupInput> = {}): RollupInput {
  return {
    dayStartMs: midnight("2026-08-20"),
    dayEndMs: midnight("2026-08-21"),
    decisions: [],
    surplus: [],
    loads: [load()],
    releaseHoldS: 600,
    overrideTtlS: 7200,
    ...over,
  };
}

function pumpRow(result: ReturnType<typeof rollupDay>) {
  const row = result.loads.find((l) => l.equipmentId === "pump");
  if (!row) throw new Error("pump row missing");
  return row;
}

describe("rollupDay — counts and short cycles", () => {
  it("counts a normal grant/revoke and no short cycle", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "12:00"), "revoked"),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.grants).toBe(1);
    expect(row.revokes).toBe(1);
    expect(row.shortCycles).toBe(0);
    expect(row.grantedS).toBe(7200);
  });

  it("flags a grant revoked inside minOnS + releaseHoldS as a short cycle", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "10:05"), "revoked", { reason: "surplus-deficit" }),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.shortCycles).toBe(1);
    expect(row.grantedS).toBe(300);
  });

  it("spec 164 — a grant nothing consumed still counts as granted time", () => {
    // The ribbon paints those hours differently; the metric must not change,
    // or every `grantedS` row silently re-baselines against spec 158.
    const withDrawEvents = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "10:05"), "draw-stopped"),
          decision(at("2026-08-20", "11:30"), "draw-started"),
          decision(at("2026-08-20", "12:00"), "revoked", { reason: "surplus-deficit" }),
        ],
      }),
    );
    const withoutDrawEvents = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "12:00"), "revoked", { reason: "surplus-deficit" }),
        ],
      }),
    );
    expect(pumpRow(withDrawEvents).grantedS).toBe(7200);
    expect(pumpRow(withDrawEvents).grantedS).toBe(pumpRow(withoutDrawEvents).grantedS);
  });

  it("spec 164 — draw events are neither grants nor revocations", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "10:05"), "draw-stopped"),
          decision(at("2026-08-20", "11:30"), "draw-started"),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.grants).toBe(1);
    expect(row.revokes).toBe(0);
  });

  it("does NOT count a recipe-side release as a short cycle", () => {
    // `released` is the recipe giving the surplus back on its own. Counting it
    // would make the regret metric meaningless.
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "10:05"), "released"),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.shortCycles).toBe(0);
    expect(row.revokes).toBe(0);
  });

  it("attributes a short cycle to the day the grant started on", () => {
    // Grant at 23:58, revoke at 00:03 the next day: it is day 20's short cycle.
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "23:58"), "granted"),
          decision(at("2026-08-21", "00:03"), "revoked", { reason: "surplus-deficit" }),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.grants).toBe(1);
    expect(row.shortCycles).toBe(1);
    // Only the 2 minutes before midnight belong to this day.
    expect(row.grantedS).toBe(120);
  });
});

describe("rollupDay — span accounting", () => {
  it("clips a span crossing midnight to each day", () => {
    const decisions = [
      decision(at("2026-08-20", "23:00"), "granted"),
      decision(at("2026-08-21", "01:00"), "revoked"),
    ];
    const day20 = pumpRow(rollupDay(input({ decisions })));
    const day21 = pumpRow(
      rollupDay(
        input({
          decisions,
          dayStartMs: midnight("2026-08-21"),
          dayEndMs: midnight("2026-08-22"),
        }),
      ),
    );
    expect(day20.grantedS).toBe(3600);
    expect(day21.grantedS).toBe(3600);
  });

  it("honours the state entering the day (last decision before the window)", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-19", "22:00"), "granted"),
          decision(at("2026-08-20", "02:00"), "revoked"),
        ],
      }),
    );
    expect(pumpRow(result).grantedS).toBe(7200); // midnight to 02:00
  });

  it("counts an open span up to dayEndMs, not beyond", () => {
    // dayEndMs is what the caller clamps to `now` for the current day.
    const result = rollupDay(
      input({
        decisions: [decision(at("2026-08-20", "09:00"), "granted")],
        dayEndMs: at("2026-08-20", "11:00"),
      }),
    );
    expect(pumpRow(result).grantedS).toBe(7200);
  });

  it("accumulates pending time before a grant", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "waiting"),
          decision(at("2026-08-20", "10:30"), "granted"),
          decision(at("2026-08-20", "11:00"), "revoked"),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.pendingS).toBe(1800);
    expect(row.grantedS).toBe(1800);
  });

  it("tracks a suspension that leaves the load running as unmanaged AND suspended", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "suspended", { running: true }),
          decision(at("2026-08-20", "11:00"), "resumed", { running: false }),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.unmanagedS).toBe(3600);
    expect(row.suspendedS).toBe(3600);
  });

  it("does not paint a suspension that left the load off as unmanaged", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "suspended", { running: false }),
          decision(at("2026-08-20", "11:00"), "resumed", { running: false }),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.unmanagedS).toBe(0);
    expect(row.suspendedS).toBe(3600);
  });

  it("closes an open span at a restart reset, with no phantom seconds", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "10:30"), "reset"),
        ],
      }),
    );
    expect(pumpRow(result).grantedS).toBe(1800);
  });

  it("ignores audit-only events, which are not state transitions", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "10:30"), "watts-divergence"),
          decision(at("2026-08-20", "11:00"), "revoked"),
        ],
      }),
    );
    expect(pumpRow(result).grantedS).toBe(3600);
  });

  it("returns zeroed rows for a load with no decisions at all", () => {
    const row = pumpRow(rollupDay(input()));
    expect(row).toMatchObject({ grants: 0, revokes: 0, shortCycles: 0, grantedS: 0 });
  });
});

describe("rollupDay — home level", () => {
  const sample = (hhmm: string, w: number): SurplusSample => ({
    at: at("2026-08-20", hhmm),
    availableW: w,
  });

  it("integrates export and import over the 5-min cadence", () => {
    const result = rollupDay(input({ surplus: [sample("12:00", 1200), sample("12:05", -600)] }));
    expect(result.home.exportWh).toBeCloseTo(100, 1); // 1200 W over 5 min
    expect(result.home.importWh).toBeCloseTo(50, 1);
    expect(result.home.samples).toBe(2);
  });

  it("counts export as an idle opportunity when a deferrable load's needW was covered", () => {
    const result = rollupDay(input({ surplus: [sample("12:00", 1000)] }));
    expect(result.home.idleClaimableExportWh).toBeCloseTo((1000 * 300) / 3600, 1);
    // Nobody was claiming it, so it is NOT the arbiter's miss.
    expect(result.home.waitingExportWh).toBe(0);
  });

  it("ignores an idle COMFORT load: nobody asked it to run", () => {
    // Measured on the reference installation: counting comfort loads made the
    // figure read 75 % of all export "missed", two thirds of which was a heat
    // pump idle because the house was already comfortable.
    const result = rollupDay(
      input({ surplus: [sample("12:00", 3000)], loads: [load({ deferrable: false })] }),
    );
    expect(result.home.idleClaimableExportWh).toBe(0);
    expect(result.home.exportWh).toBeGreaterThan(0);
  });

  it("counts export as the arbiter's miss while a load is WAITING for it", () => {
    const result = rollupDay(
      input({
        surplus: [sample("12:00", 1000)],
        decisions: [decision(at("2026-08-20", "09:00"), "waiting")],
      }),
    );
    expect(result.home.waitingExportWh).toBeCloseTo((1000 * 300) / 3600, 1);
  });

  it("counts a waiting COMFORT load too: it did ask", () => {
    const result = rollupDay(
      input({
        surplus: [sample("12:00", 1000)],
        loads: [load({ deferrable: false })],
        decisions: [decision(at("2026-08-20", "09:00"), "waiting")],
      }),
    );
    expect(result.home.waitingExportWh).toBeGreaterThan(0);
    expect(result.home.idleClaimableExportWh).toBe(0);
  });

  it("does not count export as missed while the load is granted", () => {
    const result = rollupDay(
      input({
        surplus: [sample("12:00", 1000)],
        decisions: [decision(at("2026-08-20", "09:00"), "granted")],
      }),
    );
    expect(result.home.idleClaimableExportWh).toBe(0);
    expect(result.home.waitingExportWh).toBe(0);
    expect(result.home.exportWh).toBeGreaterThan(0);
  });

  it("spec 164 — a grant nothing consumed is still not an idle opportunity", () => {
    // The arbiter DID allocate the surplus to the load: counting it here as
    // "nobody seized it" would silently re-baseline the spec 158 figure the
    // moment the two new kinds start being journaled (FR-7).
    const result = rollupDay(
      input({
        surplus: [sample("12:00", 1000)],
        decisions: [
          decision(at("2026-08-20", "09:00"), "granted"),
          decision(at("2026-08-20", "09:10"), "draw-stopped"),
        ],
      }),
    );
    expect(result.home.idleClaimableExportWh).toBe(0);
  });

  it("does not count export the surplus could not have served", () => {
    const result = rollupDay(
      input({ surplus: [sample("12:00", 500)], loads: [load({ needW: 1500 })] }),
    );
    expect(result.home.idleClaimableExportWh).toBe(0);
  });

  it("does not count a load running outside arbitration as a missed chance", () => {
    // "unmanaged" means the load IS drawing, just not under arbitration.
    const result = rollupDay(
      input({
        surplus: [sample("12:00", 1000)],
        decisions: [decision(at("2026-08-20", "09:00"), "unclaimed-run")],
      }),
    );
    expect(result.home.idleClaimableExportWh).toBe(0);
  });

  it("reads the right state when samples arrive out of order", () => {
    // The cursor requires ascending instants; rollupDay sorts before sweeping.
    // Unsorted input must not make a granted load read as idle.
    const result = rollupDay(
      input({
        surplus: [sample("14:00", 1000), sample("10:00", 1000)],
        decisions: [decision(at("2026-08-20", "12:00"), "granted")],
      }),
    );
    // 10:00 is before the grant (missed), 14:00 is after it (not missed).
    expect(result.home.idleClaimableExportWh).toBeCloseTo((1000 * 300) / 3600, 1);
    expect(result.home.exportWh).toBeCloseTo((2 * 1000 * 300) / 3600, 1);
  });

  it("reports the real sample coverage of a partial day", () => {
    const result = rollupDay(input({ surplus: [sample("12:00", 100), sample("12:05", 100)] }));
    expect(result.home.samples).toBe(2);
  });

  it("ignores samples outside the day window", () => {
    const result = rollupDay(
      input({
        surplus: [{ at: at("2026-08-19", "12:00"), availableW: 5000 }, sample("12:00", 100)],
      }),
    );
    expect(result.home.samples).toBe(1);
  });

  it("handles an all-importing day", () => {
    const result = rollupDay(input({ surplus: [sample("08:00", -900)] }));
    expect(result.home.exportWh).toBe(0);
    expect(result.home.idleClaimableExportWh).toBe(0);
    expect(result.home.importWh).toBeGreaterThan(0);
  });
});

describe("rollupDay — DST days", () => {
  it("integrates the real span of a 23 h day", () => {
    // Europe/Paris springs forward on 2026-03-29: that local day is 23 h.
    process.env.TZ = TZ;
    const dayStart = midnight("2026-03-29");
    const dayEnd = midnight("2026-03-30");
    expect(dayEnd - dayStart).toBe(23 * 3_600_000);

    const result = rollupDay({
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      decisions: [
        {
          atIso: new Date(dayStart).toISOString(),
          kind: "granted",
          equipmentId: "pump",
        },
      ],
      surplus: [],
      loads: [load()],
      releaseHoldS: 600,
      overrideTtlS: 7200,
    });
    expect(pumpRow(result).grantedS).toBe(23 * 3600);
  });

  it("integrates the real span of a 25 h day", () => {
    // Europe/Paris falls back on 2026-10-25: that local day is 25 h.
    process.env.TZ = TZ;
    const dayStart = midnight("2026-10-25");
    const dayEnd = midnight("2026-10-26");
    expect(dayEnd - dayStart).toBe(25 * 3_600_000);

    const result = rollupDay({
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      decisions: [
        { atIso: new Date(dayStart).toISOString(), kind: "granted", equipmentId: "pump" },
      ],
      surplus: [],
      loads: [load()],
      releaseHoldS: 600,
      overrideTtlS: 7200,
    });
    expect(pumpRow(result).grantedS).toBe(25 * 3600);
  });
});

describe("rollupDay — revoke counting (review finding)", () => {
  it("does not count revoke-not-honored as a second revocation", () => {
    // The arbiter journals `revoke-not-honored` ON TOP of the `revoked` it
    // already wrote, when the load did not actually stop. One revocation.
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "12:00"), "revoked", { reason: "surplus-deficit" }),
          decision(at("2026-08-20", "12:10"), "revoke-not-honored"),
        ],
      }),
    );
    const row = pumpRow(result);
    expect(row.grants).toBe(1);
    expect(row.revokes).toBe(1);
  });

  it("does not let a lone revoke-not-honored invent a revocation after midnight", () => {
    const result = rollupDay(
      input({
        decisions: [decision(at("2026-08-20", "00:10"), "revoke-not-honored")],
      }),
    );
    expect(pumpRow(result).revokes).toBe(0);
  });
});

describe("rollupDay — short cycles only for a genuine surplus deficit", () => {
  const grantThenRevoke = (reason: string) =>
    pumpRow(
      rollupDay(
        input({
          decisions: [
            decision(at("2026-08-20", "10:00"), "granted"),
            decision(at("2026-08-20", "10:05"), "revoked", { reason }),
          ],
        }),
      ),
    );

  it("counts a surplus-deficit revoke", () => {
    expect(grantThenRevoke("surplus-deficit").shortCycles).toBe(1);
  });

  it("does not count a manual override as arbiter regret", () => {
    // The user flipping the wall switch 5 minutes after a grant is not the
    // arbiter misjudging the surplus.
    const row = grantThenRevoke("manual-override");
    expect(row.shortCycles).toBe(0);
    expect(row.revokes).toBe(1);
  });

  it("does not count meter-stale or disabled", () => {
    expect(grantThenRevoke("meter-stale").shortCycles).toBe(0);
    expect(grantThenRevoke("disabled").shortCycles).toBe(0);
  });

  it("does not count a deliberate preemption", () => {
    expect(grantThenRevoke("priority-preempted").shortCycles).toBe(0);
  });

  it("does not count a revoke beyond minOnS + releaseHoldS", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "granted"),
          decision(at("2026-08-20", "12:00"), "revoked", { reason: "surplus-deficit" }),
        ],
      }),
    );
    expect(pumpRow(result).shortCycles).toBe(0);
  });
});

describe("rollupDay — a suspension left open by a restart", () => {
  it("bounds an unclosed suspension to the override TTL", () => {
    // A manual override at 18:00 then a container restart: `overridesUntil` is
    // in-memory, so nothing closes the suspension in the journal. Without the
    // bound it would bill the rest of the day.
    const result = rollupDay(
      input({
        decisions: [decision(at("2026-08-20", "18:00"), "suspended", { running: true })],
        overrideTtlS: 7200,
      }),
    );
    const row = pumpRow(result);
    expect(row.suspendedS).toBe(7200);
    expect(row.unmanagedS).toBe(7200); // and the unmanaged span stops there too
  });

  it("does not carry an unclosed suspension into the next day", () => {
    const decisions = [decision(at("2026-08-20", "18:00"), "suspended", { running: true })];
    const nextDay = pumpRow(
      rollupDay(
        input({
          decisions,
          dayStartMs: midnight("2026-08-21"),
          dayEndMs: midnight("2026-08-22"),
        }),
      ),
    );
    expect(nextDay.suspendedS).toBe(0);
    expect(nextDay.unmanagedS).toBe(0);
  });

  it("lets a real closing event win over the TTL bound", () => {
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "10:00"), "suspended", { running: true }),
          decision(at("2026-08-20", "10:30"), "resumed", { running: false }),
        ],
      }),
    );
    expect(pumpRow(result).suspendedS).toBe(1800);
  });

  it("never cuts short a grant that follows a lost suspension", () => {
    // After a restart the suspension is gone, so the arbiter can grant again.
    // The synthetic TTL expiry must not fire and end that grant.
    const result = rollupDay(
      input({
        decisions: [
          decision(at("2026-08-20", "08:00"), "suspended", { running: true }),
          decision(at("2026-08-20", "09:00"), "granted"),
          decision(at("2026-08-20", "13:00"), "revoked", { reason: "surplus-deficit" }),
        ],
        overrideTtlS: 7200, // would have expired at 10:00, mid-grant
      }),
    );
    const row = pumpRow(result);
    expect(row.grantedS).toBe(4 * 3600);
    expect(row.suspendedS).toBe(3600); // 08:00 to the grant at 09:00
  });
});
