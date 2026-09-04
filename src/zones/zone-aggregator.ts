import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { ZoneManager } from "./zone-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { SunlightManager } from "./sunlight-manager.js";
import type {
  DataCategory,
  EquipmentStatus,
  EquipmentType,
  ZoneAggregatedData,
  DataBindingWithValue,
  Zone,
} from "../shared/types.js";
import { ROOT_ZONE_ID } from "../shared/constants.js";
import { isSubmeterEquipment } from "../equipments/metering.js";
import {
  LIVE_POWER_ALIASES,
  classifyPowerReading,
  BUDGET_LEARNING_MS,
} from "../shared/reading-freshness.js";

// ============================================================
// Internal accumulator for aggregation (tracks sums + counts)
// ============================================================

interface Accumulator {
  temperatureSum: number;
  temperatureCount: number;
  humiditySum: number;
  humidityCount: number;
  luminositySum: number;
  luminosityCount: number;
  motion: boolean;
  motionSensors: number;
  openDoors: number;
  openWindows: number;
  waterLeak: boolean;
  smoke: boolean;
  lightsOn: number;
  lightsTotal: number;
  shutterPositionSum: number;
  shutterPositionCount: number;
  shuttersOpen: number;
  shuttersTotal: number;
  waterValvesOpen: number;
  waterValvesTotal: number;
  waterFlowSum: number;
  waterFlowHasData: boolean;
  /** Spec 170 — running sum of the live `power` of this zone's submeters. */
  powerSum: number;
  /** Spec 170 — whether any submeter landed in `powerSum`, so 0 W stays distinct from "no meter". */
  powerHasData: boolean;
  /** Spec 120 — displays online (EquipmentStatus === "online") vs total. */
  displaysOnline: number;
  displaysTotal: number;
  /** Per-DataCategory count of equipments skipped because status === "offline" (spec 116). */
  unavailableByCategory: Partial<Record<DataCategory, number>>;
}

function emptyAccumulator(): Accumulator {
  return {
    temperatureSum: 0,
    temperatureCount: 0,
    humiditySum: 0,
    humidityCount: 0,
    luminositySum: 0,
    luminosityCount: 0,
    motion: false,
    motionSensors: 0,
    openDoors: 0,
    openWindows: 0,
    waterLeak: false,
    smoke: false,
    lightsOn: 0,
    lightsTotal: 0,
    shutterPositionSum: 0,
    shutterPositionCount: 0,
    shuttersOpen: 0,
    shuttersTotal: 0,
    waterValvesOpen: 0,
    waterValvesTotal: 0,
    waterFlowSum: 0,
    waterFlowHasData: false,
    powerSum: 0,
    powerHasData: false,
    displaysOnline: 0,
    displaysTotal: 0,
    unavailableByCategory: {},
  };
}

function mergeUnavailable(
  a: Partial<Record<DataCategory, number>>,
  b: Partial<Record<DataCategory, number>>,
): Partial<Record<DataCategory, number>> {
  const result: Partial<Record<DataCategory, number>> = { ...a };
  for (const [cat, count] of Object.entries(b) as [DataCategory, number][]) {
    result[cat] = (result[cat] ?? 0) + count;
  }
  return result;
}

