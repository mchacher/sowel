import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CapacityArbiter, trimmedMedian } from "./capacity-arbiter.js";
import { EventBus } from "../core/event-bus.js";
import { RETRY_CHANNEL } from "../equipments/order-confirmation-tracker.js";
import type {
  ArbiterDecision,
  ArbiterDecisionKind,
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
  bindings?: Record<string, Array<{ alias: string; category: string; value?: unknown }>>;
  shadow?: boolean;
  /** Seed a fake persisted journal store (#543 restart tests). Entries must be
   *  chronological; the fake mimics ArbiterJournalStore ordering (loadRecent =
   *  most recent `limit` ascending, range = ascending within [from, to]). */
  journal?: ArbiterDecision[];
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

  // Loads expose their power measurement plus a conventional "state" binding
  // (plugs/switches categorise state as generic) — isStateAlias resolves the
  // latter, so feedState() drives the arbiter's on/off observation (#535).
  const bindings = new Map<string, Array<{ alias: string; category: string; value?: unknown }>>([
    ["grid", [{ alias: "power", category: "power" }]],
    [
      "pac",
      [
        { alias: "power", category: "power" },
        { alias: "state", category: "generic" },
      ],
    ],
    [
      "pump",
      [
        { alias: "power", category: "power" },
        { alias: "state", category: "generic" },
      ],
    ],
    [
      "heater",
      [
        { alias: "power", category: "power" },
        { alias: "state", category: "generic" },
      ],
    ],
  ]);
  for (const [id, list] of Object.entries(opts?.bindings ?? {})) bindings.set(id, list);

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

  // The arbiter gets a capturing logger so tests can observe behavior that
  // has no other public surface (#543 — the deleted-equipment skip).
  const logLines: Array<{ ctx: unknown; msg: string | undefined }> = [];
  const capturingLogger = {
    child: () => capturingLogger,
    info: (ctx: unknown, msg?: string) => logLines.push({ ctx, msg }),
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
  } as never;

  const journalRows: ArbiterDecision[] = [...(opts?.journal ?? [])];
  const journalStore = opts?.journal
    ? ({
        insert: (d: ArbiterDecision) => journalRows.push(d),
        loadRecent: (limit: number) => journalRows.slice(-limit),
        range: (fromIso: string, toIso: string) =>
          journalRows.filter((d) => d.atIso >= fromIso && d.atIso <= toIso),
        purgeOlderThan: () => 0,
      } as never)
    : undefined;

  const arbiter = new CapacityArbiter(
    eventBus,
    settingsManager,
    equipmentManager,
    capturingLogger,
    opts?.shadow ?? false,
    journalStore,
  );
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
    source: { kind: string; instanceId?: string; channel?: string },
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
    journalRows,
    logLines,
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

  it("exposes the configured priority order for the roster table (#616)", () => {
    const h = makeHarness({ priority: ["heater", "pac", "pump"] });
    expect(h.arbiter.getPublicState().priority).toEqual(["heater", "pac", "pump"]);
  });

  it("keeps a claim pending when the surplus is below watts+margin", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" }); // needs 600+100
    h.feedMeter(-500);
    h.run(-500, 300);
    expect(h.grantedEvents()).toHaveLength(0);
    expect(h.arbiter.getPublicState().pending[0]?.reasonWaiting).toContain("insufficient-surplus");
  });

  it("publishes the surplus a pending claim waits for, not the load's own draw", () => {
    // The two differ by whatever grid the claim tolerates, and the UI quotes
    // this figure: a 600 W load willing to buy 400 W engages at 300 W, and
    // showing 600 there reads as "it will never start".
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump", toleratedImportW: 400 });
    h.feedMeter(-200);
    h.run(-200, 300);
    const [pending] = h.arbiter.getPublicState().pending;
    expect(pending?.watts).toBe(600);
    expect(pending?.needW).toBe(300); // 600 + 100 margin - 400 tolerated
  });

  it("resolves toleratedImportW from the equipment profile when the claim omits it (#550)", () => {
    const h = makeHarness({
      profiles: {
        pump: {
          class: "deferrable",
          nominalPowerW: 600,
          minOnS: 900,
          minOffS: 300,
          toleratedImportW: 400,
        },
      },
    });
    h.claim("i1", { equipmentId: "pump" }); // claim omits toleratedImportW
    // 300 W export is short of 700 (600 + 100) without tolerance, but the
    // profile's 400 W tolerance drops the need to 300 W → it engages.
    h.run(-300, 300);
    expect(h.grantedEvents()).toHaveLength(1);
    expect(h.arbiter.getPublicState().grants[0]?.equipmentId).toBe("pump");
  });

  it("a claim's explicit toleratedImportW overrides the equipment profile (#550)", () => {
    const h = makeHarness({
      profiles: {
        pump: {
          class: "deferrable",
          nominalPowerW: 600,
          minOnS: 900,
          minOffS: 300,
          toleratedImportW: 400,
        },
      },
    });
    h.claim("i1", { equipmentId: "pump", toleratedImportW: 0 }); // override: no tolerance
    // 500 W export WOULD engage the profile's 400 W tolerance (need 300), but the
    // claim overrides to 0 (need 700) so it stays pending — the override wins over
    // a would-engage profile (guards the `claim ?? profile` order, not `profile ?? claim`).
    h.run(-500, 300);
    expect(h.grantedEvents()).toHaveLength(0);
    const [pending] = h.arbiter.getPublicState().pending;
    expect(pending?.toleratedImportW).toBe(0);
    expect(pending?.needW).toBe(700); // 600 + 100 - 0, the profile's 400 is ignored
  });

  it("flags a pending claim as running when its load runs as a recipe must-run fallback (#491)", () => {
    // A recipe keeps a surplus claim but runs the load anyway (hot day). With
    // no surplus the claim stays pending, yet the load draws power — it must
    // read as running-without-surplus, not "waiting for surplus".
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.feedMeter(-500);
    h.run(-500, 300);
    // The claim is pending and idle so far.
    expect(h.arbiter.getPublicState().pending[0]?.running).toBe(false);

    // The recipe turns the load on outside a grant (must-run fallback).
    h.order("pump", "ON", { kind: "recipe", instanceId: "i1" });
    const [pending] = h.arbiter.getPublicState().pending;
    expect(pending?.equipmentId).toBe("pump");
    expect(pending?.running).toBe(true);

    // When the recipe switches it back off, it reads as waiting again.
    h.order("pump", "OFF", { kind: "recipe", instanceId: "i1" });
    expect(h.arbiter.getPublicState().pending[0]?.running).toBe(false);
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
    // #563 — the DISPLAYED figure is the true grid balance (exportW), so the
    // grant's own draw legitimately dents it: still exporting 400 W. The
    // no-revoke behaviour above is what reservation accounting protects.
    expect(h.arbiter.getPublicState().availableSurplusW).toBe(400);
  });

  it("shows a deficit while importing, not a phantom surplus equal to production (#563)", () => {
    // The bug: a home importing 1.2 kW while its managed loads soak up all of
    // the production read as "Actif +1.3 kW" (≈ production) because the pill
    // showed the reservation availableW (export + reserved), which stays
    // positive as long as the reclaimable reserved draw exceeds the import.
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150); // granted while exporting 1 kW
    expect(h.grantedEvents()).toHaveLength(1);
    // Clouds roll in: the granted pump keeps drawing ~600 W but the meter now
    // IMPORTS 400 W. The pump stays granted — its minOnS (900 s) anti-short-
    // cycle floor is far from elapsed — exactly the screenshot state.
    h.feedLoadPower("pump", 600);
    h.run(400, 30); // settle the EMA on the import
    const st = h.arbiter.getPublicState();
    expect(st.grants).toHaveLength(1); // still granted (minOn protects it)
    // Reservation availableW here would be export(-400) + reserved(600) = +200,
    // a phantom surplus. The fix reports the true grid balance: a 400 W deficit.
    expect(st.availableSurplusW).toBe(-400);
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

  it("does not list a suspended load in BOTH pending and suspensions", () => {
    // A claim that was still pending (insufficient surplus) when a wall-switch-on
    // override fires lingers as pending — `suspend()` only revokes GRANTED
    // claims. The read model must surface the load once ("Suspendu"), not also
    // as "En attente (override-active)". Regression: prod showed "Pompe Piscine"
    // twice at once.
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" }); // needs 600+100
    h.feedMeter(-200); // below engage threshold → stays pending
    h.run(-200, 300);
    expect(h.arbiter.getPublicState().pending[0]?.equipmentId).toBe("pump");
    // User turns the pump on at the wall while it is still pending.
    h.order("pump", true, { kind: "manual", instanceId: undefined });
    const state = h.arbiter.getPublicState();
    expect(state.suspensions.map((s) => s.equipmentId)).toEqual(["pump"]);
    expect(state.pending.map((p) => p.equipmentId)).not.toContain("pump");
  });

  it("a recipe order on a granted equipment does NOT suspend", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
    expect(h.revokedEvents()).toHaveLength(0);
  });

  // #420 — after a device reconnect the confirmation tracker re-dispatches
  // Sowel's OWN last unconfirmed order (typically a recipe order) as
  // { kind: "external", channel: "delivery-retry" }. That is not a human
  // action: it must neither suspend arbitration nor revoke a live grant.
  it("an external delivery-retry re-dispatch does NOT suspend a granted load", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150); // pump granted
    h.order("pump", true, { kind: "external", channel: RETRY_CHANNEL });
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
    expect(h.revokedEvents()).toHaveLength(0);
  });

  it("a non-retry external order still suspends (genuine external control)", () => {
    const h = makeHarness();
    h.order("pump", true, { kind: "external", channel: "home-assistant" });
    expect(h.arbiter.getPublicState().suspensions[0]?.equipmentId).toBe("pump");
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
    // PAC ramps down to 1.2 kW → export rises accordingly. #563 — the
    // displayed figure is the true grid balance (exportW): now exporting 1 kW.
    h.feedLoadPower("pac", 1200);
    h.run(-1000, 50);
    expect(h.arbiter.getPublicState().availableSurplusW).toBe(1000);
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
    // #563 — displayed figure is the true grid balance (exportW): 200 W export.
    // The own-draw reservation (used internally so the grant holds) is not
    // added to the user-facing surplus any more.
    expect(h.arbiter.getPublicState().availableSurplusW).toBe(200);
  });

  it("journals unclaimed-run once for a grantless recipe run", () => {
    const h = makeHarness();
    h.feedMeter(-100);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    h.order("pump", true, { kind: "recipe", instanceId: "i1" }); // repeat: no dup
    const entries = h.arbiter.getPublicState().journal.filter((j) => j.kind === "unclaimed-run");
    expect(entries).toHaveLength(1);
  });

  it("closes an unclaimed run when the load stops, so it reads as a span", () => {
    // Without the end the timeline can only show where the run started, which
    // says nothing about how long the load held power outside arbitration.
    const h = makeHarness();
    h.feedMeter(-100);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    h.order("pump", false, { kind: "recipe", instanceId: "i1" });
    const kinds = h.arbiter
      .getPublicState()
      .journal.filter((j) => j.kind.startsWith("unclaimed-run"))
      .map((j) => j.kind);
    expect(kinds).toEqual(["unclaimed-run-ended", "unclaimed-run"]); // newest-first
  });

  it("does not close a run that was never flagged as unclaimed", () => {
    const h = makeHarness({ priority: ["pump"] });
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150); // granted, so the run is arbitrated
    h.order("pump", false, { kind: "recipe", instanceId: "i1" });
    const kinds = h.arbiter.getPublicState().journal.map((j) => j.kind);
    expect(kinds).not.toContain("unclaimed-run-ended");
  });

  // ── Issue #535 — OFF loads must not stay "on outside arbitration" ──

  it("a manual OFF order closes an unclaimed run and journals suspended with running=false", () => {
    const h = makeHarness();
    h.feedMeter(-100);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" }); // unclaimed run starts
    h.order("pump", false, { kind: "manual" }); // human switches it off
    const journal = h.arbiter.getPublicState().journal;
    // The run is closed even though the OFF came from a manual order, and the
    // suspension records that the load is stopped — both feed the timeline.
    expect(journal.map((j) => j.kind)).toContain("unclaimed-run-ended");
    expect(journal.find((j) => j.kind === "suspended")?.running).toBe(false);
  });

  it("a manual ON order journals suspended with running=true", () => {
    const h = makeHarness();
    h.order("pump", true, { kind: "manual" });
    expect(h.arbiter.getPublicState().journal.find((j) => j.kind === "suspended")?.running).toBe(
      true,
    );
  });

  it("a reported OFF state closes an unclaimed run (load stopping on its own)", () => {
    const h = makeHarness();
    h.feedMeter(-100);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    h.feedState("pump", false); // the load's own regulation stopped it — no order
    expect(h.arbiter.getPublicState().journal.map((j) => j.kind)).toContain("unclaimed-run-ended");
  });

  it("a wall-switch-off suspension journals running=false", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    h.feedState("pump", false); // flipped off at the box
    h.run(-400, 80); // > divergenceConfirmS
    const suspended = h.arbiter.getPublicState().journal.find((j) => j.kind === "suspended");
    expect(suspended?.reason).toBe("wall-switch-off");
    expect(suspended?.running).toBe(false);
  });

  it("suspension TTL expiry journals a resumed hand-back with the load state", () => {
    const h = makeHarness({ settings: { "energy.arbiter.overrideTtlS": "60" } });
    h.feedState("pump", false);
    h.order("pump", false, { kind: "manual" }); // suspends for 60 s
    h.run(-100, 80); // ticks past the TTL
    const resumed = h.arbiter.getPublicState().journal.find((j) => j.kind === "resumed");
    // A silent lapse left the timeline painting the pre-expiry state forever.
    expect(resumed?.reason).toBe("override-expired");
    expect(resumed?.running).toBe(false);
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
  });

  it("an explicit resume journals the observed load state", () => {
    const h = makeHarness();
    h.feedState("pump", true);
    h.order("pump", true, { kind: "manual" });
    h.arbiter.resumeEquipment("pump");
    const resumed = h.arbiter.getPublicState().journal.find((j) => j.kind === "resumed");
    expect(resumed?.reason).toBe("resume control");
    expect(resumed?.running).toBe(true);
  });

  it("a comfort load (PAC) reported OFF closes its unclaimed run — the prod #535 scenario", () => {
    // Smart Cooling starts the PAC as a raw-export fallback (no grant), the
    // PAC reaches temperature and stops itself: a state report, never an
    // order. The state observation must not be gated on the deferrable class.
    const h = makeHarness();
    h.feedMeter(-100);
    h.order("pac", true, { kind: "recipe", instanceId: "i1" }); // unclaimed run
    h.feedState("pac", false);
    expect(h.arbiter.getPublicState().journal.map((j) => j.kind)).toContain("unclaimed-run-ended");
  });

  it("a comfort load's reported state never triggers a wall-switch suspension (FR-6 stays deferrable-only)", () => {
    const h = makeHarness();
    h.feedMeter(-100);
    h.feedState("pac", true); // on by itself, no grant, no recipe order
    h.run(-100, 80); // > divergenceConfirmS
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
  });

  it("a boolean-valued 'power' alias is the state binding when no 'state' alias exists (prod PAC shape)", () => {
    // The Panasonic PAC exposes its on/off switch as alias "power" (category
    // "power", boolean value) with no "state" alias at all — a wattmeter
    // would read numeric there, so the boolean value disambiguates.
    const h = makeHarness({
      bindings: {
        pac: [
          { alias: "power", category: "power", value: true },
          { alias: "nanoe", category: "generic", value: "on" },
        ],
      },
    });
    h.feedMeter(-100);
    h.order("pac", true, { kind: "recipe", instanceId: "i1" }); // unclaimed run
    h.eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: "pac",
      alias: "power",
      value: false, // the PAC reached temperature and reports its switch off
      previous: null,
    });
    expect(h.arbiter.getPublicState().journal.map((j) => j.kind)).toContain("unclaimed-run-ended");
  });

  it("a boolean value on a non-state alias is not read as the run state", () => {
    // A load can expose other boolean aliases (window detection, child lock…);
    // only the state binding may close a run or feed the running flag.
    const h = makeHarness();
    h.feedMeter(-100);
    h.order("pac", true, { kind: "recipe", instanceId: "i1" }); // unclaimed run
    h.eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: "pac",
      alias: "window_detection",
      value: "OFF",
      previous: null,
    });
    expect(h.arbiter.getPublicState().journal.map((j) => j.kind)).not.toContain(
      "unclaimed-run-ended",
    );
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

  // ── Timeline pending spans (#584) ─────────────────────────

  it("journals `released` when a pending (never-granted) claim is released (#584)", () => {
    const h = makeHarness();
    const handle = h.claim("i1", { equipmentId: "pump" }); // needs 600+100 W
    h.run(-100, 60); // exporting only 100 W → stays pending, never granted
    expect(h.arbiter.getPublicState().pending.map((p) => p.equipmentId)).toContain("pump");
    // The pending claim opened a `waiting` span (#561)…
    const j0 = h.arbiter.getPublicState().journal;
    expect(j0.filter((d) => d.kind === "waiting" && d.equipmentId === "pump")).toHaveLength(1);
    expect(j0.some((d) => d.kind === "granted" && d.equipmentId === "pump")).toBe(false);

    handle.release();

    // …and releasing it must close that span, or buildLoadTimelines paints the
    // load "en attente" to the window edge forever (the PAC-Piscine bug).
    const j1 = h.arbiter.getPublicState().journal;
    expect(j1.some((d) => d.kind === "released" && d.equipmentId === "pump")).toBe(true);
    expect(h.events.filter((e) => e.type === "energy.capacity.released")).toHaveLength(1);
    expect(h.arbiter.getPublicState().pending.map((p) => p.equipmentId)).not.toContain("pump");
  });

  it("re-journals `waiting` when an unclaimed run ends while a claim stays pending (#584)", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-100, 30); // pending, no grant
    // Recipe runs the pump outside arbitration (off-peak fallback) → opens an
    // unclaimed run that overlays the pending span as "unmanaged".
    h.order("pump", "ON", { kind: "recipe", instanceId: "i1" });
    expect(
      h.arbiter
        .getPublicState()
        .journal.some((d) => d.kind === "unclaimed-run" && d.equipmentId === "pump"),
    ).toBe(true);

    // The run ends while the surplus claim is still pending underneath.
    h.order("pump", "OFF", { kind: "recipe", instanceId: "i1" });

    const j = h.arbiter.getPublicState().journal;
    expect(j.some((d) => d.kind === "unclaimed-run-ended" && d.equipmentId === "pump")).toBe(true);
    // Two `waiting` entries: the initial claim, plus the reopen after the run
    // ended — so the timeline resumes "en attente" instead of falsely idle.
    expect(j.filter((d) => d.kind === "waiting" && d.equipmentId === "pump")).toHaveLength(2);
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

