/**
 * CapacityArbiter — spec 140.
 *
 * Single reader of the grid meter, arbitrating solar surplus between declared
 * flexible loads through reservation accounting:
 *
 *   availableW = exportW + Σ effectiveWatts(granted claims)
 *
 * A drop in export caused by its own grants never reads as "surplus gone";
 * the only honest deficit signal is the SIGNED grid reading (an import), per
 * review decision 10. The arbiter issues no orders in phase 1 — recipes act,
 * the arbiter decides — and everything it does lands in a bounded decision
 * journal ("why" first-class, FR-8).
 */

import { randomUUID } from "node:crypto";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type {
  ArbiterDecision,
  ArbiterPublicState,
  ArbiterRunState,
  CapacityClaimHandle,
  CapacityClaimRequest,
  CapacityDenyReason,
  CapacityRevokeReason,
  CapacitySlack,
  EnergyLoadProfile,
  EngineEvent,
} from "../shared/types.js";

const SETTING_PREFIX = "energy.arbiter.";
const JOURNAL_CAP = 200;
const LIVE_DRAW_TAU_S = 30; // per-load EMA time constant
const LIVE_DRAW_FRESH_MS = 120_000; // tier-1 freshness window
const LEARN_SAMPLE_FLOOR = 0.25; // learner ignores samples below 25 % of nominal
const LEARN_MIN_SAMPLES = 3;
const LEARN_SAMPLE_CAP = 500;
const DIVERGENCE_RATIO = 0.3; // watts-divergence threshold vs declared nominal
const TICK_MS = 10_000;

interface ArbiterConfig {
  enabled: boolean;
  priority: string[];
  engageMarginW: number;
  engageHoldS: number;
  releaseHoldS: number;
  smoothingS: number;
  overrideTtlS: number;
  staleAfterS: number;
  divergenceConfirmS: number;
  meterEquipmentId: string | null;
}

interface ClaimRecord {
  id: string;
  equipmentId: string;
  instanceId: string;
  watts: number;
  toleratedImportW: number;
  slack: CapacitySlack;
  note?: string;
  status: "pending" | "granted" | "denied" | "released";
  deniedReason?: CapacityDenyReason;
  grantedAt: number | null;
  engageSince: number | null;
  divergenceJournaled: boolean;
  onGranted: () => void;
  onRevoked: (reason: CapacityRevokeReason) => void;
}

interface RevokeWatchdog {
  equipmentId: string;
  at: number;
  expectedW: number;
  exportAtRevoke: number;
}

function isOnLike(value: unknown): boolean {
  return value === true || value === 1 || value === "on" || value === "ON";
}

function isOffLike(value: unknown): boolean {
  return value === false || value === 0 || value === "off" || value === "OFF";
}

/**
 * A genuine on/off STATE value, as opposed to a numeric measurement. Numbers
 * are deliberately excluded: a load's `current` / `voltage` / `power` binding
 * reading 0 (thermostat opened mid-run) must never be mistaken for a
 * wall-switch OFF (spec 140 review — the divergence detector must key off a
 * real state, not a value shape).
 */
function isBooleanState(value: unknown): boolean {
  return (
    value === true ||
    value === false ||
    value === "on" ||
    value === "ON" ||
    value === "off" ||
    value === "OFF"
  );
}

/** Trimmed median: drop the top/bottom quarter, take the middle value. */
export function trimmedMedian(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const drop = Math.floor(sorted.length / 4);
  const kept = sorted.slice(drop, sorted.length - drop);
  return kept[Math.floor(kept.length / 2)];
}

export class CapacityArbiter {
  private logger: Logger;
  private eventBus: EventBus;
  private settings: SettingsManager;
  private equipments: EquipmentManager;

  private config: ArbiterConfig;
  private claims = new Map<string, ClaimRecord>(); // by claim id
  private journalEntries: ArbiterDecision[] = [];

  // Meter
  private meterId: string | null = null;
  private meterAlias: string | null = null;
  private emaPowerW: number | null = null; // signed, +import / −export
  private lastMeterAt: number | null = null;

  // Per-equipment runtime state
  private liveDraw = new Map<string, { ema: number; at: number }>();
  private lastRevokedAt = new Map<string, number>();
  private overridesUntil = new Map<string, number>();
  private unresponsiveUntil = new Map<string, number>();
  private runSamples = new Map<string, number[]>();
  private unclaimedRunning = new Set<string>();
  private recipeWantsOn = new Map<string, boolean>();
  /** Last reported on/off STATE per profiled deferrable load. The confirm
   *  timing lives in `divergenceSince`, not here — this is only the current
   *  state to compare the grant expectation against. */
  private reportedOnOff = new Map<string, boolean>();
  /** When the current (grant-expectation vs reported-state) contradiction
   *  began — the confirm window is measured from here, NOT from the last
   *  state transition, so a load idle+OFF before it is granted does not read
   *  as "already diverged for minutes" the instant the grant lands. */
  private divergenceSince = new Map<string, number>();
  private recentComfortRevoke = new Map<string, { instanceId: string; at: number }>();