function mergeAccumulators(a: Accumulator, b: Accumulator): Accumulator {
  return {
    temperatureSum: a.temperatureSum + b.temperatureSum,
    temperatureCount: a.temperatureCount + b.temperatureCount,
    humiditySum: a.humiditySum + b.humiditySum,
    humidityCount: a.humidityCount + b.humidityCount,
    luminositySum: a.luminositySum + b.luminositySum,
    luminosityCount: a.luminosityCount + b.luminosityCount,
    motion: a.motion || b.motion,
    motionSensors: a.motionSensors + b.motionSensors,
    openDoors: a.openDoors + b.openDoors,
    openWindows: a.openWindows + b.openWindows,
    waterLeak: a.waterLeak || b.waterLeak,
    smoke: a.smoke || b.smoke,
    lightsOn: a.lightsOn + b.lightsOn,
    lightsTotal: a.lightsTotal + b.lightsTotal,
    shutterPositionSum: a.shutterPositionSum + b.shutterPositionSum,
    shutterPositionCount: a.shutterPositionCount + b.shutterPositionCount,
    shuttersOpen: a.shuttersOpen + b.shuttersOpen,
    shuttersTotal: a.shuttersTotal + b.shuttersTotal,
    waterValvesOpen: a.waterValvesOpen + b.waterValvesOpen,
    waterValvesTotal: a.waterValvesTotal + b.waterValvesTotal,
    waterFlowSum: a.waterFlowSum + b.waterFlowSum,
    waterFlowHasData: a.waterFlowHasData || b.waterFlowHasData,
    powerSum: a.powerSum + b.powerSum,
    powerHasData: a.powerHasData || b.powerHasData,
    displaysOnline: a.displaysOnline + b.displaysOnline,
    displaysTotal: a.displaysTotal + b.displaysTotal,
    unavailableByCategory: mergeUnavailable(a.unavailableByCategory, b.unavailableByCategory),
  };
}

function accumulatorToPublic(acc: Accumulator): ZoneAggregatedData {
  return {
    temperature:
      acc.temperatureCount > 0
        ? Math.round((acc.temperatureSum / acc.temperatureCount) * 10) / 10
        : null,
    humidity:
      acc.humidityCount > 0 ? Math.round((acc.humiditySum / acc.humidityCount) * 10) / 10 : null,
    luminosity:
      acc.luminosityCount > 0 ? Math.round(acc.luminositySum / acc.luminosityCount) : null,
    motion: acc.motion,
    motionSensors: acc.motionSensors,
    motionSince: null, // Set separately — not accumulated
    openDoors: acc.openDoors,
    openWindows: acc.openWindows,
    waterLeak: acc.waterLeak,
    smoke: acc.smoke,
    lightsOn: acc.lightsOn,
    lightsTotal: acc.lightsTotal,
    shuttersOpen: acc.shuttersOpen,
    shuttersTotal: acc.shuttersTotal,
    averageShutterPosition:
      acc.shutterPositionCount > 0
        ? Math.round(acc.shutterPositionSum / acc.shutterPositionCount)
        : null,
    waterValvesOpen: acc.waterValvesOpen,
    waterValvesTotal: acc.waterValvesTotal,
    waterFlowTotal: acc.waterFlowHasData ? Math.round(acc.waterFlowSum * 100) / 100 : null,
    // Whole watts, not tenths. The pill prints an integer below the kilowatt
    // and one decimal of a kilowatt above it, so a tenth of a watt is never
    // displayed — it only guarantees that sub-watt jitter on an idle plug
    // flips `aggregatedDataEqual` and emits `zone.data.changed` up the whole
    // ancestor chain. Rounding here also means the number the API and MQTT
    // publish is the number the pill shows.
    powerTotal: acc.powerHasData ? Math.round(acc.powerSum) : null,
    sunrise: null,
    sunset: null,
    isDaylight: null,
    displaysOnline: acc.displaysOnline,
    displaysTotal: acc.displaysTotal,
    unavailableEquipmentsByCategory: acc.unavailableByCategory,
  };
}

/**
 * Compare aggregated data excluding motionSince (which is derived, not accumulated).
 */
