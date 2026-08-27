/**
 * CapacityArbiter — spec 140.
 *
 * Single reader of the grid meter, arbitrating solar surplus between declared
 * flexible loads through reservation accounting: the release pass keys off the
 * SIGNED grid reading (`signedGridW − tolerances`) and the grant pass off the
 * live export (`exportW`) plus each claim's own draw, so a drop in export
 * caused by its own grants never reads as "surplus gone" (the only honest
 * deficit signal is a real net import, per review decision 10).
 *
 * The user-facing "Surplus / déficit" figure (`availableSurplusW`, curve +
 * pill) is the true signed grid balance `exportW` (>0 exporting, <0 importing)
 * — NOT a reservation-inflated total, which read as a phantom surplus equal to
 * production while importing (#563). The arbiter issues no orders in phase 1 — recipes act,
 * the arbiter decides — and everything it does lands in a bounded decision
 * journal ("why" first-class, FR-8).
 */

import { randomUUID } from "node:crypto";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { ArbiterJournalStore } from "./arbiter-journal-store.js";
import type { ArbiterSurplusStore } from "./arbiter-surplus-store.js";
import type { SunlightManager } from "../zones/sunlight-manager.js";
import { buildLoadTimelines, sustainedAfter } from "./arbiter-timeline.js";
import { RETRY_CHANNEL } from "../equipments/order-confirmation-tracker.js";
import type {
  ArbiterDecision,
  ArbiterLoadInfo,
  ArbiterLoadState,
  ArbiterPublicState,
  ArbiterTimeline,
  ArbiterRunState,
  CapacityClaimHandle,
  CapacityClaimRequest,
  CapacityDenyReason,
  CapacityRevokeReason,
  CapacitySlack,
  EnergyLoadProfile,
  EngineEvent,
  OrderSource,
} from "../shared/types.js";

