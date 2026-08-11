import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CapacityArbiter, trimmedMedian } from "./capacity-arbiter.js";
import { EventBus } from "../core/event-bus.js";
import type {
  CapacityClaimHandle,
  CapacityClaimRequest,
  EnergyLoadProfile,
  EngineEvent,
  Equipment,
} from "../shared/types.js";

// ============================================================
// Harness — fake settings + equipment manager, real EventBus.
// Meter convention: value is SIGNED grid power (+import / −export),
// so feedMeter(-1000) means "exporting 1 kW".
// ============================================================

const silentLogger = {
  child: () => silentLogger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
} as never;

interface FakeEquipment extends Equipment {
  energyProfile?: EnergyLoadProfile;
}

function makeHarness(opts?: {
  priority?: string[];
  settings?: Record<string, string>;
  profiles?: Record<string, EnergyLoadProfile | undefined>;
}) {
  const settingsMap = new Map<string, string>(
    Object.entries({
      "energy.arbiter.enabled": "true",
      "energy.arbiter.priority": JSON.stringify(opts?.priority ?? ["pac", "pump", "heater"]),
      // smoothing 1 s: the EMA settles within one 10 s tick, so tests reason
      // about holds, not about filter convergence.
      "energy.arbiter.smoothingS": "1",
      ...(opts?.settings ?? {}),
    }),
  );
  const settingsManager = {
    get: (k: string) => settingsMap.get(k),
    set: (k: string, v: string) => settingsMap.set(k, v),
  } as never;

  const base = (id: string, name: string, type: string): FakeEquipment =>
    ({
      id,
      name,
      zoneId: "z",
      type,
      enabled: true,
      createdAt: "",
      updatedAt: "",
    }) as FakeEquipment;

  const profiles: Record<string, EnergyLoadProfile | undefined> = {
    pac: { class: "comfort", nominalPowerW: 2000, minOnS: 900, minOffS: 600 },
    pump: { class: "deferrable", nominalPowerW: 600, minOnS: 900, minOffS: 300 },
    heater: { class: "deferrable", nominalPowerW: 2200, minOnS: 300, minOffS: 300 },
    ...(opts?.profiles ?? {}),
  };

  const equipments = new Map<string, FakeEquipment>([
    ["grid", base("grid", "Shelly Grid", "main_energy_meter")],
    ["solar", base("solar", "Shelly Solar", "energy_production_meter")],
    ["pac", { ...base("pac", "PAC", "thermostat"), energyProfile: profiles.pac }],
    ["pump", { ...base("pump", "Pompe Piscine", "pool_pump"), energyProfile: profiles.pump }],
    [
      "heater",
      { ...base("heater", "Chauffe-eau", "water_heater"), energyProfile: profiles.heater },
    ],
    ["lamp", base("lamp", "Lampe", "light_onoff")],
  ]);

  const bindings = new Map<string, Array<{ alias: string; category: string }>>([
    ["grid", [{ alias: "power", category: "power" }]],
    ["pac", [{ alias: "power", category: "power" }]],
    ["pump", [{ alias: "power", category: "power" }]],
    ["heater", [{ alias: "power", category: "power" }]],
  ]);

  const learnedCalls: Array<{ id: string; watts: number; runs: number }> = [];
  const equipmentManager = {
    getById: (id: string) => equipments.get(id) ?? null,
    getAll: () => [...equipments.values()],
    getDataBindingsWithValues: (id: string) => bindings.get(id) ?? [],
    setEnergyProfileLearned: (
      id: string,
      learned: { watts: number; atIso: string; runs: number },
    ) => {
      learnedCalls.push({ id, watts: learned.watts, runs: learned.runs });
      const e = equipments.get(id);
      if (e?.energyProfile) e.energyProfile = { ...e.energyProfile, learned };
    },
  } as never;

  const eventBus = new EventBus(silentLogger);
  const events: EngineEvent[] = [];
  eventBus.on((e) => {
    if (e.type.startsWith("energy.")) events.push(e);
  });

  const arbiter = new CapacityArbiter(eventBus, settingsManager, equipmentManager, silentLogger);
  arbiter.start();

  const feedMeter = (signedW: number) =>
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: "grid",
      alias: "power",
      value: signedW,
      previous: null,
    });
  const feedLoadPower = (equipmentId: string, w: number) =>
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId,
      alias: "power",
      value: w,
      previous: null,
    });
  const feedState = (equipmentId: string, on: boolean) =>
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId,
      alias: "state",
      value: on ? "ON" : "OFF",
      previous: null,
    });
  const order = (
    equipmentId: string,
    value: unknown,
    source: { kind: string; instanceId?: string },
  ) =>
    eventBus.emit({
      type: "equipment.order.executed",
      equipmentId,
      orderAlias: "power",
      value,
      source,
    } as EngineEvent);
  /** Advance in 10 s ticks, re-feeding the meter to keep it fresh. */
  const run = (signedW: number, seconds: number) => {
    for (let i = 0; i < Math.ceil(seconds / 10); i++) {
      vi.advanceTimersByTime(10_000);
      feedMeter(signedW);
    }
  };
  const claim = (
    instanceId: string,
    req: Partial<CapacityClaimRequest> & { equipmentId: string },
  ): CapacityClaimHandle =>
    arbiter.claim(instanceId, {
      onGranted: () => {},
      onRevoked: () => {},
      ...req,
    } as CapacityClaimRequest);
  const emitSettingsChanged = () =>
    eventBus.emit({ type: "settings.changed", keys: ["energy.arbiter.enabled"] });

  const revokedEvents = () =>
    events.filter((e) => e.type === "energy.capacity.revoked") as Array<
      Extract<EngineEvent, { type: "energy.capacity.revoked" }>
    >;
  const grantedEvents = () =>
    events.filter((e) => e.type === "energy.capacity.granted") as Array<
      Extract<EngineEvent, { type: "energy.capacity.granted" }>
    >;

  return {
    arbiter,
    eventBus,
    events,
    settingsMap,
    equipments,
    learnedCalls,
    feedMeter,
    feedLoadPower,
    feedState,
    order,
    run,
    claim,
    emitSettingsChanged,
    revokedEvents,
    grantedEvents,
  };
}