function aggregatedDataEqual(a: ZoneAggregatedData, b: ZoneAggregatedData): boolean {
  return (
    a.temperature === b.temperature &&
    a.humidity === b.humidity &&
    a.luminosity === b.luminosity &&
    a.motion === b.motion &&
    a.motionSensors === b.motionSensors &&
    a.openDoors === b.openDoors &&
    a.openWindows === b.openWindows &&
    a.waterLeak === b.waterLeak &&
    a.smoke === b.smoke &&
    a.lightsOn === b.lightsOn &&
    a.lightsTotal === b.lightsTotal &&
    a.shuttersOpen === b.shuttersOpen &&
    a.shuttersTotal === b.shuttersTotal &&
    a.averageShutterPosition === b.averageShutterPosition &&
    a.waterValvesOpen === b.waterValvesOpen &&
    a.waterValvesTotal === b.waterValvesTotal &&
    a.waterFlowTotal === b.waterFlowTotal &&
    a.powerTotal === b.powerTotal &&
    a.sunrise === b.sunrise &&
    a.sunset === b.sunset &&
    a.isDaylight === b.isDaylight &&
    a.displaysOnline === b.displaysOnline &&
    a.displaysTotal === b.displaysTotal &&
    unavailableEqual(a.unavailableEquipmentsByCategory, b.unavailableEquipmentsByCategory)
  );
}

function unavailableEqual(
  a: Partial<Record<DataCategory, number>>,
  b: Partial<Record<DataCategory, number>>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key as DataCategory] !== b[key as DataCategory]) return false;
  }
  return true;
}

/**
 * Compute motionSince for a zone based on current vs previous motion state.
 * Only updates the timestamp on actual motion state transitions.
 */
function resolveMotionSince(
  newData: ZoneAggregatedData,
  oldData: ZoneAggregatedData | undefined,
  now: string,
): string | null {
  if (newData.motionSensors === 0) return null;
  // If previous data exists and motion state is unchanged, keep the old timestamp
  if (oldData && oldData.motionSince && oldData.motion === newData.motion) {
    return oldData.motionSince;
  }
  // Motion state changed (or first computation) — record transition time
  return now;
}

// ============================================================
// Helpers to check boolean active state
// ============================================================

function isBooleanActive(value: unknown): boolean {
  return value === true || value === "ON";
}

function isContactOpen(value: unknown): boolean {
  return value === false || value === "OFF";
}

// ============================================================
// Zone Aggregator
// ============================================================

/**
 * Wallclock cadence for re-judging the freshness of a zone's power readings.
 *
 * `powerTotal` drops a reading past its budget (spec 170), but the aggregator
 * only recomputes when an equipment reports, and a clamp that went quiet
 * reports nothing by definition. Without a clock the sum keeps a reading that
 * has since aged out for as long as the zone stays quiet, which in the case
 * spec 170 is written for — a guest house whose zone holds two meters and
 * nothing else — is forever.
 *
 * `equipment.status.changed` is not enough on its own: `equipment-status.ts`
 * applies the electrical window only to METERING_EQUIPMENT_TYPES, so a metering
 * plug stays `online` however old its watts are and never emits a transition.
 *
 * One minute matches EquipmentStatusTracker's own tick, and only zones that
 * actually contribute power are recomputed.
 */
const POWER_FRESHNESS_TICK_MS = 60_000;

export class ZoneAggregator {
  private logger: Logger;
  private eventBus: EventBus;
  private zoneManager: ZoneManager;
  private equipmentManager: EquipmentManager;
  private sunlightManager: SunlightManager | null = null;
  private unsubscribe: (() => void) | null = null;
  private freshnessTimer: ReturnType<typeof setInterval> | null = null;

  // Cache: per-zone accumulators and public data
  private directCache = new Map<string, Accumulator>();
  private mergedCache = new Map<string, Accumulator>();
  private publicCache = new Map<string, ZoneAggregatedData>();