const SETTING_PREFIX = "energy.arbiter.";
const JOURNAL_CAP = 200;
// #543 — how far back start() scans the persisted journal for open unclaimed
// runs. The deepest timeline page ends 48h back (route depth cap), spans up
// to 12h, and getTimeline adds a 24h entering-state lookback — decisions up
// to 84h old can still paint a quarter.
const REHYDRATE_LOOKBACK_MS = (48 + 12 + 24) * 3_600_000;
const LIVE_DRAW_TAU_S = 30; // per-load EMA time constant
const LIVE_DRAW_FRESH_MS = 120_000; // tier-1 freshness window
const LEARN_SAMPLE_FLOOR = 0.25; // learner ignores samples below 25 % of nominal
const LEARN_MIN_SAMPLES = 3;
const LEARN_SAMPLE_CAP = 500;
const DIVERGENCE_RATIO = 0.3; // watts-divergence threshold vs declared nominal
// Below this, a load is not running: standby, a thermostat that has opened, a
// breaker left off. A fraction of the declared nominal, BOUNDED at both ends —
// unbounded, 10 % of a 5 kW load would read 400 W of real import as "idle" and
// hand the anti-cascade excuse away (review #733), while 10 % of a 100 W pump
// would never be reached. Used by the revoke watchdog, which must never accuse
// a load that draws nothing, and must never excuse one that still draws.
const IDLE_DRAW_RATIO = 0.1;
const IDLE_DRAW_FLOOR_W = 20;
const IDLE_DRAW_CEIL_W = 100;
// Spec 165 review — the status event coalesces on a 25 W-quantized surplus so
// it fires on a meaningful change, not on every meter sample. Dormancy is part
// of that same coalescing key, so it has to read the export through the SAME
// quantum: comparing the raw export to 0 flips `dormant` on the ±1 W jitter a
// battery home shows at night, which defeated the guard and made an open tab
// refetch (and flicker) on every sample.
const STATUS_QUANTUM_W = 25;
const quantizeW = (w: number): number => Math.round(w / STATUS_QUANTUM_W) * STATUS_QUANTUM_W;
const TICK_MS = 10_000;
// Spec 164 — how long a granted load's measured draw must contradict the state
// the ribbon is showing before the transition is journaled. Long enough that a
// thermostat cycling mid-run does not fill the journal, short enough to be
// visible at the ribbon's 15-min resolution.
const DRAW_CONFIRM_MS = 300_000;

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
  /** Spec 147 — optional persistence for the decision journal (history only,
   *  never the live control state). Undefined = in-memory only (pre-147). */
  private journalStore?: ArbiterJournalStore;
  /** Spec 148 — optional persistence for the signed surplus/deficit series. */
  private surplusStore?: ArbiterSurplusStore;
  /** Spec 165 — daylight source for the dormant flag (#577). Optional and
   *  read-only: a missing sun source never changes an arbitration decision,
   *  it only means the surface never reads as dormant. */
  private sunlight?: SunlightManager;

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
  /** Last reported on/off STATE per profiled load, every class (#535). The
   *  confirm timing lives in `divergenceSince`, not here — this is only the
   *  current state to compare the grant expectation against, and the source
   *  of the `running` flag journaled on suspended/resumed. */
  private reportedOnOff = new Map<string, boolean>();
  /** When the current (grant-expectation vs reported-state) contradiction
   *  began — the confirm window is measured from here, NOT from the last
   *  state transition, so a load idle+OFF before it is granted does not read
   *  as "already diverged for minutes" the instant the grant lands. */
  private divergenceSince = new Map<string, number>();
  private recentComfortRevoke = new Map<string, { instanceId: string; at: number }>();
  /** Spec 164 — per granted load, the draw state the ribbon is CURRENTLY
   *  showing (true = consuming), and when the measurement started contradicting
   *  it. Absent = not observed: no grant, or no measurement seen yet. */
  private drawState = new Map<string, boolean>();
  private drawChangeSince = new Map<string, number>();

  private deficitSince: number | null = null;
  private watchdogs: RevokeWatchdog[] = [];
  private lastStatus: {
    state: ArbiterRunState;
    availableSurplusW: number | null;
    dormant: boolean;
  } | null = null;
  /**
   * ~5 min samples of the signed grid surplus for the day-timeline curve
   * (FR-10). #563 — this holds exportW (>0 surplus, <0 déficit), the true grid
   * balance, not the reservation availableW. The field keeps its `availableW`
   * name to match the persisted store / API shape.
   */
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
    journalStore?: ArbiterJournalStore, // spec 147 — persist the decision journal
    surplusStore?: ArbiterSurplusStore, // spec 148 — persist the signed surplus series
    sunlight?: SunlightManager, // spec 165 — daylight for the dormant flag
  ) {
    this.eventBus = eventBus;
    this.settings = settings;
    this.equipments = equipments;
    this.logger = logger.child({ module: "capacity-arbiter" });
    this.shadowMode = shadowMode;
    this.journalStore = journalStore;
    this.surplusStore = surplusStore;
    this.sunlight = sunlight;
    this.config = this.readConfig();
  }

  // ── Lifecycle ───────────────────────────────────────────────

  start(): void {
    // Spec 147 — restore the decision journal from persisted history (oldest
    // first, matching the ring) so it survives a restart. History only: live
    // control state (claims, suspensions, surplus) is still rebuilt from events.
    if (this.journalStore && this.journalEntries.length === 0) {
      const recent = this.journalStore.loadRecent(JOURNAL_CAP);
      this.journalEntries.push(...recent);
      if (recent.length > 0) {
        this.logger.info({ count: recent.length }, "Arbiter decision journal restored from store");
      }
    }
    this.rehydrateUnclaimedRuns();
    this.closeStaleClaimTails();
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

    // Reported on/off state, tracked for EVERY profiled load (#535 review):
    // comfort loads (the PAC) stop on their own regulation too, and that state
    // report is the only signal the arbiter gets — no order is emitted. The
    // wall-switch divergence REACTION (FR-6) stays deferrable-only in
    // checkStateDivergence; only the observation is class-wide. Two gates keep
    // the observation honest: `isBooleanState` accepts boolean / "on"|"off"
    // strings and rejects numbers (measurement bindings report numeric 0 when
    // a thermostat opens mid-run, which must NOT read as a wall-switch OFF),
    // and `isStateAlias` pins the equipment's actual state binding (a load can
    // expose other boolean aliases — window detection, child lock — that must
    // not be read as its run state).
    if (isBooleanState(value) && this.isStateAlias(equipmentId, alias)) {
      const on = isOnLike(value);
      this.reportedOnOff.set(equipmentId, on);
      // Closed on the FIRST OFF report, no confirm window (decision): a
      // boolean state report is authoritative, unlike a power reading — and
      // keeping the span open was exactly issue #535. A stale retained OFF
      // replayed on reconnect closes the span early; the next recipe ON
      // order simply opens a fresh unclaimed run.
      if (!on) this.endUnclaimedRun(equipmentId);
    }
  }

  private onOrderExecuted(
    equipmentId: string,
    value: unknown,
    source: OrderSource | undefined,
  ): void {
    if (!this.config.enabled) return;
    const profile = this.profileOf(equipmentId);
    if (!profile) return;
    const now = Date.now();

    // A human (manual/button) or an external system taking control backs the
    // arbiter off for overrideTtlS so it does not fight them. The delivery-retry
    // channel is excluded: that is the order-confirmation tracker re-sending
    // Sowel's OWN last unconfirmed order after a device reconnect (typically a
    // recipe order), not a person — counting it as a manual override spuriously
    // suspended flexible loads on flaky links (#420).
    // An unclaimed run ends on ANY observed OFF order, whatever its source:
    // only the recipe branch used to close it, so a manual OFF (which returns
    // through the suspend path below) left the load painted "on outside
    // arbitration" on the timeline indefinitely (#535).
    if (isOffLike(value)) this.endUnclaimedRun(equipmentId);

    if (
      source?.kind === "manual" ||
      source?.kind === "button" ||
      (source?.kind === "external" && source.channel !== RETRY_CHANNEL)
    ) {
      // The order value tells the resulting on/off state; an order that is
      // neither (e.g. a setpoint) falls back to the last observed state.
      const running = isOnLike(value)
        ? true
        : isOffLike(value)
          ? false
          : this.observedRunning(equipmentId);
      this.suspend(equipmentId, "user-order", running);
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
      // The unclaimed-run END is handled above for orders of every source, not
      // just recipes (#535).
    }
  }

  /**
   * Rebuild the open unclaimed runs from the persisted journal (#543): the
   * Set is live control state and starts empty after a restart, so without
   * this the first observed OFF early-returns in endUnclaimedRun and the
   * matching `unclaimed-run-ended` is never journaled — the timeline keeps
   * painting the load "unmanaged" until its next full run cycle.
   *
   * Scans the store, not the in-memory ring: the ring is capped at
   * JOURNAL_CAP entries and a chatty journal can evict the opening entry
   * while the timeline (which reads the store directly) still paints it.
   * Journals nothing — it only refills the Set.
   */
  private rehydrateUnclaimedRuns(): void {
    const now = Date.now();
    // Accepted degradation: range() returns [] on a DB error (it never
    // throws), and the ring is NOT used as a fallback then — it may hold
    // entries older than the lookback, which must not rehydrate.
    const decisions =
      this.journalStore?.range(
        new Date(now - REHYDRATE_LOOKBACK_MS).toISOString(),
        new Date(now).toISOString(),
      ) ?? this.journalEntries;
    const open = new Set<string>();
    for (const d of decisions) {
      if (!d.equipmentId) continue;
      switch (d.kind) {
        case "unclaimed-run":
          open.add(d.equipmentId);
          break;
        case "unclaimed-run-ended":
          open.delete(d.equipmentId);
          break;
        // Deliberate divergence from live semantics (grant() leaves the Set
        // untouched): after a `granted` the timeline paints the load as
        // managed anyway, and a stale open flag would only suppress the
        // journaling of its next genuine unclaimed run.
        case "granted":
          open.delete(d.equipmentId);
          break;
        // An OFF-triggered suspension left the load stopped (#536). Rows
        // written before v1.48.1 carry it WITHOUT a preceding
        // `unclaimed-run-ended` — without this case the scan would rehydrate
        // a load that is known off.
        case "suspended":
          if (d.running === false) open.delete(d.equipmentId);
          break;
        // Same reasoning for a TTL/manual resume observed with the load OFF:
        // the timeline already paints it idle, so a stale open flag would
        // only suppress the journaling of the next genuine unclaimed run.
        case "resumed":
          if (d.running === false) open.delete(d.equipmentId);
          break;
        default:
          break;
      }
    }
    for (const id of open) {
      // Deleted since the entry was journaled — mirror forgetEquipment.
      if (!this.equipments.getById(id)) continue;
      this.unclaimedRunning.add(id);
    }
    if (this.unclaimedRunning.size > 0) {
      this.logger.info(
        { count: this.unclaimedRunning.size },
        "Open unclaimed runs rehydrated from journal",
      );
    }
  }

  /**
   * #604 — close a phantom claim span left open by a restart. Live claim state
   * is rebuilt from scratch on startup (not persisted), so a grant/pending claim
   * that was live at shutdown has no closing event in the journal: the timeline
   * replay would paint its `granted`/`granted-idle`/`pending` state forward to
   * now. For every equipment whose last *sustained* journal state is
   * granted/granted-idle/pending yet has no live claim, journal a `reset`
   * (stamped now, i.e. the restart boundary) so
   * the span closes there instead of running to the present. Runs after
   * `rehydrateUnclaimedRuns` so `unmanaged` runs are owned by that scan, not
   * this one (we only touch claim-derived states).
   */
  private closeStaleClaimTails(): void {
    const lastState = new Map<string, ReturnType<typeof sustainedAfter>>();
    for (const d of this.journalEntries) {
      if (!d.equipmentId) continue;
      const s = sustainedAfter(d.kind, d.running);
      if (s) lastState.set(d.equipmentId, s);
    }
    let closed = 0;
    for (const [equipmentId, state] of lastState) {
      // Spec 164 — `granted-idle` is a grant too (a tail ending on a
      // `draw-stopped`), so it needs the same closing `reset`: left out, the
      // ribbon would paint the muted green forward to now for ever and
      // `grantedS` would bill the whole gap.
      if (state !== "granted" && state !== "granted-idle" && state !== "pending") continue;
      // A live claim (rebuilt by a recipe that already re-claimed) means the tail
      // is genuine — leave it. At startup this is normally empty.
      if (this.grantedClaimFor(equipmentId) || this.pendingClaimFor(equipmentId)) continue;
      if (!this.equipments.getById(equipmentId)) continue; // deleted since
      this.journal({ kind: "reset", equipmentId, reason: "engine restart" });
      closed += 1;
    }
    if (closed > 0) {
      this.logger.info({ count: closed }, "Stale arbiter claim tails closed on startup");
    }
  }

  /**
   * Close an unclaimed run (#535): journaled so the run reads as a span on the
   * timeline — without an end the lane could only ever show where it started,
   * which says nothing about how long the load held power outside arbitration.
   * Called on any observed OFF: an order from any source, or a reported OFF
   * state (a load stopping on its own regulation never emits an order).
   */
  private endUnclaimedRun(equipmentId: string): void {
    if (!this.unclaimedRunning.has(equipmentId)) return;
    this.unclaimedRunning.delete(equipmentId);
    this.journal({
      kind: "unclaimed-run-ended",
      equipmentId,
      reason: "run outside arbitration finished",
    });
    this.finishLearnerRun(equipmentId);
    // #584 — the unclaimed run overlaid the lane as "unmanaged"; its end resets
    // the sustained state to "idle" in buildLoadTimelines. If a pending surplus
    // claim is still held underneath (e.g. the pump kept claiming surplus while
    // it ran on an off-peak slot), re-open its "waiting" span so the timeline
    // keeps showing the load waiting for surplus instead of falsely idle.
    const pending = this.pendingClaimFor(equipmentId);
    if (pending) {
      this.journal({ kind: "waiting", equipmentId, watts: pending.watts });
    }
  }

  /**
   * Best-effort on/off state of a load as the arbiter knows it (#535): a
   * granted claim or an unclaimed run means ON; otherwise the last reported
   * boolean state (undefined if never seen).
   */
  private observedRunning(equipmentId: string): boolean | undefined {
    if (this.grantedClaimFor(equipmentId) !== undefined) return true;
    if (this.unclaimedRunning.has(equipmentId)) return true;
    return this.reportedOnOff.get(equipmentId);
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
    this.clearDrawState(equipmentId);
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
      // #550 — the tolerance is a property of the load: the claim may override
      // it, but the equipment's energyProfile is the default source of truth
      // (mirrors how `watts` falls back to nominalPowerW above).
      toleratedImportW: Math.max(0, req.toleratedImportW ?? profile.toleratedImportW ?? 0),
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

    // #561 — a claim still pending after the first evaluation is waiting for
    // surplus. Journal it once so the timeline can paint a "pending" span (and
    // the roster's read model reflects a live claim). A claim granted straight
    // away by the evaluate above already journaled `granted` and is skipped.
    if (record.status === "pending") {
      this.journal({ kind: "waiting", equipmentId: record.equipmentId, watts: record.watts });
    }

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
    this.journal({
      kind: "resumed",
      equipmentId,
      reason: "resume control",
      running: this.observedRunning(equipmentId),
    });
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

  /**
   * Spec 148 (Phase B) — the arbitrage timeline for a window ending at `endMs`
   * spanning `hours` hours, at `stepMin` steps: per-load quarter states
   * reconstructed from the (persisted) decision journal, the signed surplus
   * series, and the in-window journal for the cell → journal link.
   */
  getTimeline(endMs: number, hours: number, stepMin = 15): ArbiterTimeline {
    const stepMs = stepMin * 60_000;
    // Quantize the window edge down to a step boundary so the quarter cells fall
    // on clock ticks (:00/:15/:30/:45); the UI's hour labels and hour-edge
    // markers key off `getMinutes() === 0`, which only lands right when the
    // cells are clock-aligned (spec 148 review #4).
    const windowEnd = Math.floor(endMs / stepMs) * stepMs;
    const windowStart = windowEnd - hours * 3_600_000;
    const lookback = windowStart - 24 * 3_600_000; // enough to know the entering state
    // Spec 165 review — the same roster the read model builds, so a load
    // claimed before an admin ever opened the settings page gets a ribbon lane
    // under its roster row instead of a row with nothing beneath it.
    const loads = this.rosterIds().map((id) => ({ equipmentId: id, name: this.nameOf(id) }));

    // Decisions: prefer the persisted store; fall back to the in-memory ring.
    let decisions =
      this.journalStore?.range(
        new Date(lookback).toISOString(),
        new Date(windowEnd).toISOString(),
      ) ?? [];
    if (decisions.length === 0) {
      decisions = this.journalEntries.filter((d) => {
        const t = Date.parse(d.atIso);
        return t >= lookback && t <= windowEnd;
      });
    }

    // Spec 165 — dormancy reads the CURRENT waiting claim as at rest, matching
    // the roster pill. It applies only when the window actually ends now: a
    // page scrolled back to yesterday afternoon must not have its last cell
    // rewritten by tonight's sunset.
    const dormant = windowEnd >= Date.now() - stepMs && this.isDormant();
    const timelines = buildLoadTimelines(
      decisions,
      loads,
      windowStart,
      windowEnd,
      stepMin,
      dormant,
    );

    // Surplus: prefer the persisted store; fall back to the in-memory 24h ring.
    let surplus = this.surplusStore?.range(windowStart, windowEnd) ?? [];
    if (surplus.length === 0) {
      surplus = this.surplusSeries.filter((s) => s.at >= windowStart && s.at <= windowEnd);
    }

    const journal = decisions
      .filter((d) => {
        const t = Date.parse(d.atIso);
        return t >= windowStart && t <= windowEnd;
      })
      .reverse(); // newest first

    return {
      windowStartIso: new Date(windowStart).toISOString(),
      windowEndIso: new Date(windowEnd).toISOString(),
      stepMin,
      loads: timelines,
      surplus: surplus.map((s) => ({
        atIso: new Date(s.at).toISOString(),
        availableW: s.availableW,
      })),
      journal,
    };
  }

  /**
   * Spec 165 (#577) — the arbiter is *dormant*: the sun is down and there is no
   * surplus to distribute. Published in the read model so the roster pill and
   * the ribbon's current cell read a waiting claim the same way; before, the
   * roster computed this alone and the ribbon painted "en attente" all night.
   *
   * No sun source (not injected, or no home coordinates) means never dormant —
   * the pre-165 fallback, unchanged. A home battery exporting at night keeps a
   * positive surplus, which is real capacity to arbitrate, so it stays active.
   */
  private isDormant(exportW?: number): boolean {
    const isDaylight = this.sunlight?.getSunlightData().isDaylight ?? null;
    if (isDaylight !== false) return false;
    if (this.runState() !== "active") return false;
    return quantizeW(exportW ?? this.accounting().headroomW) <= 0;
  }

  /**
   * Spec 165 — the state of one load right now, in the union the ribbon uses.
   * This is the ONLY place a current state is decided; the UI renders it.
   *
   * Branch order is the pre-165 behaviour, preserved:
   *  - suspension first, because a suspended load cannot be granted (`evaluate`
   *    skips it), so the suspension is its truthful dominant state even when a
   *    pending claim lingers behind it;
   *  - `unmanaged` before `pending` and before dormancy, because a load that is
   *    drawing power is never "waiting" and never "at rest", whatever the hour
   *    and whatever claim sits behind it (#491).
   *
   * The granted split reads `drawState` (spec 164), NOT the live measurement:
   * `drawState` is what the ribbon currently shows, so the two halves cannot
   * disagree, and a reading the ribbon has not yet accepted cannot flicker the
   * pill.
   */
  private resolveLoadState(equipmentId: string, dormant: boolean): ArbiterLoadState {
    if (this.isSuspended(equipmentId)) return "suspended";
    if (this.grantedClaimFor(equipmentId) !== undefined) {
      return this.drawState.get(equipmentId) === false ? "granted-idle" : "granted";
    }
    if (this.unclaimedRunning.has(equipmentId)) return "unmanaged";
    if (this.pendingClaimFor(equipmentId) !== undefined) return dormant ? "idle" : "pending";
    return "idle";
  }

  /**
   * Spec 165 — the equipment ids the surface shows, in the order it shows them:
   * the configured priority first, then any load holding a claim or a
   * suspension without being in that list. A load whose profile was dropped
   * keeps its place only while it still holds a claim or a suspension,
   * otherwise there is nothing left to show.
   *
   * Spec 165 review — the read model roster and the timeline ribbon BOTH read
   * this. Building the ribbon lanes from `config.priority` alone put a
   * "Granted" roster row on screen with no lane under it, which is exactly the
   * roster/ribbon divergence this spec exists to remove.
   */
  private rosterIds(): string[] {
    const claimedOrSuspended = [
      ...new Set([
        ...[...this.claims.values()]
          .filter((c) => c.status === "granted" || c.status === "pending")
          .map((c) => c.equipmentId),
        ...[...this.overridesUntil.keys()].filter((id) => this.isSuspended(id)),
      ]),
    ];
    return [
      ...this.config.priority,
      ...claimedOrSuspended.filter((id) => !this.config.priority.includes(id)),
    ].filter(
      (id) =>
        this.profileOf(id) !== undefined ||
        this.grantedClaimFor(id) !== undefined ||
        this.pendingClaimFor(id) !== undefined ||
        this.isSuspended(id),
    );
  }

  /**
   * Spec 165 — the roster, resolved engine-side: every load `rosterIds()` lists,
   * each with its state and its figures. This is the single source the UI
   * renders; it decides nothing on its own.
   */
  private buildLoads(dormant: boolean, headroomW: number): ArbiterLoadInfo[] {
    return this.rosterIds().map((id) => {
      const state = this.resolveLoadState(id, dormant);
      const profile = this.profileOf(id);
      const info: ArbiterLoadInfo = {
        equipmentId: id,
        equipmentName: this.nameOf(id),
        state,
        watts: null,
        needW: null,
        toleratedImportW: profile ? Math.max(0, profile.toleratedImportW ?? 0) : null,
      };
      if (state === "granted" || state === "granted-idle") {
        const granted = this.grantedClaimFor(id);
        info.watts = granted ? Math.round(this.effectiveWatts(granted)) : null;
        info.sinceIso = new Date(granted?.grantedAt ?? Date.now()).toISOString();
        info.instanceId = granted?.instanceId;
        info.note = granted?.note;
        return info;
      }
      if (state === "suspended") {
        info.untilIso = new Date(this.overridesUntil.get(id) ?? Date.now()).toISOString();
        return info;
      }
      // Pending, unmanaged and at rest all show what the load draws. A
      // pending claim knows its own figure; anything else falls back to the
      // live draw while it runs unmanaged, else its rating (#561: a metered
      // load that is off reports ~0 W, which would misread as "0 W" rather
      // than "what it draws when it runs").
      const pendingClaim = this.pendingClaimFor(id);
      if (pendingClaim && state === "pending") {
        info.watts = pendingClaim.watts;
        info.needW = Math.round(this.engageNeedW(pendingClaim));
        info.reasonWaiting = this.pendingReason(pendingClaim, headroomW);
        info.instanceId = pendingClaim.instanceId;
        info.toleratedImportW = pendingClaim.toleratedImportW;
        return info;
      }
      if (this.unclaimedRunning.has(id)) {
        info.watts = Math.round(this.drawEstimate(id));
      } else if (pendingClaim) {
        info.watts = pendingClaim.watts;
      } else if (profile) {
        info.watts = Math.round(profile.learned?.watts ?? profile.nominalPowerW);
      }
      return info;
    });
  }

  getPublicState(): ArbiterPublicState {
    const now = Date.now();
    const state = this.runState();
    const accounting = this.accounting();
    const dormant = this.isDormant();
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
    const suspensions = [...this.overridesUntil.entries()]
      .filter(([, until]) => until > now)
      .map(([equipmentId, until]) => ({
        equipmentId,
        equipmentName: this.nameOf(equipmentId),
        untilIso: new Date(until).toISOString(),
      }));
    const suspendedIds = new Set(suspensions.map((s) => s.equipmentId));
    // A load can hold a pending claim (created before a manual override) AND be
    // suspended at the same time: `suspend()` revokes only a GRANTED claim, so a
    // claim that was still `pending` when the wall-switch-on / user-order
    // override fired lingers. It cannot be granted while suspended (`evaluate`
    // skips suspended loads), so it is dormant — the suspension is the truthful
    // dominant state. Excluding suspended IDs here (mirroring `idle` below)
    // stops the same equipment surfacing twice: once "En attente
    // (override-active)" and once "Suspendu".
    const pending = [...this.claims.values()]
      .filter((c) => c.status === "pending" && !suspendedIds.has(c.equipmentId))
      .map((c) => ({
        equipmentId: c.equipmentId,
        equipmentName: this.nameOf(c.equipmentId),
        instanceId: c.instanceId,
        watts: c.watts,
        needW: Math.round(this.engageNeedW(c)),
        toleratedImportW: c.toleratedImportW,
        reasonWaiting: this.pendingReason(c, accounting.headroomW),
        // A pending claim whose load a recipe is already running as a must-run
        // fallback (tracked in unclaimedRunning) is drawing power, not idle —
        // the UI relabels it "running (no surplus)" instead of "waiting" (#491).
        running: this.unclaimedRunning.has(c.equipmentId),
      }));
    // #561 — declared flexible loads (priority order) that hold no claim and are
    // not suspended: neither granted nor pending. They have a timeline lane but
    // were absent from the read model, so the UI could not show them "at rest".
    const claimedIds = new Set(
      [...this.claims.values()]
        .filter((c) => c.status === "granted" || c.status === "pending")
        .map((c) => c.equipmentId),
    );
    const idle = this.config.priority
      .filter((id) => !claimedIds.has(id) && !suspendedIds.has(id))
      // Still declared flexible and still present (profile dropped / deleted →
      // no longer part of the roster).
      .filter((id) => this.profileOf(id) !== undefined)
      .map((id) => {
        const profile = this.profileOf(id) as EnergyLoadProfile;
        const runningUnmanaged = this.unclaimedRunning.has(id);
        // At rest, show the load's RATING (learned, else nominal), not its live
        // draw: a metered load that is off reports ~0 W on its power binding, and
        // `drawEstimate` would surface that 0 W and misrepresent the load as "0 W"
        // rather than "what it draws when it runs" (#561). When it is actually
        // running outside arbitration, the live draw is the honest figure.
        const watts = runningUnmanaged
          ? Math.round(this.drawEstimate(id))
          : Math.round(profile.learned?.watts ?? profile.nominalPowerW);
        return {
          equipmentId: id,
          equipmentName: this.nameOf(id),
          watts,
          toleratedImportW: Math.max(0, profile.toleratedImportW ?? 0),
          runningUnmanaged,
        };
      });
    return {
      // Display flag — reflects the configured setting, NOT the control gate.
      // On a shadow instance `config.enabled` is forced false so the arbiter
      // never acts (spec 124), but spec 124 also promises the shadow is "fully
      // usable as a UI: everything that reads state still works". Gating the
      // read-only arbitration surface on the control flag would hide it on
      // shadow, breaking that promise and making the surface impossible to QA.
      // Control paths still gate on `config.enabled`; this is display only.
      enabled: this.settings.get(SETTING_PREFIX + "enabled") === "true",
      state,
      // Spec 165 — the roster, resolved here rather than in the browser.
      loads: this.buildLoads(dormant, accounting.headroomW),
      dormant,
      // #563 — the user-facing figure is the TRUE signed grid balance
      // (headroomW ≡ exportW: >0 exporting, <0 importing), NOT the
      // reservation-inflated availableW. A home importing while its managed
      // loads soak up production must read as a deficit, not a phantom surplus
      // equal to production. Reservation accounting stays internal to the
      // grant/revoke passes (it keeps a grant from reading "surplus gone").
      availableSurplusW: state === "active" ? Math.round(accounting.headroomW) : null,
      productionDetected: this.equipments
        .getAll()
        .some((e) => e.type === "energy_production_meter" || e.type === "solar_panel"),
      grants,
      pending,
      suspensions,
      idle,
      // #616 — surface the configured order (highest first) so the roster table
      // can list loads by priority like the timeline, not grouped by state.
      priority: [...this.config.priority],
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

    // Expire suspensions. Journaled (#535): a silent lapse left the timeline
    // painting the pre-expiry state indefinitely — the hand-back must be an
    // event the timeline can key on, exactly like an explicit resume.
    for (const [eq, until] of this.overridesUntil) {
      if (until <= now) {
        this.overridesUntil.delete(eq);
        this.journal({
          kind: "resumed",
          equipmentId: eq,
          reason: "override-expired",
          running: this.observedRunning(eq),
        });
      }
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
    this.checkGrantDraw(now);

    const { signedGridW, exportW } = this.accounting();

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
      const needW = this.engageNeedW(claim);
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
    // #563 — persist the TRUE signed grid balance (exportW: >0 surplus, <0
    // déficit), matching the "Surplus / déficit" axis. The reservation
    // availableW would keep the curve positive while importing (a grant does
    // not dent it), which read as a phantom surplus equal to production.
    if (now - this.lastSurplusSampleAt >= 5 * 60_000) {
      this.lastSurplusSampleAt = now;
      const sample = { at: now, availableW: Math.round(exportW) };
      this.surplusSeries.push(sample);
      this.surplusStore?.insert(sample); // spec 148 — persist for the 48h timeline
      const dayAgo = now - 24 * 3_600_000;
      while (this.surplusSeries.length > 0 && this.surplusSeries[0].at < dayAgo) {
        this.surplusSeries.shift();
      }
    }

    this.emitStatus(exportW);
  }

  // ── Accounting helpers ──────────────────────────────────────

  private accounting(): {
    signedGridW: number;
    exportW: number;
    headroomW: number;
  } {
    // #563 — decisions key off the signed grid reading directly: the release
    // pass on `signedGridW − tolerances`, the grant pass on `exportW` (headroom)
    // plus each claim's own draw. The reservation is applied per-claim through
    // `effectiveWatts` in those passes; there is no longer a summed
    // `availableW`/`reservedW`, which used to feed the display only and made a
    // grant read as phantom surplus while importing. `headroomW ≡ exportW`.
    const signedGridW = this.emaPowerW ?? 0;
    const exportW = -signedGridW;
    return { signedGridW, exportW, headroomW: exportW };
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

  /**
   * Direct evidence that a load is NOT consuming right now (#732).
   *
   * Measurement first — a fresh own-power reading below the idle threshold is
   * proof, whatever the relay reports.
   *
   * Failing that, the load's own reported on/off STATE, but ONLY for a load
   * that declares no shutdown inertia (review #733). `releaseDelayS` exists
   * for the appliance whose contact opens — reporting itself OFF — while its
   * heat pump keeps drawing for half an hour (#631); on such a load the state
   * report says nothing about the current, and trusting it would hand back the
   * anti-cascade excuse exactly when the tail needs it.
   *
   * A load with neither (no power binding, never reported a state, or an
   * inertial load with no measurement) is unknown, and callers fall back to
   * the grid-export proxy.
   */
  private notDrawing(equipmentId: string): boolean {
    const measured = this.measuredIdle(equipmentId);
    if (measured !== null) return measured;
    if ((this.profileOf(equipmentId)?.releaseDelayS ?? 0) > 0) return false;
    const reportedOn = this.reportedOnOff.get(equipmentId);
    if (reportedOn !== undefined) return !reportedOn;
    return false;
  }

  /**
   * Idleness as the load's OWN meter reports it — `null` when there is no fresh
   * reading, which callers must treat as "unknown", never as "idle" (spec 164
   * FR-2/FR-5: the ribbon may not claim knowledge the arbiter does not have).
   */
  private measuredIdle(equipmentId: string): boolean | null {
    const live = this.freshLiveDraw(equipmentId);
    if (live === null) return null;
    const nominal = this.profileOf(equipmentId)?.nominalPowerW ?? 0;
    const threshold = Math.min(
      IDLE_DRAW_CEIL_W,
      Math.max(IDLE_DRAW_FLOOR_W, nominal * IDLE_DRAW_RATIO),
    );
    return live < threshold;
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
    this.clearDrawState(claim.equipmentId);
    this.lastRevokedAt.set(claim.equipmentId, Date.now());
    this.finishLearnerRun(claim.equipmentId);
    const profile = this.profileOf(claim.equipmentId);
    if (profile?.class === "comfort") {
      this.recentComfortRevoke.set(claim.equipmentId, {
        instanceId: claim.instanceId,
        at: Date.now(),
      });
    }
    // Arm the watchdog only when there is something to honor (#732). A load
    // that was drawing nothing at the revoke — physically off, breaker open,
    // thermostat satisfied — cannot make the export "recover", so the proxy
    // below would accuse it the moment the sun drops or another load starts.
    // `watts <= 0` is the same case seen through the effective-watts tier: a
    // 0 W threshold makes any noise dip read as unhonored.
    if (
      (reason === "surplus-deficit" || reason === "priority-preempted") &&
      watts > 0 &&
      !this.notDrawing(claim.equipmentId)
    ) {
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
    // #561 — a revoke for a genuine surplus reason returns the claim to
    // pending. Unless the recipe released it in the onRevoked callback above,
    // the load is now waiting for surplus again: journal it so the timeline
    // reopens a "pending" span right after the "revoked" cell. Disabled /
    // meter-stale / manual-override revokes are excluded — those are not a
    // "still wants it, waiting" situation.
    if (
      (reason === "surplus-deficit" || reason === "priority-preempted") &&
      claim.status === "pending"
    ) {
      this.journal({ kind: "waiting", equipmentId: claim.equipmentId, watts: claim.watts });
    }
  }

  private release(claim: ClaimRecord): void {
    if (claim.status === "denied" || claim.status === "released") return;
    const wasGranted = claim.status === "granted";
    const wasPending = claim.status === "pending";
    claim.status = "released";
    if (wasGranted) {
      this.finishLearnerRun(claim.equipmentId);
      this.clearDrawState(claim.equipmentId);
    }
    // #584 — close the timeline span for a pending claim too, not only a
    // granted one. `claimCapacity` journals `waiting` when a claim stays
    // pending (#561); without a matching close, a claim released while still
    // pending leaves its "en attente" span open to the window edge in
    // buildLoadTimelines (the "PAC en attente toute la nuit" bug).
    if (wasGranted || wasPending) {
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

  private suspend(equipmentId: string, why: string, running?: boolean): void {
    this.clearDrawState(equipmentId);
    const until = Date.now() + this.config.overrideTtlS * 1000;
    this.overridesUntil.set(equipmentId, until);
    const granted = this.grantedClaimFor(equipmentId);
    if (granted) this.revoke(granted, "manual-override");
    // `running` reaches the journal so the timeline can tell an OFF-triggered
    // suspension (load stopped → idle) from a takeover that left it on (#535).
    this.journal({ kind: "suspended", equipmentId, reason: why, running });
    this.logger.info({ equipmentId, why }, "Arbitration suspended (manual override)");
    // Force a status event: suspending an IDLE (ungranted) load revokes
    // nothing, so without this the UI (which refreshes on energy.* events)
    // would not learn about the new suspension until the next full fetch —
    // and the "Manual until HH:MM" chip + Resume would not appear.
    this.forceStatusEmit();
  }

  // ── Watchdogs & divergence ──────────────────────────────────

  private checkWatchdogs(now: number): void {
    // After a revoke the load has a grace window to actually stop (export to
    // return). Two effects, deliberately DECOUPLED (#631):
    //
    //  - at the GLOBAL releaseHoldS, a still-drawing load is excused as
    //    background (`unresponsive`) so the deficit pass does not cascade onto
    //    the next load down (FR-9 + review decision 12, acceptance "revokes
    //    nobody else"). This stays prompt whatever the declared inertia — the
    //    anti-cascade guarantee must not be delayed.
    //  - `revoke-not-honored` is JOURNALLED only once the load is genuinely
    //    OVERDUE: past its declared shutdown inertia `energyProfile.releaseDelayS`
    //    (default 0 → the global hold). An inertial load (e.g. a thermodynamic
    //    water heater whose heat pump runs ~30 min after its solar contact
    //    opens) thus stops emitting a benign, expected signal while the other
    //    loads keep the tight global grace.
    //
    // The `unresponsive` excuse lasts 2 × the per-load grace so it spans the
    // whole declared shutdown window.
    const holdMs = this.config.releaseHoldS * 1000;
    const exportNow = -(this.emaPowerW ?? 0);
    this.watchdogs = this.watchdogs.filter((w) => {
      if (this.grantedClaimFor(w.equipmentId)) return false; // re-granted, moot
      // Honored, by direct evidence (#732): the load's own measurement (or, for
      // a load declaring no inertia, its reported state) says it has stopped.
      // This outranks the export proxy, which never recovers when the
      // production falls or another load picks up the slack in the same window
      // — an evening revoke used to be flagged unhonored for that reason alone.
      // Drop the background excuse with it: a load that has genuinely stopped
      // must be back in the release pass, and grantable again.
      if (this.notDrawing(w.equipmentId)) {
        this.unresponsiveUntil.delete(w.equipmentId);
        return false;
      }
      // NOT lifting `unresponsiveUntil` here is deliberate (review #733): an
      // export that rose can be the sun coming back or a sibling stopping, so
      // this branch closes the watchdog without claiming the load is idle.
      if (exportNow - w.exportAtRevoke >= 0.5 * w.expectedW) return false; // honored
      const graceMs =
        Math.max(this.config.releaseHoldS, this.profileOf(w.equipmentId)?.releaseDelayS ?? 0) *
        1000;
      // Excuse the draw promptly (global hold) to keep the deficit pass from
      // shedding the next load — independent of the declared inertia.
      if (now - w.at >= holdMs && !this.unresponsiveUntil.has(w.equipmentId)) {
        this.unresponsiveUntil.set(w.equipmentId, now + 2 * graceMs);
      }
      // Flag as unhonored only once genuinely overdue (past the declared inertia).
      if (now - w.at >= graceMs) {
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

  /**
   * Spec 164 — does the surplus a load was granted actually go anywhere?
   *
   * Audit-only, like the watchdog above: it journals what the load's own meter
   * says and changes no decision. The ribbon paints a grant green; this tells
   * it when that green is describing an allocation nothing consumed (a water
   * heater whose breaker is open, a pump that never started).
   *
   * `drawState` holds what the RIBBON currently shows, not the last reading —
   * a grant paints the consuming green, so the first observation on a grant
   * seeds `true` whatever the meter says, and a load idle from the start flips
   * once, one confirmation window in, instead of being taken for
   * already-journaled.
   */
  private checkGrantDraw(now: number): void {
    for (const claim of this.grantedClaims()) {
      const eq = claim.equipmentId;
      const idle = this.measuredIdle(eq);
      // No fresh measurement: unknown, never "idle". Hold what the ribbon shows
      // and drop any pending confirmation — a stale window must not mature into
      // a transition when the data comes back (FR-5).
      if (idle === null) {
        this.drawChangeSince.delete(eq);
        continue;
      }
      if (!this.drawState.has(eq)) {
        this.drawState.set(eq, true);
        continue;
      }
      const drawing = !idle;
      if (this.drawState.get(eq) === drawing) {
        this.drawChangeSince.delete(eq);
        continue;
      }
      // Measure how long the contradiction has HELD, from its onset.
      const since = this.drawChangeSince.get(eq) ?? now;
      this.drawChangeSince.set(eq, since);
      if (now - since < DRAW_CONFIRM_MS) continue;
      this.drawState.set(eq, drawing);
      this.drawChangeSince.delete(eq);
      this.journal({
        kind: drawing ? "draw-started" : "draw-stopped",
        equipmentId: eq,
        watts: Math.round(this.freshLiveDraw(eq) ?? 0),
      });
    }
  }

  /** Spec 164 — every path out of a grant ends the draw observation. */
  private clearDrawState(equipmentId: string): void {
    this.drawState.delete(equipmentId);
    this.drawChangeSince.delete(equipmentId);
  }

  private checkStateDivergence(now: number): void {
    const confirmMs = this.config.divergenceConfirmS * 1000;
    for (const [equipmentId, reportedOn] of this.reportedOnOff) {
      // FR-6 reacts on deferrable loads only: a comfort load (thermostat-led)
      // legitimately switches itself on and off, so a mismatch with the
      // arbiter's book is regulation, not a human at a wall switch. Its state
      // is still OBSERVED above for #535 (unclaimed-run end, `running`).
      if (this.profileOf(equipmentId)?.class !== "deferrable") continue;
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
      // wallOn ⇔ the load is on: exactly one of wallOff/wallOn holds here.
      this.suspend(equipmentId, wallOff ? "wall-switch-off" : "wall-switch-on", wallOn);
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

  /**
   * Whether `alias` is the equipment's on/off STATE binding (#535 review):
   * mirrors isPowerAlias — prefer a state-categorised binding, fall back to
   * the conventional "state" alias (plugs/switches categorise as generic),
   * then to a BOOLEAN-valued "power" alias: cloud-API loads (the Panasonic
   * PAC) expose their on/off switch under "power" — a wattmeter binding reads
   * numeric there and never matches `isBooleanState`.
   */
  private isStateAlias(equipmentId: string, alias: string): boolean {
    const bindings = this.equipments.getDataBindingsWithValues(equipmentId);
    const stateBinding =
      bindings.find((b) => b.category === "appliance_state" || b.category === "light_state") ??
      bindings.find((b) => b.alias === "state") ??
      bindings.find((b) => b.alias === "power" && isBooleanState(b.value));
    return stateBinding?.alias === alias;
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

  private pendingClaimFor(equipmentId: string): ClaimRecord | undefined {
    return [...this.claims.values()].find(
      (c) => c.equipmentId === equipmentId && c.status === "pending",
    );
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

  /**
   * Surplus this claim has to see before it can engage.
   *
   * No floor at 0 (review #6): a claim whose `toleratedImportW` exceeds
   * `watts + engageMarginW` is explicitly willing to run while importing that
   * much, so a negative need is meaningful and must survive to the caller.
   */
  private engageNeedW(claim: ClaimRecord): number {
    return claim.watts + this.config.engageMarginW - claim.toleratedImportW;
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

  private emitStatus(signedSurplusW?: number): void {
    const state = this.runState();
    // Coarsen to the nearest 25 W so the status event fires on a meaningful
    // change, not on every meter sample (the raw surplus jitters by >1 W
    // almost continuously — review #7; the architecture wants "on change").
    // #563 — the emitted figure is the TRUE signed grid balance (headroomW ≡
    // exportW), consistent with the pill in getPublicState.
    const raw = signedSurplusW ?? this.accounting().headroomW;
    const quantized = quantizeW(raw);
    const availableSurplusW = state === "active" ? quantized : null;
    // Spec 165 — dormancy is part of what the surface shows and it flips on
    // sunset alone, with no meter change behind it. Without it here, an open
    // tab keeps the deficit sticker (and its loads "waiting") until the next
    // 25 W move, which after sunset can be minutes away.
    const dormant = this.isDormant(quantized);
    const prev = this.lastStatus;
    if (
      prev &&
      prev.state === state &&
      prev.availableSurplusW === availableSurplusW &&
      prev.dormant === dormant
    ) {
      return;
    }
    this.lastStatus = { state, availableSurplusW, dormant };
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
    // Spec 147 — persist so the journal survives a restart (never throws).
    this.journalStore?.insert(full);
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