// ============================================================
// Regression + coverage from the critical review pass (2026-08-12).
// Each test below locks a fix or fills a false-green gap the review found.
// ============================================================

describe("capacity arbiter — review hardening", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // core review #1 — the divergence-timer staleness bug: a load idle+OFF
  // before it is granted must NOT be suspended the instant it is granted.
  it("does not suspend a freshly-granted load that was reported OFF before the grant", () => {
    const h = makeHarness();
    h.feedState("pump", false); // idle + reported off, long before any claim
    h.run(-1000, 300); // 5 min of OFF while unclaimed
    const revoked = vi.fn();
    h.claim("i1", { equipmentId: "pump", onRevoked: revoked });
    h.run(-1000, 150); // granted
    expect(h.grantedEvents()).toHaveLength(1);
    // The recipe's onGranted turns the load on; the device confirms ON well
    // within divergenceConfirmS.
    h.feedState("pump", true);
    h.run(-1000, 120);
    expect(revoked).not.toHaveBeenCalled();
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
  });

  // integration review H1 — a numeric non-state binding (current/voltage) at 0
  // must never be read as a wall-switch OFF (thermostatic cutoff false positive).
  it("ignores a numeric binding reading 0 for divergence (thermostatic cutoff)", () => {
    const h = makeHarness();
    const revoked = vi.fn();
    h.claim("i1", { equipmentId: "heater", onRevoked: revoked });
    h.run(-3000, 150); // granted
    h.order("heater", true, { kind: "recipe", instanceId: "i1" });
    // The resistor's own thermostat opens: a `current` binding drops to 0
    // while the relay `state` stays on. Pre-fix this faked a wall OFF.
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(10_000);
      h.feedMeter(-3000);
      h.eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: "heater",
        alias: "current",
        value: 0,
        previous: null,
      });
    }
    expect(revoked).not.toHaveBeenCalledWith("manual-override");
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
  });

  // test review H1 — tier-2 (learned nominal) is actually used for the
  // reservation once the live clamp goes silent.
  it("reserves the learned nominal when the live clamp goes silent, else declared", () => {
    const h = makeHarness({
      profiles: { pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 } },
    });
    h.equipments.get("pump")!.energyProfile!.learned = {
      watts: 550,
      atIso: "2026-08-12T09:00:00Z",
      runs: 3,
    };
    h.claim("i1", { equipmentId: "pump" });
    // Keep the clamp reporting through the engage hold so tier 1 stays fresh.
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(10_000);
      h.feedMeter(-2000);
      h.feedLoadPower("pump", 900);
    }
    expect(h.arbiter.getPublicState().grants[0].watts).toBe(900);
    // Let the clamp go silent past the freshness window → tier 2 (learned).
    for (let i = 0; i < 14; i++) {
      vi.advanceTimersByTime(10_000);
      h.feedMeter(-2000);
    }
    expect(h.arbiter.getPublicState().grants[0].watts).toBe(550);
  });

  // core review #2 — a callback that releases a sibling claim mid-pass must
  // not cause a revoke-after-release, a duplicate event, or an orphan record.
  it("a callback releasing a sibling claim does not double-fire or orphan it", () => {
    const h = makeHarness({
      priority: ["pac", "pump"],
      profiles: {
        pac: { class: "comfort", nominalPowerW: 2000, minOnS: 0, minOffS: 0 },
        pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
      },
    });
    const pacRevoked = vi.fn();
    // Holder so the pump's onRevoked can reference pac's handle, which is
    // created after it (the closure captures the box, not a value).
    const box: { pac?: ReturnType<typeof h.claim> } = {};
    h.claim("i1", {
      equipmentId: "pump",
      onRevoked: () => box.pac?.release(), // sibling release from inside a callback
    });
    box.pac = h.claim("i1", { equipmentId: "pac", onRevoked: pacRevoked });
    h.run(-3000, 150);
    expect(h.grantedEvents()).toHaveLength(2);
    // Deficit → release pass revokes pump (bottom); its callback releases pac.
    h.run(2000, 700);
    expect(pacRevoked).not.toHaveBeenCalled(); // released, never revoked
    expect(h.revokedEvents().filter((e) => e.equipmentId === "pac")).toHaveLength(0);
    expect(h.events.filter((e) => e.type === "energy.capacity.released")).toHaveLength(1);
    expect(h.arbiter.getPublicState().grants.some((g) => g.equipmentId === "pac")).toBe(false);
  });

  // core review #3 — disabling a profile mid-grant releases the claim.
  it("revokes a granted claim when its equipment profile is disabled", () => {
    const h = makeHarness();
    const revoked = vi.fn();
    h.claim("i1", { equipmentId: "pump", onRevoked: revoked });
    h.run(-1000, 150);
    expect(h.grantedEvents()).toHaveLength(1);
    h.equipments.get("pump")!.energyProfile = undefined; // admin turns it off
    h.eventBus.emit({ type: "equipment.updated", equipment: h.equipments.get("pump")! as never });
    expect(revoked).toHaveBeenCalledWith("disabled");
    expect(h.arbiter.getPublicState().grants).toHaveLength(0);
  });

  // core review #4 — a negative live-draw sample never yields negative
  // reservation (which would inflate the deficit).
  it("clamps a negative live draw to zero in the reservation", () => {
    const h = makeHarness({
      profiles: { pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 } },
    });
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.feedLoadPower("pump", -50); // bidirectional-clamp noise
    h.feedMeter(-1000);
    const st = h.arbiter.getPublicState();
    // The clamp lives in the reservation, now surfaced on the grant's effective
    // watts (not on availableSurplusW, which is the raw grid balance since
    // #563): a −50 W sample reserves 0, never a negative draw that would
    // inflate the internal deficit.
    expect(st.grants[0]?.watts).toBe(0);
    // The displayed surplus is the true grid export, unaffected by the draw.
    expect(st.availableSurplusW).toBe(1000);
  });

  // test review M2 — the manual-override suspension actually expires after
  // overrideTtlS (7200 s), it is not permanent.
  it("expires a manual-override suspension after overrideTtlS", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150);
    h.order("pump", false, { kind: "manual" });
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(1);
    vi.advanceTimersByTime(7_210_000); // past 2 h; overrides expire even while stale
    expect(h.arbiter.getPublicState().suspensions).toHaveLength(0);
  });

  // test review M5 — toleratedImportW widens engage by *exactly* that amount:
  // the same surplus that grants with tolerance stays pending without it.
  it("toleratedImportW is what makes the difference at the engage boundary", () => {
    const withTol = makeHarness({ priority: ["heater"] });
    withTol.claim("i1", { equipmentId: "heater", toleratedImportW: 200 }); // need 2100
    withTol.run(-2150, 200);
    expect(withTol.grantedEvents()).toHaveLength(1);

    const without = makeHarness({ priority: ["heater"] });
    without.claim("i1", { equipmentId: "heater", toleratedImportW: 0 }); // need 2300
    without.run(-2150, 200);
    expect(without.grantedEvents()).toHaveLength(0);
  });

  // test review M6 — preemption can revoke MORE than one victim in a pass.
  it("preempts two lower grants when one victim is not enough", () => {
    const h = makeHarness({
      priority: ["pac", "pump", "heater"],
      profiles: {
        pac: { class: "comfort", nominalPowerW: 900, minOnS: 0, minOffS: 0 },
        pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
        heater: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
      },
    });
    h.claim("pumpI", { equipmentId: "pump" });
    h.claim("heaterI", { equipmentId: "heater" });
    h.run(-1500, 150); // both granted
    expect(h.grantedEvents()).toHaveLength(2);
    // Simulate them consuming: export collapses to ~100 W. pac (need 1000)
    // arrives; shortfall 900 needs BOTH 600 W victims.
    h.claim("pacI", { equipmentId: "pac" });
    h.run(-100, 100);
    const preempts = h.revokedEvents().filter((e) => e.reason === "priority-preempted");
    expect(preempts).toHaveLength(2);
    expect(preempts.map((e) => e.equipmentId).sort()).toEqual(["heater", "pump"]);
  });

  // test review M4 — journal + event carry the claim note and effective watts.
  it("carries the claim note through the journal and the granted event", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump", note: "precool boost" });
    h.run(-1000, 150);
    const granted = h.grantedEvents()[0];
    expect(granted.note).toBe("precool boost");
    const entry = h.arbiter
      .getPublicState()
      .journal.find((j) => j.kind === "granted" && j.equipmentId === "pump");
    expect(entry?.note).toBe("precool boost");
    expect(entry?.watts).toBe(600);
  });

  // second-audit gap — a callback that claims a sibling re-enters evaluate();
  // the coalescing must prevent the nested pass from spending headroom the
  // outer pass has not yet debited (double-spend), so only what fits is granted.
  it("does not double-spend headroom when a grant callback claims a sibling", () => {
    const h = makeHarness({
      priority: ["pac", "pump"],
      profiles: {
        pac: { class: "comfort", nominalPowerW: 2000, minOnS: 0, minOffS: 0 },
        pump: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
      },
    });
    // Surplus fits pac (2000) but not also pump (would need 2600). pac's
    // onGranted claims pump from inside the grant pass (re-entrant evaluate).
    h.claim("i1", {
      equipmentId: "pac",
      onGranted: () => h.claim("i1", { equipmentId: "pump" }),
    });
    h.run(-2200, 200);
    const granted = h.grantedEvents().map((e) => e.equipmentId);
    expect(granted).toContain("pac");
    expect(granted).not.toContain("pump"); // 2200 < 2000+600, no double-spend
    // And no runaway: pac granted exactly once.
    expect(h.grantedEvents().filter((e) => e.equipmentId === "pac")).toHaveLength(1);
  });

  // second-audit gap — a shadow instance must never arbitrate, whatever the
  // stored setting says. Control (claims/grants) stays inert...
  it("never arbitrates in shadow mode even when the setting is enabled", () => {
    const h = makeHarness({ shadow: true });
    const denied = h.claim("i1", { equipmentId: "pump" });
    expect(denied.deniedReason).toBe("arbiter-disabled");
    h.run(-3000, 200);
    expect(h.grantedEvents()).toHaveLength(0);
  });

  // spec 148 — ...but the read-only surface stays visible so it can be QA'd on
  // a shadow (spec 124: "fully usable as a UI"). The display flag tracks the
  // configured setting, decoupled from the shadow-forced control gate.
  it("still reports enabled in the read model on a shadow when the setting is on", () => {
    const enabledShadow = makeHarness({ shadow: true });
    expect(enabledShadow.arbiter.getPublicState().enabled).toBe(true);
    const disabledShadow = makeHarness({
      shadow: true,
      settings: { "energy.arbiter.enabled": "false" },
    });
    expect(disabledShadow.arbiter.getPublicState().enabled).toBe(false);
  });

  // test review M1 — the EMA is a real low-pass filter at the default 60 s
  // (every other test runs at smoothingS=1 where it is a pass-through).
  it("lags the meter under the default smoothing rather than snapping", () => {
    const h = makeHarness({ settings: { "energy.arbiter.smoothingS": "60" } });
    h.run(-2000, 600); // settle EMA near exporting 2000 W
    const settled = h.arbiter.getPublicState().availableSurplusW ?? 0;
    expect(settled).toBeGreaterThan(1500);
    // A single "export gone" sample, 10 s later so the EMA alpha is non-zero.
    vi.advanceTimersByTime(10_000);
    h.feedMeter(0);
    const afterStep = h.arbiter.getPublicState().availableSurplusW ?? 0;
    // Smoothed: still sees most of the surplus one sample later, not snapped to 0.
    expect(afterStep).toBeGreaterThan(1000);
    expect(afterStep).toBeLessThan(settled);
  });
});