  constructor(
    zoneManager: ZoneManager,
    equipmentManager: EquipmentManager,
    eventBus: EventBus,
    logger: Logger,
  ) {
    this.zoneManager = zoneManager;
    this.equipmentManager = equipmentManager;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "zone-aggregator" });

    this.setupEventListeners();
    this.startFreshnessTimer();
  }

  /**
   * Re-judge the freshness of the zones that carry power readings, on a
   * wallclock tick (see POWER_FRESHNESS_TICK_MS).
   *
   * Only zones whose own equipments landed in the power sum are walked: the
   * cached flag is the trigger AND the stop condition, since a zone whose last
   * reading ages out recomputes once, clears the flag, and goes quiet again.
   */
  private startFreshnessTimer(): void {
    this.freshnessTimer = setInterval(() => {
      try {
        const zoneIds = [...this.directCache.entries()]
          .filter(([, acc]) => acc.powerHasData)
          .map(([zoneId]) => zoneId);
        for (const zoneId of zoneIds) {
          this.recomputeZoneChain(zoneId, "power freshness tick");
        }
      } catch (err) {
        this.logger.error({ err }, "Error in zone aggregator freshness tick");
      }
    }, POWER_FRESHNESS_TICK_MS);
    if (typeof this.freshnessTimer.unref === "function") this.freshnessTimer.unref();
  }

  setSunlightManager(sunlightManager: SunlightManager): void {
    this.sunlightManager = sunlightManager;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.freshnessTimer) {
      clearInterval(this.freshnessTimer);
      this.freshnessTimer = null;
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Get all zone aggregated data.
   */
  getAll(): Record<string, ZoneAggregatedData> {
    const result: Record<string, ZoneAggregatedData> = {};
    for (const [zoneId, data] of this.publicCache) {
      result[zoneId] = data;
    }
    return result;
  }

  /**
   * Get aggregated data for a single zone.
   */
  getByZoneId(zoneId: string): ZoneAggregatedData | null {
    return this.publicCache.get(zoneId) ?? null;
  }

  /**
   * Compute aggregation for all zones (called on startup).
   */
  computeAll(): void {
    const zones = this.zoneManager.getAll();

    // Build parent→children map
    const childrenMap = new Map<string | null, Zone[]>();
    for (const zone of zones) {
      const siblings = childrenMap.get(zone.parentId) ?? [];
      siblings.push(zone);
      childrenMap.set(zone.parentId, siblings);
    }

    // Compute direct accumulators for all zones
    for (const zone of zones) {
      this.directCache.set(zone.id, this.computeDirectAccumulator(zone.id));
    }

    // Compute merged accumulators bottom-up (process leaves first)
    const computed = new Set<string>();
    const computeZone = (zoneId: string): void => {
      if (computed.has(zoneId)) return;

      // Compute children first
      const children = childrenMap.get(zoneId) ?? [];
      for (const child of children) {
        computeZone(child.id);
      }

      // Merge direct + all children
      let merged = this.directCache.get(zoneId) ?? emptyAccumulator();
      for (const child of children) {
        const childMerged = this.mergedCache.get(child.id);
        if (childMerged) {
          merged = mergeAccumulators(merged, childMerged);
        }
      }

      this.mergedCache.set(zoneId, merged);
      const pub = accumulatorToPublic(merged);
      const oldPub = this.publicCache.get(zoneId);
      pub.motionSince = resolveMotionSince(pub, oldPub, now);
      this.injectSunlightData(zoneId, pub);
      this.publicCache.set(zoneId, pub);
      computed.add(zoneId);
    };

    const now = new Date().toISOString();
    for (const zone of zones) {
      computeZone(zone.id);
    }

    this.logger.info({ zoneCount: zones.length }, "Zone aggregation computed for all zones");
  }

  // ============================================================
  // Event listeners
  // ============================================================

  private setupEventListeners(): void {
    this.unsubscribe = this.eventBus.on((event) => {
      try {
        switch (event.type) {
          case "equipment.data.changed":
            this.handleEquipmentDataChanged(event.equipmentId);
            break;
          case "equipment.created":
          case "equipment.updated":
            this.handleEquipmentChanged(event.equipment.zoneId);
            break;
          case "equipment.removed":
            this.recomputeZoneChain(event.zoneId);
            break;
          case "zone.created":
          case "zone.updated":
          case "zone.removed":
            this.computeAll();
            break;
          case "sunlight.changed":
            this.recomputeZoneChain(ROOT_ZONE_ID);
            break;
          case "system.started":
            this.computeAll();
            break;
        }
      } catch (err) {
        this.logger.error({ err, eventType: event.type }, "Error in zone aggregator event handler");
      }
    });
  }

  // ============================================================
  // Recomputation logic
  // ============================================================

  private handleEquipmentDataChanged(equipmentId: string): void {
    const equipment = this.equipmentManager.getById(equipmentId);
    if (!equipment) return;

    this.recomputeZoneChain(equipment.zoneId, equipment.name);
  }

  private handleEquipmentChanged(zoneId: string): void {
    this.recomputeZoneChain(zoneId);
  }

  /**
   * Recompute a zone and walk up the parent chain.
   */
  private recomputeZoneChain(zoneId: string, triggerName?: string): void {
    const zones = this.zoneManager.getAll();
    const zoneMap = new Map(zones.map((z) => [z.id, z]));
    const childrenMap = new Map<string, Zone[]>();
    for (const zone of zones) {
      if (zone.parentId) {
        const siblings = childrenMap.get(zone.parentId) ?? [];
        siblings.push(zone);
        childrenMap.set(zone.parentId, siblings);
      }
    }

    let currentId: string | null = zoneId;
    let recomputeDirect = true;
    const now = new Date().toISOString();
    const updatedZones: string[] = [];

    while (currentId) {
      const zone = zoneMap.get(currentId);
      if (!zone) break;

      // Only recompute direct accumulator for the originating zone
      if (recomputeDirect) {
        this.directCache.set(currentId, this.computeDirectAccumulator(currentId));
        recomputeDirect = false;
      }

      // Merge direct + all children
      let merged = this.directCache.get(currentId) ?? emptyAccumulator();
      const children = childrenMap.get(currentId) ?? [];
      for (const child of children) {
        const childMerged = this.mergedCache.get(child.id);
        if (childMerged) {
          merged = mergeAccumulators(merged, childMerged);
        }
      }

      this.mergedCache.set(currentId, merged);
      const newPublic = accumulatorToPublic(merged);
      const oldPublic = this.publicCache.get(currentId);

      // Resolve motionSince before equality check
      newPublic.motionSince = resolveMotionSince(newPublic, oldPublic, now);
      this.injectSunlightData(currentId, newPublic);

      if (!oldPublic || !aggregatedDataEqual(oldPublic, newPublic)) {
        this.publicCache.set(currentId, newPublic);
        this.eventBus.emit({
          type: "zone.data.changed",
          zoneId: currentId,
          aggregatedData: newPublic,
        });
        updatedZones.push(zone.name);
        this.logger.trace({ zoneId: currentId, zoneName: zone.name }, "Zone aggregation updated");
      } else {
        // Even if aggregation data is unchanged, update cache with motionSince
        this.publicCache.set(currentId, newPublic);
      }

      currentId = zone.parentId;
    }

    if (updatedZones.length > 0) {
      this.logger.debug(
        { trigger: triggerName, zonesUpdated: updatedZones },
        "Zone chain recomputed",
      );
    }
  }

  /**
   * Inject sunlight data into root zone aggregation.
   */
  private injectSunlightData(zoneId: string, data: ZoneAggregatedData): void {
    if (zoneId !== ROOT_ZONE_ID || !this.sunlightManager) return;
    const sunlight = this.sunlightManager.getSunlightData();
    data.sunrise = sunlight.sunrise;
    data.sunset = sunlight.sunset;
    data.isDaylight = sunlight.isDaylight;
  }

  /**
   * Compute the direct accumulator for a zone from its own equipments.
   *
   * Spec 116: equipments whose derived status === "offline" are excluded from
   * numeric aggregation. Each of their data-binding categories increments
   * `unavailableByCategory` so the UI can surface "(N unavailable)" hints.
   * Degraded equipments still contribute their last known values.
   */
  private computeDirectAccumulator(zoneId: string): Accumulator {
    const equipments = this.equipmentManager.getByZone(zoneId);
    const acc = emptyAccumulator();

    for (const equipment of equipments) {
      if (equipment.type === "weather") continue; // Exclude weather from zone aggregation
      const withDetails = this.equipmentManager.getByIdWithDetails(equipment.id);
      if (!withDetails) continue;

      // Spec 120 — `display` zone counters are equipment-level (not
      // binding-level), so they run before the offline early-out: total
      // counts every display regardless of status, online counts only
      // those with EquipmentStatus === "online" (degraded / offline excluded).
      if (equipment.type === "display") {
        acc.displaysTotal += 1;
        if (withDetails.status === "online") {
          acc.displaysOnline += 1;
        }
      }

      if (withDetails.status === "offline") {
        for (const binding of withDetails.dataBindings) {
          acc.unavailableByCategory[binding.category] =
            (acc.unavailableByCategory[binding.category] ?? 0) + 1;
        }
        continue;
      }

      const bindings = withDetails.dataBindings;
      this.accumulateEquipmentPower(acc, equipment.type, withDetails.status, bindings);
      if (equipment.type === "water_valve") {
        this.accumulateWaterValve(acc, bindings);
      } else {
        this.accumulateBindings(acc, bindings, equipment.type);
      }
    }

    return acc;
  }

  /**
   * Spec 170 — add one equipment's live draw to the zone's power sum.
   *
   * Runs at the equipment level rather than inside `accumulateBindings` because
   * the decision needs the equipment's TYPE and STATUS, not just a binding.
   *
   * Neither of the two rules below is restated here — both are the engine's
   * single implementation, so this surface can never drift from the by-usage
   * breakdown the way #744 saw two surfaces describe one appliance two
   * contradictory ways:
   *
   *  - `isSubmeterEquipment` (#523) decides what counts as a load. It excludes
   *    the grid total and the production meters, so the root zone sums the
   *    house's loads instead of the house total plus its own parts.
   *  - `classifyPowerReading` (#832) decides whether the reading is a live
   *    measurement. A stale one is DROPPED, never counted as 0 W — a clamp that
   *    stopped reporting says nothing about whether its load is running.
   *
   * Note this is deliberately stricter than the rest of the aggregation for a
   * `degraded` equipment. Elsewhere a degraded equipment still contributes its
   * last known value, which is right for a temperature — a room does not cool
   * because a sensor went quiet. It is wrong for a load: the whole point of
   * #744 is that a stale `0 W` reads as "this appliance is off", and a water
   * heater drawing 560 W displayed as 0 W is the bug that spec exists for.
   */
  private accumulateEquipmentPower(
    acc: Accumulator,
    equipmentType: EquipmentType,
    status: EquipmentStatus,
    bindings: DataBindingWithValue[],
  ): void {
    if (!isSubmeterEquipment(equipmentType, bindings)) return;

    // The alias order the equipment tiles use (`pickLivePowerW`), so a meter
    // counted on one surface is counted on the other. It held a `demand_5min`
    // fallback until spec 175 established that no plugin has ever produced
    // that alias.
    let powerBinding: DataBindingWithValue | undefined;
    for (const alias of LIVE_POWER_ALIASES) {
      // A non-numeric reading is a state, not a measurement (a thermostat's own
      // on/off switch); `isSubmeterEquipment` makes the same distinction.
      powerBinding = bindings.find((b) => b.alias === alias && typeof b.value === "number");
      if (powerBinding) break;
    }
    if (!powerBinding || typeof powerBinding.value !== "number") return;

    const verdict = classifyPowerReading({
      status,
      value: powerBinding.value,
      lastUpdated: powerBinding.lastUpdated,
      equipmentType,
      // Resolved once by the engine from the source's own cadence and carried
      // on the binding (spec 175), so this total and the tile that draws the
      // same meter cannot disagree about its age. Absent means the engine did
      // not resolve it, never "no budget".
      budgetMs: powerBinding.freshnessBudgetMs ?? BUDGET_LEARNING_MS,
    });
    if (verdict !== "current") return;

    // Summed as reported: no absolute value, no clamp at zero. A clamp mounted
    // backwards reports negative watts, and a negative total is a wiring fault
    // the user needs to see. (`PowerSubmeterIntegrator` integrates |P| for
    // energy per spec 091 — that protects a cumulative counter, a different
    // question.)
    acc.powerSum += powerBinding.value;
    acc.powerHasData = true;
  }

  /**
   * Accumulate a water_valve equipment: count total/open and sum flow.
   * Uses alias-based lookup since the SONOFF SWV state is misclassified as light_state.
   */
  private accumulateWaterValve(acc: Accumulator, bindings: DataBindingWithValue[]): void {
    acc.waterValvesTotal += 1;
    const stateBinding = bindings.find((b) => b.alias === "state");
    if (stateBinding && isBooleanActive(stateBinding.value)) {
      acc.waterValvesOpen += 1;
      const flowBinding = bindings.find((b) => b.alias === "flow");
      if (flowBinding && typeof flowBinding.value === "number") {
        acc.waterFlowSum += flowBinding.value;
        acc.waterFlowHasData = true;
      }
    }
  }

  /**
   * Accumulate data bindings into an accumulator.
   */
  private static readonly LIGHT_EQUIPMENT_TYPES: ReadonlySet<EquipmentType> = new Set([
    "light_onoff",
    "light_dimmable",
    "light_color",
  ]);

  private accumulateBindings(
    acc: Accumulator,
    bindings: DataBindingWithValue[],
    equipmentType: EquipmentType,
  ): void {
    for (const binding of bindings) {
      const category: DataCategory = binding.category;
      const value = binding.value;

      switch (category) {
        case "temperature":
          // Only aggregate actual temperature readings (alias "temperature"),
          // not setpoints or outside temperatures from thermostats
          if (typeof value === "number" && binding.alias === "temperature") {
            acc.temperatureSum += value;
            acc.temperatureCount += 1;
          }
          break;

        case "humidity":
          if (typeof value === "number") {
            acc.humiditySum += value;
            acc.humidityCount += 1;
          }
          break;

        case "luminosity":
          if (typeof value === "number") {
            acc.luminositySum += value;
            acc.luminosityCount += 1;
          }
          break;

        case "motion":
          acc.motionSensors += 1;
          if (isBooleanActive(value)) {
            acc.motion = true;
          }
          break;

        case "contact_door":
          if (isContactOpen(value)) {
            acc.openDoors += 1;
          }
          break;

        case "contact_window":
          if (isContactOpen(value)) {
            acc.openWindows += 1;
          }
          break;

        case "water_leak":
          if (isBooleanActive(value)) {
            acc.waterLeak = true;
          }
          break;

        case "smoke":
          if (isBooleanActive(value)) {
            acc.smoke = true;
          }
          break;

        case "light_state":
          if (ZoneAggregator.LIGHT_EQUIPMENT_TYPES.has(equipmentType)) {
            acc.lightsTotal += 1;
            if (isBooleanActive(value)) {
              acc.lightsOn += 1;
            }
          }
          break;

        case "shutter_position":
          // Only `shutter` equipments feed the shutter zone aggregates.
          // Awnings and pool covers share this data category but are
          // intentionally NOT aggregated at the zone level — their dashboard
          // widgets compute their own counts locally, and letting them in
          // here would surface zone-level shutter pills and bulk commands
          // on zones that contain only awnings or pool covers (e.g. an
          // Outdoor → Pool subtree showing a phantom "all shutters" command).
          // The `allShuttersOpen/Stop/Close` zone orders already target
          // type=shutter only.
          if (equipmentType === "shutter") {
            acc.shuttersTotal += 1;
            if (typeof value === "number") {
              acc.shutterPositionSum += value;
              acc.shutterPositionCount += 1;
              if (value > 0) {
                acc.shuttersOpen += 1;
              }
            }
          }
          break;
      }
    }
  }
}