describe("helpers", () => {
  it("trimmedMedian drops the extreme quarters", () => {
    expect(trimmedMedian([600])).toBe(600);
    expect(trimmedMedian([100, 600, 620, 640, 5000])).toBe(620);
    expect(trimmedMedian([600, 640])).toBe(640);
  });
});

describe("capacity arbiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants a single claim once the surplus holds through engageHoldS", () => {
    const h = makeHarness();
    const granted = vi.fn();
    h.claim("i1", { equipmentId: "pump", onGranted: granted });
    h.feedMeter(-1000); // exporting 1 kW
    h.run(-1000, 60);
    expect(granted).not.toHaveBeenCalled(); // engage hold not elapsed
    h.run(-1000, 80);
    expect(granted).toHaveBeenCalledOnce();
    expect(h.grantedEvents()).toHaveLength(1);
    const state = h.arbiter.getPublicState();
    expect(state.grants[0]?.equipmentId).toBe("pump");
    expect(state.journal.some((j) => j.kind === "granted")).toBe(true);
  });

  it("keeps a claim pending when the surplus is below watts+margin", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" }); // needs 600+100
    h.feedMeter(-500);
    h.run(-500, 300);
    expect(h.grantedEvents()).toHaveLength(0);
    expect(h.arbiter.getPublicState().pending[0]?.reasonWaiting).toContain("insufficient-surplus");
  });

  it("does NOT revoke when its own grant collapses the export (reservation accounting)", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    expect(h.grantedEvents()).toHaveLength(1);
    // The pump physically starts: export drops to 400 W. Still exporting →
    // no deficit, whatever the hold. This is the anti-oscillation core.
    h.run(-400, 700);
    expect(h.revokedEvents()).toHaveLength(0);
    // availableSurplusW stays on the true surplus (export + reserved).
    expect(h.arbiter.getPublicState().availableSurplusW).toBe(1000);
  });

  it("a background surge revokes bottom-up after releaseHoldS", () => {
    const h = makeHarness();
    h.claim("pacI", { equipmentId: "pac" });
    h.claim("pumpI", { equipmentId: "pump" });
    h.run(-3000, 150); // both granted
    expect(h.grantedEvents()).toHaveLength(2);
    // Hob: the house now IMPORTS 2.4 kW sustained (long enough to clear the
    // per-type minOnS windows as well as the release hold).
    h.run(2400, 1100);
    const revs = h.revokedEvents();
    expect(revs.length).toBeGreaterThanOrEqual(1);
    expect(revs[0].equipmentId).toBe("pump"); // bottom of ["pac","pump"]
    expect(revs[0].reason).toBe("surplus-deficit");
  });

  it("cloud pass shorter than releaseHoldS never revokes", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.run(300, 300); // import for 5 min < releaseHold 600 s
    h.run(-800, 100); // sun returns
    expect(h.revokedEvents()).toHaveLength(0);
  });

  it("minOnS blocks revocation until elapsed (no short-cycling)", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" }); // minOnS 900
    h.run(-1000, 150);
    expect(h.grantedEvents()).toHaveLength(1);
    h.run(2000, 700); // deficit sustained past releaseHold, but minOn not elapsed
    expect(h.revokedEvents()).toHaveLength(0);
    h.run(2000, 300); // now past minOn (grant age > 900 s)
    expect(h.revokedEvents()).toHaveLength(1);
  });

  it("minOffS blocks a re-grant after a revocation", () => {
    const h = makeHarness({
      profiles: { pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 300 } },
    });
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.run(2000, 700);
    expect(h.revokedEvents()).toHaveLength(1);
    h.run(-1000, 200); // engage hold satisfied but min-off (300 s) not yet
    expect(h.grantedEvents()).toHaveLength(1);
    h.run(-1000, 300);
    expect(h.grantedEvents()).toHaveLength(2);
  });

  it("with surplus for one, the higher-priority pending claim does not stop the lower one", () => {
    const h = makeHarness();
    h.claim("pacI", { equipmentId: "pac" }); // needs 2100
    h.claim("pumpI", { equipmentId: "pump" }); // needs 700
    h.run(-800, 200);
    expect(h.grantedEvents()).toHaveLength(1);
    expect(h.grantedEvents()[0].equipmentId).toBe("pump");
  });

  it("a higher-priority claim preempts lower grants when the shortfall is coverable", () => {
    const h = makeHarness({
      profiles: {
        pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
      },
    });
    h.claim("pumpI", { equipmentId: "pump" });
    h.run(-800, 150); // pump granted
    expect(h.grantedEvents()[0].equipmentId).toBe("pump");
    h.claim("pacI", { equipmentId: "pac" }); // outranks pump, needs 2100
    h.run(-1600, 100); // headroom 1600 < 2100, shortfall 500 ≤ pump 600
    const revs = h.revokedEvents();
    expect(revs).toHaveLength(1);
    expect(revs[0].equipmentId).toBe("pump");
    expect(revs[0].reason).toBe("priority-preempted");
    // Pump physically stops → export recovers → pac granted.
    h.run(-2200, 150);
    expect(h.grantedEvents().map((e) => e.equipmentId)).toContain("pac");
  });

  it("manual order on a granted equipment revokes immediately and suspends", () => {
    const h = makeHarness();
    const revoked = vi.fn();
    h.claim("i1", { equipmentId: "pump", onRevoked: revoked });
    h.run(-1000, 150);
    h.order("pump", false, { kind: "manual", instanceId: undefined });
    expect(revoked).toHaveBeenCalledWith("manual-override");
    const denied = h.claim("i2", { equipmentId: "pump" });
    expect(denied.status()).toBe("denied");
    expect(denied.deniedReason).toBe("override-active");
    expect(h.arbiter.getPublicState().suspensions[0]?.equipmentId).toBe("pump");
  });

  it("a recipe order on a granted equipment does NOT suspend", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
    expect(h.revokedEvents()).toHaveLength(0);
  });

  it("resume lifts a suspension immediately", () => {
    const h = makeHarness();
    const first = h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.order("pump", false, { kind: "manual" });
    expect(h.arbiter.resumeEquipment("pump")).toBe(true);
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
    expect(h.arbiter.resumeEquipment("pump")).toBe(false); // nothing to lift
    first.release(); // the revoked claim still owns the equipment (FR-4)
    const again = h.claim("i2", { equipmentId: "pump" });
    expect(again.status()).toBe("pending");
  });

  it("meter silence revokes everything and degrades; fresh data re-arms", () => {
    const h = makeHarness();
    const revoked = vi.fn();
    h.claim("i1", { equipmentId: "pump", onRevoked: revoked });
    h.run(-1000, 150);
    expect(h.grantedEvents()).toHaveLength(1);
    vi.advanceTimersByTime(400_000); // > staleAfterS with no meter data
    expect(revoked).toHaveBeenCalledWith("meter-stale");
    expect(h.arbiter.getPublicState().state).toBe("degraded");
    expect(h.arbiter.getPublicState().availableSurplusW).toBeNull();
    // Fresh data → active again, and the still-pending claim can be served.
    h.run(-1000, 500); // min-off (300 s) then engage hold
    expect(h.arbiter.getPublicState().state).toBe("active");
    expect(h.grantedEvents()).toHaveLength(2);
  });

  it("disabling via settings revokes all with reason disabled", () => {
    const h = makeHarness();
    const revoked = vi.fn();
    h.claim("i1", { equipmentId: "pump", onRevoked: revoked });
    h.run(-1000, 150);
    h.settingsMap.set("energy.arbiter.enabled", "false");
    h.emitSettingsChanged();
    expect(revoked).toHaveBeenCalledWith("disabled");
    const denied = h.claim("i2", { equipmentId: "pump" });
    expect(denied.deniedReason).toBe("arbiter-disabled");
  });

  it("denies claims on non-profiled equipments and double claims", () => {
    const h = makeHarness();
    expect(h.claim("i1", { equipmentId: "lamp" }).deniedReason).toBe("not-profiled");
    const first = h.claim("i1", { equipmentId: "pump" });
    expect(first.status()).toBe("pending");
    expect(h.claim("i2", { equipmentId: "pump" }).deniedReason).toBe("equipment-already-claimed");
    first.release();
    expect(h.claim("i2", { equipmentId: "pump" }).status()).toBe("pending");
  });

  it("claim watts default to the profile nominal", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pac" }); // nominal 2000 → need 2100
    h.run(-1500, 300);
    expect(h.grantedEvents()).toHaveLength(0);
    h.run(-2200, 150);
    expect(h.grantedEvents()).toHaveLength(1);
  });

  it("revokes with reason disabled when the equipment is removed mid-grant", () => {
    const h = makeHarness();
    const revoked = vi.fn();
    h.claim("i1", { equipmentId: "pump", onRevoked: revoked });
    h.run(-1000, 150);
    h.equipments.delete("pump");
    h.eventBus.emit({
      type: "equipment.removed",
      equipmentId: "pump",
      equipmentName: "Pompe Piscine",
      zoneId: "z",
    });
    expect(revoked).toHaveBeenCalledWith("disabled");
  });

  it("a throwing recipe callback never breaks the arbiter", () => {
    const h = makeHarness();
    h.claim("i1", {
      equipmentId: "pump",
      onGranted: () => {
        throw new Error("recipe bug");
      },
    });
    h.run(-1000, 150);
    expect(h.grantedEvents()).toHaveLength(1);
    // Arbiter still functional afterwards:
    h.claim("i2", { equipmentId: "heater", toleratedImportW: 0 });
    h.run(-3000, 150);
    expect(h.grantedEvents()).toHaveLength(2);
  });

  it("journal is bounded", () => {
    const h = makeHarness();
    for (let i = 0; i < 230; i++) h.claim("i", { equipmentId: "lamp" }); // each denial journals
    expect(h.arbiter.getPublicState().journal.length).toBeLessThanOrEqual(200);
  });

  // ── Effective watts (FR-2, three tiers) ───────────────────

  it("a modulating load frees headroom as its live draw falls", () => {
    const h = makeHarness();
    h.claim("pacI", { equipmentId: "pac" });
    h.run(-2200, 150);
    expect(h.grantedEvents()[0].equipmentId).toBe("pac");
    // PAC ramps down to 1.2 kW → export rises accordingly; available stays
    // on the true surplus through the live-draw reservation.
    h.feedLoadPower("pac", 1200);
    h.run(-1000, 50);
    expect(h.arbiter.getPublicState().availableSurplusW).toBe(2200);
    // The freed headroom serves the pump without any release.
    h.claim("pumpI", { equipmentId: "pump" });
    h.run(-1000, 150);
    expect(h.grantedEvents().map((e) => e.equipmentId)).toContain("pump");
  });

  it("a silent clamp mid-grant falls back to learned/declared without a revocation", () => {
    const h = makeHarness();
    h.claim("pacI", { equipmentId: "pac" });
    h.run(-2200, 150);
    h.feedLoadPower("pac", 1800);
    // Clamp goes silent for > 120 s: tier 1 stale → falls back, no revoke.
    h.run(-300, 200);
    expect(h.revokedEvents()).toHaveLength(0);
  });

  it("watts-divergence is journaled once when measurement disagrees with the declared nominal", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" }); // nominal 600
    h.run(-1000, 150);
    h.feedLoadPower("pump", 900); // > 30 % off
    h.run(-400, 50);
    const entries = h.arbiter.getPublicState().journal.filter((j) => j.kind === "watts-divergence");
    expect(entries).toHaveLength(1);
    expect(entries[0].watts).toBe(900);
  });

  // ── Already-running claims & unclaimed runs (rule 5) ──────

  it("grants an already-running load through its own draw (review decision 11)", () => {
    const h = makeHarness({
      profiles: { pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 } },
    });
    // Recipe force-runs the pump (must-run): 600 W drawn, export only 200 W.
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    h.feedLoadPower("pump", 600);
    h.claim("i1", { equipmentId: "pump" });
    // headroom 200 + ownDraw 600 = 800 ≥ need 700 → grantable. The clamp
    // keeps reporting (freshness window is 120 s), like a real clamp would.
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(10_000);
      h.feedMeter(-200);
      h.feedLoadPower("pump", 600);
    }
    expect(h.grantedEvents()).toHaveLength(1);
    // Books become exact: available = export + live draw.
    expect(h.arbiter.getPublicState().availableSurplusW).toBe(800);
  });

  it("journals unclaimed-run once for a grantless recipe run", () => {
    const h = makeHarness();
    h.feedMeter(-100);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    h.order("pump", true, { kind: "recipe", instanceId: "i1" }); // repeat: no dup
    const entries = h.arbiter.getPublicState().journal.filter((j) => j.kind === "unclaimed-run");
    expect(entries).toHaveLength(1);
  });

  // ── Tolerated import & slack (FR-3) ───────────────────────

  it("toleratedImportW widens engage and narrows release by exactly that amount", () => {
    const h = makeHarness({ priority: ["heater"] });
    h.claim("i1", { equipmentId: "heater", toleratedImportW: 200 });
    // need = 2200 + 100 − 200 = 2100
    h.run(-2000, 300);
    expect(h.grantedEvents()).toHaveLength(0);
    h.run(-2150, 150);
    expect(h.grantedEvents()).toHaveLength(1);
    // Import within the tolerance is NOT a deficit…
    h.run(150, 700);
    expect(h.revokedEvents()).toHaveLength(0);
    // …beyond it, it is.
    h.run(400, 700);
    expect(h.revokedEvents()).toHaveLength(1);
  });

  it("slack high yields the surplus to a lower-priority none claim", () => {
    const h = makeHarness({
      priority: ["pump", "heater"],
      profiles: {
        pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
        heater: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
      },
    });
    h.claim("pumpI", { equipmentId: "pump", slack: "high" }); // top of list, steps down
    h.claim("heaterI", { equipmentId: "heater", slack: "none" });
    h.run(-800, 200); // fits exactly one 600 W load
    expect(h.grantedEvents()).toHaveLength(1);
    expect(h.grantedEvents()[0].equipmentId).toBe("heater");
  });

  // ── Signed accounting regression (review decision 10) ─────

  it("an import under active grants produces a positive deficit and a revocation", () => {
    const h = makeHarness({
      profiles: { pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 } },
    });
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    expect(h.grantedEvents()).toHaveLength(1);
    // House pulls 300 W off the grid, sustained. With the clamped-export
    // draft this deficit computed to zero and nothing ever revoked.
    h.run(300, 700);
    expect(h.revokedEvents()).toHaveLength(1);
    expect(h.revokedEvents()[0].reason).toBe("surplus-deficit");
  });

  // ── Unhonored revokes (review decision 12) ────────────────

  it("an unhonored revoke marks the load unresponsive and revokes nobody else", () => {
    const h = makeHarness({
      priority: ["pac", "pump"],
      profiles: {
        pac: { class: "comfort", nominalPowerW: 2000, minOnS: 0, minOffS: 0 },
        pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
      },
    });
    h.claim("pacI", { equipmentId: "pac" });
    h.claim("pumpI", { equipmentId: "pump" });
    h.run(-3000, 150);
    expect(h.grantedEvents()).toHaveLength(2);
    h.feedLoadPower("pump", 600);
    // Deficit of ~400 W: bottom-up revokes the pump only.
    h.run(400, 700);
    expect(h.revokedEvents()).toHaveLength(1);
    expect(h.revokedEvents()[0].equipmentId).toBe("pump");
    // The pump recipe never acts: draw stays, export never recovers. Keep
    // feeding its clamp so the excused-draw accounting sees fresh data.
    for (let i = 0; i < 130; i++) {
      vi.advanceTimersByTime(10_000);
      h.feedMeter(400);
      h.feedLoadPower("pump", 600);
    }
    const journal = h.arbiter.getPublicState().journal;
    expect(journal.some((j) => j.kind === "revoke-not-honored")).toBe(true);
    // The cascade is contained: the PAC keeps its grant.
    expect(h.revokedEvents().filter((e) => e.equipmentId === "pac")).toHaveLength(0);
  });

  // ── Wall-switch divergence (FR-6, review decision 16) ─────

  it("a granted load reported OFF at the wall is revoked and suspended", () => {
    const h = makeHarness();
    const revoked = vi.fn();
    h.claim("i1", { equipmentId: "pump", onRevoked: revoked });
    h.run(-1000, 150);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" }); // recipe turned it on
    h.feedState("pump", false); // somebody flips the selector on the box
    h.run(-400, 80); // > divergenceConfirmS
    expect(revoked).toHaveBeenCalledWith("manual-override");
    expect(h.arbiter.getPublicState().suspensions[0]?.equipmentId).toBe("pump");
  });

  it("a load forced ON at the wall outside arbitration is suspended", () => {
    const h = makeHarness();
    h.feedMeter(-100);
    h.feedState("pump", true); // no grant, no recipe order
    h.run(-100, 80);
    expect(h.arbiter.getPublicState().suspensions[0]?.equipmentId).toBe("pump");
  });

  it("a recipe's own OFF order is not a wall event", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.order("pump", false, { kind: "recipe", instanceId: "i1" });
    h.feedState("pump", false);
    h.run(-1000, 80);
    // No manual-override revocation: the recipe did it, not the wall.
    expect(h.revokedEvents().filter((e) => e.reason === "manual-override")).toHaveLength(0);
  });

  // ── Comfort audit (review decision 3) ─────────────────────

  it("journals comfort-off-after-revoke when the claiming recipe kills a comfort load", () => {
    const h = makeHarness({
      profiles: { pac: { class: "comfort", nominalPowerW: 2000, minOnS: 0, minOffS: 0 } },
    });
    h.claim("pacI", { equipmentId: "pac" });
    h.run(-2200, 150);
    h.run(500, 700); // deficit → revoked
    expect(h.revokedEvents()).toHaveLength(1);
    h.order("pac", false, { kind: "recipe", instanceId: "pacI" });
    expect(
      h.arbiter.getPublicState().journal.some((j) => j.kind === "comfort-off-after-revoke"),
    ).toBe(true);
  });

  // ── Learner (review decision 17) ──────────────────────────

  it("learns a trimmed median from sustained samples on run end", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    for (const w of [600, 640, 620, 610, 630]) h.feedLoadPower("pump", w);
    h.arbiter.releaseAllFor("i1");
    expect(h.learnedCalls).toHaveLength(1);
    expect(h.learnedCalls[0].id).toBe("pump");
    expect(h.learnedCalls[0].watts).toBeGreaterThanOrEqual(610);
    expect(h.learnedCalls[0].watts).toBeLessThanOrEqual(630);
    expect(h.learnedCalls[0].runs).toBe(1);
  });

  it("ignores sub-threshold samples so a thermostatic load keeps a correct profile", () => {
    const h = makeHarness({ priority: ["heater"] });
    h.claim("i1", { equipmentId: "heater" }); // nominal 2200, floor 550
    h.run(-2500, 150);
    for (const w of [2200, 2150, 0, 0, 3, 2180]) h.feedLoadPower("heater", w);
    h.arbiter.releaseAllFor("i1");
    expect(h.learnedCalls).toHaveLength(1);
    expect(h.learnedCalls[0].watts).toBeGreaterThanOrEqual(2150);
    // And no watts-divergence: the sustained draw matches the profile.
    expect(h.arbiter.getPublicState().journal.some((j) => j.kind === "watts-divergence")).toBe(
      false,
    );
  });

  // ── Instance lifecycle ────────────────────────────────────

  it("releaseAllFor releases only that instance's claims", () => {
    const h = makeHarness();
    h.claim("a", { equipmentId: "pump" });
    h.claim("b", { equipmentId: "pac" });
    h.run(-3000, 150);
    expect(h.grantedEvents()).toHaveLength(2);
    h.arbiter.releaseAllFor("a");
    const state = h.arbiter.getPublicState();
    expect(state.grants.map((g) => g.equipmentId)).toEqual(["pac"]);
    expect(h.events.filter((e) => e.type === "energy.capacity.released")).toHaveLength(1);
  });

  // ── Zero-behavior default (acceptance) ────────────────────

  it("disabled arbiter with no profiles produces no events and denies claims", () => {
    const h = makeHarness({ settings: { "energy.arbiter.enabled": "false" } });
    h.run(-2000, 300);
    expect(h.events.filter((e) => e.type !== "energy.arbiter.status")).toHaveLength(0);
    expect(h.claim("i", { equipmentId: "pump" }).deniedReason).toBe("arbiter-disabled");
  });

  // ── The heat-wave day, end to end (worked example 3) ──────

  it("replays the two-consumer day without synchronized oscillation", () => {
    const h = makeHarness({
      priority: ["pac", "pump"],
      profiles: {
        pac: { class: "comfort", nominalPowerW: 2000, minOnS: 0, minOffS: 0 },
        pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
      },
    });
    h.claim("pacI", { equipmentId: "pac" });
    h.claim("pumpI", { equipmentId: "pump" });
    // Morning ramp: both granted.
    h.run(-3000, 200);
    expect(h.grantedEvents()).toHaveLength(2);
    // Both loads run: export collapses to near zero for half an hour. The
    // old per-recipe threshold logic oscillated here; the arbiter must not.
    h.run(-50, 1800);
    expect(h.revokedEvents()).toHaveLength(0);
    // Lunch hob: +2.8 kW import sustained → bottom-up revocations.
    h.run(2800, 700);
    const lunchtime = h.revokedEvents();
    expect(lunchtime.length).toBeGreaterThanOrEqual(1);
    expect(lunchtime[0].equipmentId).toBe("pump");
    // Hob off, sun still up: pump re-granted, exactly one grant per load —
    // no grant/revoke churn.
    h.run(-1200, 300);
    const grantsPerEq = h.grantedEvents().reduce<Record<string, number>>((acc, e) => {
      acc[e.equipmentId] = (acc[e.equipmentId] ?? 0) + 1;
      return acc;
    }, {});
    expect(grantsPerEq.pump).toBeLessThanOrEqual(2);
    expect(grantsPerEq.pac).toBeLessThanOrEqual(2);
  });
});