  private deficitSince: number | null = null;
  private watchdogs: RevokeWatchdog[] = [];
  private lastStatus: { state: ArbiterRunState; availableSurplusW: number | null } | null = null;
  /** ~5 min samples of availableW for the day-timeline curve (FR-10). */
  private surplusSeries: Array<{ at: number; availableW: number }> = [];
  private lastSurplusSampleAt = 0;

  private tick: NodeJS.Timeout | null = null;
  private unsubscribes: Array<() => void> = [];

  private readonly shadowMode: boolean;

  constructor(
    eventBus: EventBus,
    settings: SettingsManager,
    equipments: EquipmentManager,
    logger: Logger,
    shadowMode = false, // spec 124 — a shadow instance never arbitrates
  ) {
    this.eventBus = eventBus;
    this.settings = settings;
    this.equipments = equipments;
    this.logger = logger.child({ module: "capacity-arbiter" });
    this.shadowMode = shadowMode;
    this.config = this.readConfig();
  }

  // ── Lifecycle ───────────────────────────────────────────────

  start(): void {
    this.resolveMeter();
    this.unsubscribes.push(
      this.eventBus.onType("equipment.data.changed", (e) => {
        try {
          this.onDataChanged(e.equipmentId, e.alias, e.value);
        } catch (err) {
          this.logger.error({ err }, "Arbiter data handler failed");
        }
      }),
      this.eventBus.onType("equipment.order.executed", (e) => {
        try {
          this.onOrderExecuted(e.equipmentId, e.value, e.source);
        } catch (err) {
          this.logger.error({ err }, "Arbiter order handler failed");
        }
      }),
      this.eventBus.onType("equipment.updated", (e) => {
        try {
          this.onEquipmentUpdated(e.equipment.id);
        } catch (err) {
          this.logger.error({ err }, "Arbiter update handler failed");
        }
      }),
      this.eventBus.onType("equipment.removed", (e) => {
        try {
          this.onEquipmentRemoved(e.equipmentId);
        } catch (err) {
          this.logger.error({ err }, "Arbiter removal handler failed");
        }
      }),
      this.eventBus.onType("settings.changed", (e) => {
        if (e.keys.some((k) => k.startsWith(SETTING_PREFIX))) this.onSettingsChanged();
      }),
    );
    this.tick = setInterval(() => {
      try {
        this.evaluate();
      } catch (err) {
        this.logger.error({ err }, "Arbiter evaluation failed");
      }
    }, TICK_MS);
    this.logger.info({ enabled: this.config.enabled }, "Capacity arbiter started");
  }

  stop(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    for (const u of this.unsubscribes) u();
    this.unsubscribes = [];
  }

  // ── Configuration ───────────────────────────────────────────