// ============================================================
// #543 — restart during an unclaimed run: rehydration from the
// persisted journal so the first observed OFF closes the span.
// ============================================================

describe("capacity arbiter — unclaimed-run rehydration on restart (#543)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const dec = (
    kind: ArbiterDecisionKind,
    equipmentId: string,
    atIso: string,
    running?: boolean,
  ): ArbiterDecision => ({ kind, equipmentId, equipmentName: equipmentId, atIso, running });

  const endedCount = (h: ReturnType<typeof makeHarness>) =>
    h.arbiter.getPublicState().journal.filter((j) => j.kind === "unclaimed-run-ended").length;

  it("a reported OFF after restart closes a rehydrated open run and repaints the timeline", () => {
    const h = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-12T08:00:00.000Z")],
    });
    // Rehydration itself journals nothing.
    expect(h.journalRows).toHaveLength(1);

    h.feedState("pump", false);
    expect(endedCount(h)).toBe(1);

    // The span now has an end: quarters after the OFF paint idle, the run
    // before it stays unmanaged. (Advance past the quarter boundary — the
    // window is quantized to :15 steps and a cell only shows events strictly
    // before its end.)
    vi.advanceTimersByTime(15 * 60_000);
    const tl = h.arbiter.getTimeline(Date.now(), 6);
    const pump = tl.loads.find((l) => l.equipmentId === "pump");
    expect(pump?.quarters.at(-1)).toBe("idle");
    // Mid-run quarter (window 04:15-10:15, run 08:00-10:00): still unmanaged.
    expect(pump?.quarters[16]).toBe("unmanaged");
  });

  it("an OFF order after restart closes a rehydrated open run (manual OFF journals suspended running=false after it)", () => {
    const h = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-12T08:00:00.000Z")],
    });
    h.order("pump", false, { kind: "manual" });
    // Newest-first public journal: the suspension is journaled after the close.
    const kinds = h.arbiter.getPublicState().journal.map((j) => j.kind);
    expect(kinds.slice(0, 2)).toEqual(["suspended", "unclaimed-run-ended"]);
    const suspended = h.arbiter.getPublicState().journal.find((j) => j.kind === "suspended");
    expect(suspended?.running).toBe(false);
  });

  it("#604 — a granted tail with no live claim is closed with a reset on startup", () => {
    const h = makeHarness({
      journal: [dec("granted", "pump", "2026-08-12T08:00:00.000Z")],
    });
    // start() journaled exactly one reset closing the phantom grant.
    const resets = h.journalRows.filter((d) => d.kind === "reset" && d.equipmentId === "pump");
    expect(resets).toHaveLength(1);
    expect(h.arbiter.getPublicState().journal[0]?.kind).toBe("reset");
    // The timeline no longer paints the grant forward to now.
    vi.advanceTimersByTime(15 * 60_000);
    const tl = h.arbiter.getTimeline(Date.now(), 6);
    const pump = tl.loads.find((l) => l.equipmentId === "pump");
    expect(pump?.quarters.at(-1)).toBe("idle");
  });

  it("#604 — a pending (waiting) tail with no live claim is closed on startup", () => {
    const h = makeHarness({
      journal: [dec("waiting", "pump", "2026-08-12T08:00:00.000Z")],
    });
    expect(h.journalRows.filter((d) => d.kind === "reset")).toHaveLength(1);
  });

  it("#604 — an already-closed tail is NOT reset on startup", () => {
    const h = makeHarness({
      journal: [
        dec("granted", "pump", "2026-08-12T08:00:00.000Z"),
        dec("released", "pump", "2026-08-12T09:00:00.000Z"),
      ],
    });
    expect(h.journalRows.some((d) => d.kind === "reset")).toBe(false);
  });

  it("#604 — an unmanaged (unclaimed-run) tail is left to rehydration, not reset", () => {
    const h = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-12T08:00:00.000Z")],
    });
    expect(h.journalRows.some((d) => d.kind === "reset")).toBe(false);
  });

  it.each([
    ["unclaimed-run-ended", dec("unclaimed-run-ended", "pump", "2026-08-12T08:30:00.000Z")],
    ["granted", dec("granted", "pump", "2026-08-12T08:30:00.000Z")],
    ["suspended running=false", dec("suspended", "pump", "2026-08-12T08:30:00.000Z", false)],
    ["resumed running=false", dec("resumed", "pump", "2026-08-12T08:30:00.000Z", false)],
  ])("a run already closed in the journal by %s is not rehydrated", (_label, closing) => {
    const h = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-12T08:00:00.000Z"), closing],
    });
    const before = endedCount(h);
    h.feedState("pump", false);
    expect(endedCount(h)).toBe(before); // OFF journals nothing — no open run
  });

  it.each([
    ["suspended running=true", dec("suspended", "pump", "2026-08-12T08:30:00.000Z", true)],
    ["suspended legacy running unknown", dec("suspended", "pump", "2026-08-12T08:30:00.000Z")],
    ["resumed running=true", dec("resumed", "pump", "2026-08-12T08:30:00.000Z", true)],
    ["resumed legacy running unknown", dec("resumed", "pump", "2026-08-12T08:30:00.000Z")],
  ])("a %s entry does NOT close the pending run", (_label, entry) => {
    const h = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-12T08:00:00.000Z"), entry],
    });
    h.feedState("pump", false);
    expect(endedCount(h)).toBe(1); // still open → the OFF closes it
  });

  it("only the last unresolved unclaimed-run per equipment counts across cycles", () => {
    const h = makeHarness({
      journal: [
        dec("unclaimed-run", "pump", "2026-08-12T07:00:00.000Z"),
        dec("unclaimed-run-ended", "pump", "2026-08-12T07:30:00.000Z"),
        dec("unclaimed-run", "pump", "2026-08-12T08:00:00.000Z"),
      ],
    });
    h.feedState("pump", false);
    expect(endedCount(h)).toBe(2); // the seeded one + exactly one new close
    h.feedState("pump", false);
    expect(endedCount(h)).toBe(2); // idempotent — the set is empty now
  });

  it("rehydrates from the store even when the opening entry fell off the in-memory ring cap", () => {
    // 250 later entries for another equipment push the pump's opening entry
    // beyond loadRecent(200) — the store range scan must still see it.
    const filler = Array.from({ length: 250 }, (_, i) =>
      dec(
        "denied",
        "heater",
        `2026-08-12T09:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
      ),
    );
    const h = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-12T08:00:00.000Z"), ...filler],
    });
    h.feedState("pump", false);
    expect(h.journalRows.filter((j) => j.kind === "unclaimed-run-ended")).toHaveLength(1);
  });

  it("an open run for an equipment that no longer exists is skipped", () => {
    const h = makeHarness({
      journal: [dec("unclaimed-run", "ghost", "2026-08-12T08:00:00.000Z")],
    });
    // The Set stayed empty: the rehydration log line (emitted only when at
    // least one run was rehydrated) is absent, and nothing was journaled.
    expect(h.logLines.filter((l) => l.msg?.includes("rehydrated"))).toHaveLength(0);
    expect(h.journalRows).toHaveLength(1);
    h.feedState("pump", false);
    expect(endedCount(h)).toBe(0);
  });

  it("a load still running across the restart does not journal a duplicate unclaimed-run on the next recipe ON", () => {
    const h = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-12T08:00:00.000Z")],
    });
    h.order("pump", true, { kind: "recipe", instanceId: "i1" });
    const runs = h.arbiter.getPublicState().journal.filter((j) => j.kind === "unclaimed-run");
    expect(runs).toHaveLength(1); // the rehydrated one, no duplicate
    h.feedState("pump", false);
    expect(endedCount(h)).toBe(1); // the original span finally closes
  });

  it("entries older than the 84h lookback are ignored, entries inside it count", () => {
    const h = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-08T08:00:00.000Z")], // 98h old
    });
    h.feedState("pump", false);
    expect(endedCount(h)).toBe(0); // not rehydrated → nothing to close

    // 80h old — still paintable by the deepest timeline page (48h depth +
    // 12h window + 24h entering-state lookback), so it must rehydrate.
    const h2 = makeHarness({
      journal: [dec("unclaimed-run", "pump", "2026-08-09T02:00:00.000Z")],
    });
    h2.feedState("pump", false);
    expect(endedCount(h2)).toBe(1);
  });
});

describe("idle roster (#561)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists every declared priority load that holds no claim, at its rating", () => {
    const h = makeHarness();
    const { idle } = h.arbiter.getPublicState();
    expect(idle.map((i) => i.equipmentId).sort()).toEqual(["heater", "pac", "pump"]);
    expect(idle.find((i) => i.equipmentId === "pump")).toMatchObject({
      equipmentName: "Pompe Piscine",
      watts: 600,
      toleratedImportW: 0,
      runningUnmanaged: false,
    });
  });

  it("reports an at-rest load's rating, not its ~0 W live draw (#561 review)", () => {
    const h = makeHarness();
    // A metered load that is off reports ~0 W on its power binding; the roster
    // must still show its rating, not "0 W".
    h.feedLoadPower("pump", 3);
    const idle = h.arbiter.getPublicState().idle.find((i) => i.equipmentId === "pump");
    expect(idle?.watts).toBe(600); // nominal, not the 3 W live reading
    expect(idle?.runningUnmanaged).toBe(false);
  });

  it("reflects the live draw for a load running outside arbitration", () => {
    const h = makeHarness();
    h.order("heater", "ON", { kind: "recipe", instanceId: "r1" }); // unclaimed run
    h.feedLoadPower("heater", 2100); // real draw diverges from the 2200 nominal
    const idle = h.arbiter.getPublicState().idle.find((i) => i.equipmentId === "heater");
    expect(idle?.runningUnmanaged).toBe(true);
    expect(idle?.watts).toBe(2100); // live draw, not the nominal
  });

  it("carries the load's tolerated import from its energy profile", () => {
    const h = makeHarness({
      profiles: {
        pump: {
          class: "deferrable",
          nominalPowerW: 600,
          minOnS: 900,
          minOffS: 300,
          toleratedImportW: 300,
        },
      },
    });
    expect(
      h.arbiter.getPublicState().idle.find((i) => i.equipmentId === "pump")?.toleratedImportW,
    ).toBe(300);
  });

  it("drops a load from idle once it is pending, then once it is granted", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.feedMeter(-100); // below need → pending
    let state = h.arbiter.getPublicState();
    expect(state.idle.some((i) => i.equipmentId === "pump")).toBe(false);
    expect(state.pending.some((p) => p.equipmentId === "pump")).toBe(true);
    h.run(-1000, 200); // ample surplus → grant
    state = h.arbiter.getPublicState();
    expect(state.grants.some((g) => g.equipmentId === "pump")).toBe(true);
    expect(state.idle.some((i) => i.equipmentId === "pump")).toBe(false);
  });

  it("flags a claimless load a recipe is running as running outside arbitration", () => {
    const h = makeHarness();
    h.order("heater", "ON", { kind: "recipe", instanceId: "r1" });
    expect(
      h.arbiter.getPublicState().idle.find((i) => i.equipmentId === "heater")?.runningUnmanaged,
    ).toBe(true);
  });

  it("excludes a suspended load from idle", () => {
    const h = makeHarness();
    h.order("pump", "OFF", { kind: "manual" }); // manual → suspend
    const state = h.arbiter.getPublicState();
    expect(state.suspensions.some((s) => s.equipmentId === "pump")).toBe(true);
    expect(state.idle.some((i) => i.equipmentId === "pump")).toBe(false);
  });
});

describe("waiting journal (#561)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("journals a waiting decision when a fresh claim stays pending", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.feedMeter(-100); // not enough (needs 700)
    expect(
      h.arbiter
        .getPublicState()
        .journal.some((j) => j.kind === "waiting" && j.equipmentId === "pump"),
    ).toBe(true);
  });

  it("skips the waiting journal when the claim is granted on the spot", () => {
    const h = makeHarness({ settings: { "energy.arbiter.engageHoldS": "0" } });
    h.feedMeter(-1000); // 1 kW export already present
    h.claim("i1", { equipmentId: "pump" }); // hold 0 + ample surplus → granted inside claim()
    const state = h.arbiter.getPublicState();
    expect(state.grants.some((g) => g.equipmentId === "pump")).toBe(true);
    expect(
      state.journal.filter((j) => j.kind === "waiting" && j.equipmentId === "pump"),
    ).toHaveLength(0);
  });

  it("re-journals waiting after a surplus-deficit revoke leaves the claim pending", () => {
    const h = makeHarness();
    h.claim("i1", { equipmentId: "pump" });
    h.run(-1000, 150); // grant (~t=130s)
    expect(h.grantedEvents()).toHaveLength(1);
    // Sustained import: past releaseHold (600 s) AND past minOnS (900 s from the
    // grant) so the anti-short-cycle guard no longer blocks the revoke.
    h.run(700, 1100);
    const journal = h.arbiter.getPublicState().journal;
    expect(journal.some((j) => j.kind === "revoked" && j.equipmentId === "pump")).toBe(true);
    // Two waiting entries: the initial claim, and the reopen after the revoke.
    expect(journal.filter((j) => j.kind === "waiting" && j.equipmentId === "pump").length).toBe(2);
  });
});