  private readConfig(): ArbiterConfig {
    const num = (key: string, fallback: number): number => {
      const raw = this.settings.get(SETTING_PREFIX + key);
      const n = raw !== undefined ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : fallback;
    };
    let priority: string[] = [];
    try {
      const raw = this.settings.get(SETTING_PREFIX + "priority");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed))
          priority = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      this.logger.warn("Invalid energy.arbiter.priority setting, using empty list");
    }
    return {
      enabled: !this.shadowMode && this.settings.get(SETTING_PREFIX + "enabled") === "true",
      priority,
      engageMarginW: num("engageMarginW", 100),
      engageHoldS: num("engageHoldS", 120),
      releaseHoldS: num("releaseHoldS", 600),
      smoothingS: num("smoothingS", 60),
      overrideTtlS: num("overrideTtlS", 7200),
      staleAfterS: num("staleAfterS", 300),
      divergenceConfirmS: num("divergenceConfirmS", 60),
      meterEquipmentId: this.settings.get(SETTING_PREFIX + "meterEquipmentId") ?? null,
    };
  }

  private onSettingsChanged(): void {
    const wasEnabled = this.config.enabled;
    this.config = this.readConfig();
    this.resolveMeter();
    if (wasEnabled && !this.config.enabled) {
      this.revokeAll("disabled");
      this.emitStatus();
    }
    if (!wasEnabled && this.config.enabled) {
      this.logger.info("Capacity arbiter enabled");
      this.emitStatus();
    }
  }

  private resolveMeter(): void {
    const configured = this.config.meterEquipmentId;
    const meter = configured
      ? this.equipments.getById(configured)
      : (this.equipments.getAll().find((e) => e.type === "main_energy_meter") ?? null);
    const nextId = meter?.id ?? null;
    if (nextId !== this.meterId) {
      this.meterId = nextId;
      this.meterAlias = null;
      this.emaPowerW = null;
      this.lastMeterAt = null;
    }
    if (this.meterId) {
      // Re-derive the alias whenever the current one is not (yet) a real
      // binding: the meter's `power` binding may appear after boot (device
      // discovered late), and defaulting to "power" forever would leave the
      // arbiter silently `degraded` if the true alias differs.
      const bindings = this.equipments.getDataBindingsWithValues(this.meterId);
      const known = this.meterAlias && bindings.some((b) => b.alias === this.meterAlias);
      if (!known) {
        this.meterAlias =
          bindings.find((b) => b.category === "power")?.alias ??
          bindings.find((b) => b.alias === "power")?.alias ??
          "power";
      }
    }
  }

  /**
   * Spec 140 review #3 — an admin turning OFF an equipment's energy profile
   * while it holds a grant must release it; otherwise the arbiter keeps
   * reserving capacity for a load that is no longer flexible. `equipment.updated`
   * is also where a late-appearing meter binding is picked up (resolveMeter).
   */
  private onEquipmentUpdated(equipmentId: string): void {
    this.resolveMeter();
    if (!this.profileOf(equipmentId)) {
      for (const claim of [...this.claims.values()]) {
        if (claim.equipmentId !== equipmentId) continue;
        if (claim.status === "granted") this.revoke(claim, "disabled");
        this.claims.delete(claim.id);
      }
    }
  }

  // ── Event handlers ──────────────────────────────────────────

  private onDataChanged(equipmentId: string, alias: string, value: unknown): void {
    const now = Date.now();

    // Meter sample → signed EMA (time-aware alpha).
    if (equipmentId === this.meterId && alias === this.meterAlias) {
      if (typeof value === "number" && Number.isFinite(value)) {
        if (this.emaPowerW === null || this.lastMeterAt === null) {
          this.emaPowerW = value;
        } else {
          const dt = Math.max(0.001, (now - this.lastMeterAt) / 1000);
          const alpha = 1 - Math.exp(-dt / Math.max(1, this.config.smoothingS));
          this.emaPowerW += alpha * (value - this.emaPowerW);
        }
        this.lastMeterAt = now;
        this.evaluate();
      }
      return;
    }

    if (!this.config.enabled) return;
    const profile = this.profileOf(equipmentId);
    if (!profile) return;

    // Profiled load's own power binding → tier-1 live draw + learner samples.
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      this.isPowerAlias(equipmentId, alias)
    ) {
      const prev = this.liveDraw.get(equipmentId);
      if (!prev) {
        this.liveDraw.set(equipmentId, { ema: value, at: now });
      } else {
        const dt = Math.max(0.001, (now - prev.at) / 1000);
        const alpha = 1 - Math.exp(-dt / LIVE_DRAW_TAU_S);
        this.liveDraw.set(equipmentId, { ema: prev.ema + alpha * (value - prev.ema), at: now });
      }
      const running =
        this.grantedClaimFor(equipmentId) !== undefined || this.unclaimedRunning.has(equipmentId);
      // Sub-threshold samples are excluded (review decision 17): a thermostatic
      // load cycling to zero must not teach the learner its off periods.
      if (running && value >= profile.nominalPowerW * LEARN_SAMPLE_FLOOR) {
        const samples = this.runSamples.get(equipmentId) ?? [];
        if (samples.length < LEARN_SAMPLE_CAP) samples.push(value);
        this.runSamples.set(equipmentId, samples);
      }
      return;
    }

    // Reported on/off state → wall-switch divergence tracking (FR-6), on
    // deferrable loads only. Only a genuine on/off STATE value is tracked:
    // measurement bindings a load exposes (current, voltage, power) report
    // numeric 0 when a thermostat opens mid-run, which must NOT read as a
    // wall-switch OFF. `isBooleanState` accepts boolean / "on"|"off" strings
    // and rejects numbers precisely to exclude those measurements.
    if (profile.class === "deferrable" && isBooleanState(value)) {
      this.reportedOnOff.set(equipmentId, isOnLike(value));
    }
  }

  private onOrderExecuted(
    equipmentId: string,
    value: unknown,
    source: { kind: string; instanceId?: string } | undefined,
  ): void {
    if (!this.config.enabled) return;
    const profile = this.profileOf(equipmentId);
    if (!profile) return;
    const now = Date.now();

    if (source?.kind === "manual" || source?.kind === "button" || source?.kind === "external") {
      this.suspend(equipmentId, "user-order");
      return;
    }

    if (source?.kind === "recipe") {
      if (isOnLike(value)) this.recipeWantsOn.set(equipmentId, true);
      if (isOffLike(value)) this.recipeWantsOn.set(equipmentId, false);

      // comfort-off-after-revoke (FR-9): the claiming recipe switches a
      // comfort-class equipment OFF right after losing its grant.
      const recent = this.recentComfortRevoke.get(equipmentId);
      if (
        profile.class === "comfort" &&
        isOffLike(value) &&
        recent &&
        recent.instanceId === source.instanceId &&
        now - recent.at <= this.config.releaseHoldS * 1000
      ) {
        this.journal({
          kind: "comfort-off-after-revoke",
          equipmentId,
          reason: "recipe switched a comfort load off on revocation",
        });
      }

      // unclaimed-run (FR-9, author rule 5): a recipe runs a profiled load
      // with no grant — legitimate must-run fallback, journaled once.
      if (isOnLike(value) && !this.grantedClaimFor(equipmentId)) {
        if (!this.unclaimedRunning.has(equipmentId)) {
          this.unclaimedRunning.add(equipmentId);
          this.journal({
            kind: "unclaimed-run",
            equipmentId,
            reason: "recipe-driven run outside arbitration",
          });
        }
      }
      if (isOffLike(value) && this.unclaimedRunning.has(equipmentId)) {
        this.unclaimedRunning.delete(equipmentId);
        this.finishLearnerRun(equipmentId);
      }
    }
  }

  private onEquipmentRemoved(equipmentId: string): void {
    for (const claim of [...this.claims.values()]) {
      if (claim.equipmentId !== equipmentId) continue;
      if (claim.status === "granted") this.revoke(claim, "disabled");
      this.claims.delete(claim.id);
    }
    this.forgetEquipment(equipmentId);
    if (equipmentId === this.meterId) this.resolveMeter();
  }

  /** Drop all per-equipment runtime state (review #5 — otherwise these maps
   *  grow unbounded over the process lifetime and could mis-inform logic if a
   *  UUID is ever reused). */
  private forgetEquipment(equipmentId: string): void {
    this.liveDraw.delete(equipmentId);
    this.lastRevokedAt.delete(equipmentId);
    this.overridesUntil.delete(equipmentId);
    this.unresponsiveUntil.delete(equipmentId);
    this.runSamples.delete(equipmentId);
    this.unclaimedRunning.delete(equipmentId);
    this.recipeWantsOn.delete(equipmentId);
    this.reportedOnOff.delete(equipmentId);
    this.divergenceSince.delete(equipmentId);
    this.recentComfortRevoke.delete(equipmentId);
  }

  // ── Claim API (recipe-manager + tests) ──────────────────────

  claim(instanceId: string, req: CapacityClaimRequest): CapacityClaimHandle {
    const denied = (reason: CapacityDenyReason): CapacityClaimHandle => {
      this.journal({ kind: "denied", equipmentId: req.equipmentId, reason });
      this.emitEvent({
        type: "energy.capacity.denied",
        equipmentId: req.equipmentId,
        instanceId,
        reason,
      });
      return {
        id: randomUUID(),
        status: () => "denied",
        deniedReason: reason,
        release: () => {},
      };
    };

    if (!this.config.enabled) return denied("arbiter-disabled");
    const profile = this.profileOf(req.equipmentId);
    if (!profile) return denied("not-profiled");
    if (this.isSuspended(req.equipmentId)) return denied("override-active");
    for (const other of this.claims.values()) {
      if (
        other.equipmentId === req.equipmentId &&
        (other.status === "pending" || other.status === "granted")
      ) {
        return denied("equipment-already-claimed");
      }
    }

    const record: ClaimRecord = {
      id: randomUUID(),
      equipmentId: req.equipmentId,
      instanceId,
      watts: req.watts ?? profile.nominalPowerW,
      toleratedImportW: Math.max(0, req.toleratedImportW ?? 0),
      slack: req.slack ?? "none",
      note: req.note,
      status: "pending",
      grantedAt: null,
      engageSince: null,
      divergenceJournaled: false,
      onGranted: req.onGranted,
      onRevoked: req.onRevoked,
    };
    this.claims.set(record.id, record);
    this.evaluate();

    return {
      id: record.id,
      status: () => record.status,
      release: () => this.release(record),
    };
  }

  releaseAllFor(instanceId: string): void {
    for (const claim of [...this.claims.values()]) {
      if (
        claim.instanceId === instanceId &&
        (claim.status === "pending" || claim.status === "granted")
      ) {
        this.release(claim);
      }
    }
  }

  resumeEquipment(equipmentId: string): boolean {
    if (!this.overridesUntil.has(equipmentId)) return false;
    this.overridesUntil.delete(equipmentId);
    // Also drop any half-armed divergence timer, so a resume never re-suspends
    // on a contradiction that started before the manual override was lifted.
    this.divergenceSince.delete(equipmentId);
    this.journal({ kind: "resumed", equipmentId, reason: "resume control" });
    this.forceStatusEmit(); // let the UI drop the "Manual until…" chip live
    this.evaluate();
    return true;
  }

  /** Emit an `energy.arbiter.status` even if the coarse value is unchanged —
   *  used when suspensions change (which the status value does not capture) so
   *  the UI refetches the full read model. */
  private forceStatusEmit(): void {
    this.lastStatus = null;
    this.emitStatus();
  }

  // ── Public read model (route + UI + recipe state) ───────────

  getPublicState(): ArbiterPublicState {
    const now = Date.now();
    const state = this.runState();
    const accounting = this.accounting();
    const grants = [...this.claims.values()]
      .filter((c) => c.status === "granted")
      .map((c) => ({
        equipmentId: c.equipmentId,
        equipmentName: this.nameOf(c.equipmentId),
        instanceId: c.instanceId,
        watts: Math.round(this.effectiveWatts(c)),
        sinceIso: new Date(c.grantedAt ?? now).toISOString(),
        note: c.note,
      }));
    const pending = [...this.claims.values()]
      .filter((c) => c.status === "pending")
      .map((c) => ({
        equipmentId: c.equipmentId,
        equipmentName: this.nameOf(c.equipmentId),
        instanceId: c.instanceId,
        watts: c.watts,
        reasonWaiting: this.pendingReason(c, accounting.headroomW),
      }));
    const suspensions = [...this.overridesUntil.entries()]
      .filter(([, until]) => until > now)
      .map(([equipmentId, until]) => ({
        equipmentId,
        equipmentName: this.nameOf(equipmentId),
        untilIso: new Date(until).toISOString(),
      }));
    return {
      enabled: this.config.enabled,
      state,
      availableSurplusW: state === "active" ? Math.round(accounting.availableW) : null,
      productionDetected: this.equipments
        .getAll()
        .some((e) => e.type === "energy_production_meter" || e.type === "solar_panel"),
      grants,
      pending,
      suspensions,
      journal: [...this.journalEntries].reverse(),
      surplusSeries: this.surplusSeries.map((s) => ({
        atIso: new Date(s.at).toISOString(),
        availableW: s.availableW,
      })),
    };
  }

  // ── Core evaluation ─────────────────────────────────────────

  /**
   * Re-entrancy guard. `grant()` / `revoke()` invoke recipe callbacks
   * synchronously, and a callback may `claimCapacity()` (which calls
   * `evaluate()`) or `release()` a sibling. Without this, a nested pass would
   * grant against a `headroomW` the outer pass has not yet spent (double
   * spend). We coalesce: a re-entrant call is deferred and re-run once after
   * the current pass unwinds. The per-loop `status` guards below handle
   * sibling mutation within a single pass.
   */
  private evaluating = false;
  private reevalQueued = false;

  private evaluate(): void {
    if (this.evaluating) {
      this.reevalQueued = true;
      return;
    }
    this.evaluating = true;
    try {
      // Loop rather than recurse: a coalesced re-entrant call re-runs the
      // pass without adding a stack frame per round (converges in 1-2 passes).
      do {
        this.reevalQueued = false;
        this.runEvaluate();
      } while (this.reevalQueued);
    } finally {
      this.evaluating = false;
    }
  }

  private runEvaluate(): void {
    if (!this.config.enabled) return;
    const now = Date.now();

    // Expire suspensions silently (the explicit resume path journals).
    for (const [eq, until] of this.overridesUntil) {
      if (until <= now) this.overridesUntil.delete(eq);
    }
    for (const [eq, until] of this.unresponsiveUntil) {
      if (until <= now) this.unresponsiveUntil.delete(eq);
    }

    // Stale meter → revoke everything, degrade, wait for data (FR-7).
    if (this.lastMeterAt === null || now - this.lastMeterAt > this.config.staleAfterS * 1000) {
      if (this.hasGrants()) this.revokeAll("meter-stale");
      this.deficitSince = null;
      // Drop watchdogs: their `at` would otherwise freeze through the outage
      // and fire a spurious `revoke-not-honored` the instant data returns
      // (review #9). A stale meter revoked everything anyway.
      this.watchdogs = [];
      this.emitStatus();
      return;
    }

    this.checkStateDivergence(now);
    this.checkWatchdogs(now);

    const { signedGridW, exportW, availableW } = this.accounting();

    // ── Release pass (bottom-up). deficit ≡ signed import − tolerances −
    // the known draw of unresponsive equipments (excused as background). ──
    const toleratedSum = this.grantedClaims().reduce((s, c) => s + c.toleratedImportW, 0);
    const unresponsiveDraw = [...this.unresponsiveUntil.keys()].reduce(
      (s, eq) => s + this.drawEstimate(eq),
      0,
    );
    const deficitW = signedGridW - toleratedSum - unresponsiveDraw;
    if (deficitW > 0 && this.hasGrants()) {
      this.deficitSince ??= now;
      if (now - this.deficitSince >= this.config.releaseHoldS * 1000) {
        let remaining = deficitW;
        let revokedAny = false;
        for (const claim of this.grantedBottomUp()) {
          if (remaining <= 0) break;
          if (claim.status !== "granted") continue; // a callback released it mid-loop
          if (claim.grantedAt !== null && now - claim.grantedAt < this.minOnMs(claim.equipmentId)) {
            continue; // anti short-cycle: an unresolvable deficit simply waits
          }
          if (this.unresponsiveUntil.has(claim.equipmentId)) continue;
          remaining -= this.effectiveWatts(claim);
          this.revoke(claim, "surplus-deficit");
          revokedAny = true;
        }
        // Only a pass that actually revoked re-arms the hold. When every
        // remaining grant is inside its minOnS, the deficit "simply waits"
        // (architecture) — the hold stays armed and the pass retries each
        // tick until a grant ages out of its minimum-on window.
        if (revokedAny) this.deficitSince = null;
      }
    } else {
      this.deficitSince = null;
    }

    // ── Grant pass (top-down, slack "none" first), then preemption. ──
    let headroomW = exportW;
    const pendingOrdered = this.pendingOrdered();
    for (const claim of pendingOrdered) {
      if (claim.status !== "pending") continue; // a callback released/denied it mid-loop
      const eq = claim.equipmentId;
      if (this.isSuspended(eq) || this.unresponsiveUntil.has(eq)) {
        claim.engageSince = null;
        continue;
      }
      const revokedAt = this.lastRevokedAt.get(eq);
      if (revokedAt !== undefined && now - revokedAt < this.minOffMs(eq)) {
        claim.engageSince = null;
        continue;
      }
      const ownDrawW = this.freshLiveDraw(eq) ?? 0;
      // No floor at 0 (review #6): a claim whose toleratedImportW exceeds
      // watts+margin is explicitly willing to run while importing that much,
      // which is the whole point of the tolerance (FR-3). Flooring needW would
      // silently refuse it during any import.
      const needW = claim.watts + this.config.engageMarginW - claim.toleratedImportW;
      if (headroomW + ownDrawW >= needW) {
        claim.engageSince ??= now;
        if (now - claim.engageSince >= this.config.engageHoldS * 1000) {
          this.grant(claim);
          headroomW -= Math.max(0, claim.watts - ownDrawW);
        }
      } else {
        claim.engageSince = null;
        // Preemption: a pending "none"-slack claim that outranks granted loads
        // may revoke bottom-up until its shortfall is covered; it is then
        // served on a later pass, once the freed watts show up in the export.
        if (claim.slack === "none") {
          const myRank = this.priorityRank(eq);
          const below = this.grantedBottomUp().filter(
            (g) => this.priorityRank(g.equipmentId) > myRank,
          );
          const shortfallW = needW - headroomW - ownDrawW;
          const revocable = below.filter(
            (g) =>
              !(g.grantedAt !== null && now - g.grantedAt < this.minOnMs(g.equipmentId)) &&
              !this.unresponsiveUntil.has(g.equipmentId),
          );
          const achievable = revocable.reduce((s, g) => s + this.effectiveWatts(g), 0);
          if (shortfallW > 0 && achievable >= shortfallW) {
            let freed = 0;
            for (const g of revocable) {
              if (freed >= shortfallW) break;
              if (g.status !== "granted") continue;
              freed += this.effectiveWatts(g);
              this.revoke(g, "priority-preempted");
            }
          }
        }
      }
    }

    // watts-divergence (FR-9): transparency when reality disagrees with the
    // declared nominal — the books already follow the measurement.
    for (const claim of this.grantedClaims()) {
      if (claim.divergenceJournaled) continue;
      const profile = this.profileOf(claim.equipmentId);
      if (!profile) continue;
      const basis = this.freshLiveDraw(claim.equipmentId) ?? profile.learned?.watts;
      if (basis === undefined) continue;
      if (Math.abs(basis - profile.nominalPowerW) > DIVERGENCE_RATIO * profile.nominalPowerW) {
        claim.divergenceJournaled = true;
        this.journal({
          kind: "watts-divergence",
          equipmentId: claim.equipmentId,
          watts: Math.round(basis),
          reason: `declared ${profile.nominalPowerW} W`,
        });
      }
    }

    // Day-timeline curve sample (FR-10): ~5 min cadence, bounded to 24 h.
    if (now - this.lastSurplusSampleAt >= 5 * 60_000) {
      this.lastSurplusSampleAt = now;
      this.surplusSeries.push({ at: now, availableW: Math.round(availableW) });
      const dayAgo = now - 24 * 3_600_000;
      while (this.surplusSeries.length > 0 && this.surplusSeries[0].at < dayAgo) {
        this.surplusSeries.shift();
      }
    }

    this.emitStatus(availableW);
  }

  // ── Accounting helpers ──────────────────────────────────────

  private accounting(): {
    signedGridW: number;
    exportW: number;
    reservedW: number;
    availableW: number;
    headroomW: number;
  } {
    const signedGridW = this.emaPowerW ?? 0;
    const exportW = -signedGridW;
    const reservedW = this.grantedClaims().reduce((s, c) => s + this.effectiveWatts(c), 0);
    return { signedGridW, exportW, reservedW, availableW: exportW + reservedW, headroomW: exportW };
  }

  /** FR-2 three-tier effective watts: live draw → learned → claim watts. */
  private effectiveWatts(claim: ClaimRecord): number {
    const live = this.freshLiveDraw(claim.equipmentId);
    if (live !== null && live !== undefined) return live;
    const learned = this.profileOf(claim.equipmentId)?.learned?.watts;
    if (learned !== undefined) return learned;
    return claim.watts;
  }

  private drawEstimate(equipmentId: string): number {
    const live = this.freshLiveDraw(equipmentId);
    if (live !== null && live !== undefined) return live;
    const profile = this.profileOf(equipmentId);
    return profile?.learned?.watts ?? profile?.nominalPowerW ?? 0;
  }

  private freshLiveDraw(equipmentId: string): number | null {
    const entry = this.liveDraw.get(equipmentId);
    if (!entry) return null;
    if (Date.now() - entry.at > LIVE_DRAW_FRESH_MS) return null;
    // Clamp to ≥ 0: a bidirectional clamp or EMA noise can report a slightly
    // negative draw, which would understate reservedW and, worse, INCREASE the
    // deficit when a negative-draw load is "revoked" (remaining -= watts).
    return Math.max(0, entry.ema);
  }

  // ── Grant / revoke / release ────────────────────────────────

  private grant(claim: ClaimRecord): void {
    if (claim.status !== "pending") return; // released/denied by a re-entrant callback
    claim.status = "granted";
    claim.grantedAt = Date.now();
    claim.engageSince = null;
    claim.divergenceJournaled = false;
    this.journal({
      kind: "granted",
      equipmentId: claim.equipmentId,
      watts: claim.watts,
      note: claim.note,
    });
    this.emitEvent({
      type: "energy.capacity.granted",
      equipmentId: claim.equipmentId,
      instanceId: claim.instanceId,
      watts: claim.watts,
      note: claim.note,
    });
    this.guarded(claim.onGranted, claim, "onGranted");
  }

  private revoke(claim: ClaimRecord, reason: CapacityRevokeReason): void {
    if (claim.status !== "granted") return; // released by a re-entrant callback
    const watts = Math.round(this.effectiveWatts(claim));
    claim.status = "pending";
    claim.grantedAt = null;
    claim.engageSince = null;
    this.lastRevokedAt.set(claim.equipmentId, Date.now());
    this.finishLearnerRun(claim.equipmentId);
    const profile = this.profileOf(claim.equipmentId);
    if (profile?.class === "comfort") {
      this.recentComfortRevoke.set(claim.equipmentId, {
        instanceId: claim.instanceId,
        at: Date.now(),
      });
    }
    if (reason === "surplus-deficit" || reason === "priority-preempted") {
      this.watchdogs.push({
        equipmentId: claim.equipmentId,
        at: Date.now(),
        expectedW: watts,
        exportAtRevoke: -(this.emaPowerW ?? 0),
      });
    }
    this.journal({ kind: "revoked", equipmentId: claim.equipmentId, watts, reason });
    this.emitEvent({
      type: "energy.capacity.revoked",
      equipmentId: claim.equipmentId,
      instanceId: claim.instanceId,
      watts,
      reason,
    });
    this.guarded(() => claim.onRevoked(reason), claim, "onRevoked");
  }

  private release(claim: ClaimRecord): void {
    if (claim.status === "denied" || claim.status === "released") return;
    const wasGranted = claim.status === "granted";
    claim.status = "released";
    if (wasGranted) {
      this.finishLearnerRun(claim.equipmentId);
      this.journal({ kind: "released", equipmentId: claim.equipmentId });
      this.emitEvent({
        type: "energy.capacity.released",
        equipmentId: claim.equipmentId,
        instanceId: claim.instanceId,
      });
    }
    this.claims.delete(claim.id);
  }

  private revokeAll(reason: CapacityRevokeReason): void {
    for (const claim of this.grantedClaims()) this.revoke(claim, reason);
  }

  private suspend(equipmentId: string, why: string): void {
    const until = Date.now() + this.config.overrideTtlS * 1000;
    this.overridesUntil.set(equipmentId, until);
    const granted = this.grantedClaimFor(equipmentId);
    if (granted) this.revoke(granted, "manual-override");
    this.journal({ kind: "suspended", equipmentId, reason: why });
    this.logger.info({ equipmentId, why }, "Arbitration suspended (manual override)");
    // Force a status event: suspending an IDLE (ungranted) load revokes
    // nothing, so without this the UI (which refreshes on energy.* events)
    // would not learn about the new suspension until the next full fetch —
    // and the "Manual until HH:MM" chip + Resume would not appear.
    this.forceStatusEmit();
  }

  // ── Watchdogs & divergence ──────────────────────────────────

  private checkWatchdogs(now: number): void {
    // The decision point sits at releaseHoldS after the revoke — one hold of
    // grace to act — so an unhonored revoke is marked BEFORE the deficit
    // hold can fire again and cascade onto the next load down (acceptance:
    // "revokes nobody else"). The unresponsive excuse then lasts a further
    // 2 × releaseHoldS.
    const graceMs = this.config.releaseHoldS * 1000;
    const exportNow = -(this.emaPowerW ?? 0);
    this.watchdogs = this.watchdogs.filter((w) => {
      if (this.grantedClaimFor(w.equipmentId)) return false; // re-granted, moot
      if (exportNow - w.exportAtRevoke >= 0.5 * w.expectedW) return false; // honored
      if (now - w.at >= graceMs) {
        // FR-9 + review decision 12: bounded guard against cascades — the
        // draw is excused as background and the release pass skips the load.
        this.unresponsiveUntil.set(w.equipmentId, now + 2 * graceMs);
        this.journal({
          kind: "revoke-not-honored",
          equipmentId: w.equipmentId,
          watts: w.expectedW,
          reason: "export did not recover (a cloud can mask this)",
        });
        return false;
      }
      return true;
    });
  }

  private checkStateDivergence(now: number): void {
    const confirmMs = this.config.divergenceConfirmS * 1000;
    for (const [equipmentId, reportedOn] of this.reportedOnOff) {
      if (this.isSuspended(equipmentId)) {
        this.divergenceSince.delete(equipmentId);
        continue;
      }
      const granted = this.grantedClaimFor(equipmentId) !== undefined;
      const recipeOn = this.recipeWantsOn.get(equipmentId);
      // A recipe's own order is never a wall event: a granted load the recipe
      // turned on but that reports off (recipeOn === true) is the actuation lag
      // the confirm window exists to absorb, not a divergence to punish.
      const wallOff = granted && !reportedOn && recipeOn !== false;
      const wallOn = !granted && reportedOn && recipeOn !== true;
      if (!wallOff && !wallOn) {
        this.divergenceSince.delete(equipmentId);
        continue;
      }
      // Arm from onset: measure how long the contradiction has HELD, not how
      // long ago the device last changed state (which may predate the grant).
      const since = this.divergenceSince.get(equipmentId) ?? now;
      this.divergenceSince.set(equipmentId, since);
      if (now - since < confirmMs) continue;
      this.divergenceSince.delete(equipmentId);
      // Stable codes (not free text) so the UI journal can translate them.
      this.suspend(equipmentId, wallOff ? "wall-switch-off" : "wall-switch-on");
    }
  }

  // ── Learner (FR-2 middle tier) ──────────────────────────────

  private finishLearnerRun(equipmentId: string): void {
    const samples = this.runSamples.get(equipmentId);
    this.runSamples.delete(equipmentId);
    if (!samples || samples.length < LEARN_MIN_SAMPLES) return;
    const profile = this.profileOf(equipmentId);
    if (!profile) return;
    const watts = Math.round(trimmedMedian(samples));
    const runs = (profile.learned?.runs ?? 0) + 1;
    this.equipments.setEnergyProfileLearned(equipmentId, {
      watts,
      atIso: new Date().toISOString(),
      runs,
    });
  }

  // ── Small helpers ───────────────────────────────────────────

  private profileOf(equipmentId: string): EnergyLoadProfile | undefined {
    return this.equipments.getById(equipmentId)?.energyProfile;
  }

  private nameOf(equipmentId: string): string {
    return this.equipments.getById(equipmentId)?.name ?? equipmentId;
  }

  private isPowerAlias(equipmentId: string, alias: string): boolean {
    const bindings = this.equipments.getDataBindingsWithValues(equipmentId);
    const powerBinding =
      bindings.find((b) => b.category === "power") ?? bindings.find((b) => b.alias === "power");
    return powerBinding?.alias === alias;
  }

  private grantedClaims(): ClaimRecord[] {
    return [...this.claims.values()].filter((c) => c.status === "granted");
  }

  private hasGrants(): boolean {
    return this.grantedClaims().length > 0;
  }

  private grantedClaimFor(equipmentId: string): ClaimRecord | undefined {
    return this.grantedClaims().find((c) => c.equipmentId === equipmentId);
  }

  private priorityRank(equipmentId: string): number {
    const idx = this.config.priority.indexOf(equipmentId);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  }

  private grantedBottomUp(): ClaimRecord[] {
    return this.grantedClaims().sort(
      (a, b) => this.priorityRank(b.equipmentId) - this.priorityRank(a.equipmentId),
    );
  }

  private pendingOrdered(): ClaimRecord[] {
    const slackRank: Record<CapacitySlack, number> = { none: 0, some: 1, high: 2 };
    return [...this.claims.values()]
      .filter((c) => c.status === "pending")
      .sort(
        (a, b) =>
          slackRank[a.slack] - slackRank[b.slack] ||
          this.priorityRank(a.equipmentId) - this.priorityRank(b.equipmentId),
      );
  }

  private minOnMs(equipmentId: string): number {
    return (this.profileOf(equipmentId)?.minOnS ?? 900) * 1000;
  }

  private minOffMs(equipmentId: string): number {
    return (this.profileOf(equipmentId)?.minOffS ?? 300) * 1000;
  }

  private isSuspended(equipmentId: string): boolean {
    const until = this.overridesUntil.get(equipmentId);
    return until !== undefined && until > Date.now();
  }

  private pendingReason(claim: ClaimRecord, headroomW: number): string {
    if (this.isSuspended(claim.equipmentId)) return "override-active";
    if (this.unresponsiveUntil.has(claim.equipmentId)) return "unresponsive";
    const revokedAt = this.lastRevokedAt.get(claim.equipmentId);
    if (revokedAt !== undefined && Date.now() - revokedAt < this.minOffMs(claim.equipmentId)) {
      return "min-off-cooldown";
    }
    return `insufficient-surplus:${Math.max(0, Math.round(headroomW))}`;
  }

  private runState(): ArbiterRunState {
    if (!this.config.enabled) return "disabled";
    if (
      this.lastMeterAt === null ||
      Date.now() - this.lastMeterAt > this.config.staleAfterS * 1000
    ) {
      return "degraded";
    }
    return "active";
  }

  private emitStatus(availableW?: number): void {
    const state = this.runState();
    // Coarsen to the nearest 25 W so the status event fires on a meaningful
    // change, not on every meter sample (the raw surplus jitters by >1 W
    // almost continuously — review #7; the architecture wants "on change").
    const raw = availableW ?? this.accounting().availableW;
    const availableSurplusW = state === "active" ? Math.round(raw / 25) * 25 : null;
    const prev = this.lastStatus;
    if (prev && prev.state === state && prev.availableSurplusW === availableSurplusW) return;
    this.lastStatus = { state, availableSurplusW };
    this.emitEvent({ type: "energy.arbiter.status", state, availableSurplusW });
  }

  private journal(
    entry: Omit<ArbiterDecision, "atIso" | "equipmentName"> & { equipmentId?: string },
  ): void {
    const full: ArbiterDecision = {
      atIso: new Date().toISOString(),
      equipmentName: entry.equipmentId ? this.nameOf(entry.equipmentId) : undefined,
      ...entry,
    };
    this.journalEntries.push(full);
    if (this.journalEntries.length > JOURNAL_CAP) this.journalEntries.shift();
    const { kind, ...ctx } = full;
    this.logger.info({ decision: kind, ...ctx }, `Arbiter decision: ${kind}`);
  }

  private emitEvent(event: EngineEvent): void {
    this.eventBus.emit(event);
  }

  private guarded(fn: () => void, claim: ClaimRecord, which: string): void {
    try {
      fn();
    } catch (err) {
      this.logger.error(
        { err, equipmentId: claim.equipmentId, instanceId: claim.instanceId, callback: which },
        "Recipe claim callback threw",
      );
    }
  }
}
