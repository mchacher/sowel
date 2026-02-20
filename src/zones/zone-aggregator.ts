import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { ZoneManager } from "./zone-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type {
  DataCategory,
  ZoneAggregatedData,
  DataBindingWithValue,
  Zone,
} from "../shared/types.js";

// ============================================================
// Internal accumulator for aggregation (tracks sums + counts)
// ============================================================

interface Accumulator {
  temperatureSum: number;
  temperatureCount: number;
  humiditySum: number;
  humidityCount: number;
  motion: boolean;
  openDoors: number;
  openWindows: number;
  waterLeak: boolean;
  smoke: boolean;
  lightsOn: number;
  lightsTotal: number;
}

function emptyAccumulator(): Accumulator {
  return {
    temperatureSum: 0,
    temperatureCount: 0,
    humiditySum: 0,
    humidityCount: 0,
    motion: false,
    openDoors: 0,
    openWindows: 0,
    waterLeak: false,
    smoke: false,
    lightsOn: 0,
    lightsTotal: 0,
  };
}

function mergeAccumulators(a: Accumulator, b: Accumulator): Accumulator {
  return {
    temperatureSum: a.temperatureSum + b.temperatureSum,
    temperatureCount: a.temperatureCount + b.temperatureCount,
    humiditySum: a.humiditySum + b.humiditySum,
    humidityCount: a.humidityCount + b.humidityCount,
    motion: a.motion || b.motion,
    openDoors: a.openDoors + b.openDoors,
    openWindows: a.openWindows + b.openWindows,
    waterLeak: a.waterLeak || b.waterLeak,
    smoke: a.smoke || b.smoke,
    lightsOn: a.lightsOn + b.lightsOn,
    lightsTotal: a.lightsTotal + b.lightsTotal,
  };
}

function accumulatorToPublic(acc: Accumulator): ZoneAggregatedData {
  return {
    temperature: acc.temperatureCount > 0
      ? Math.round((acc.temperatureSum / acc.temperatureCount) * 10) / 10
      : null,
    humidity: acc.humidityCount > 0
      ? Math.round((acc.humiditySum / acc.humidityCount) * 10) / 10
      : null,
    motion: acc.motion,
    openDoors: acc.openDoors,
    openWindows: acc.openWindows,
    waterLeak: acc.waterLeak,
    smoke: acc.smoke,
    lightsOn: acc.lightsOn,
    lightsTotal: acc.lightsTotal,
  };
}

function aggregatedDataEqual(a: ZoneAggregatedData, b: ZoneAggregatedData): boolean {
  return (
    a.temperature === b.temperature &&
    a.humidity === b.humidity &&
    a.motion === b.motion &&
    a.openDoors === b.openDoors &&
    a.openWindows === b.openWindows &&
    a.waterLeak === b.waterLeak &&
    a.smoke === b.smoke &&
    a.lightsOn === b.lightsOn &&
    a.lightsTotal === b.lightsTotal
  );
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

export class ZoneAggregator {
  private logger: Logger;
  private eventBus: EventBus;
  private zoneManager: ZoneManager;
  private equipmentManager: EquipmentManager;

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
      this.publicCache.set(zoneId, accumulatorToPublic(merged));
      computed.add(zoneId);
    };

    for (const zone of zones) {
      computeZone(zone.id);
    }

    this.logger.info({ zoneCount: zones.length }, "Zone aggregation computed for all zones");
  }

  // ============================================================
  // Event listeners
  // ============================================================

  private setupEventListeners(): void {
    this.eventBus.on((event) => {
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
            // On removal, recompute all (we don't know which zone it was in)
            this.computeAll();
            break;
          case "zone.created":
          case "zone.updated":
          case "zone.removed":
            this.computeAll();
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

    this.recomputeZoneChain(equipment.zoneId);
  }

  private handleEquipmentChanged(zoneId: string): void {
    this.recomputeZoneChain(zoneId);
  }

  /**
   * Recompute a zone and walk up the parent chain.
   */
  private recomputeZoneChain(zoneId: string): void {
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

      if (!oldPublic || !aggregatedDataEqual(oldPublic, newPublic)) {
        this.publicCache.set(currentId, newPublic);
        this.eventBus.emit({
          type: "zone.data.changed",
          zoneId: currentId,
          aggregatedData: newPublic,
        });
        this.logger.debug({ zoneId: currentId, aggregatedData: newPublic }, "Zone aggregation updated");
      }

      currentId = zone.parentId;
    }
  }

  /**
   * Compute the direct accumulator for a zone from its own equipments.
   */
  private computeDirectAccumulator(zoneId: string): Accumulator {
    const equipments = this.equipmentManager.getByZone(zoneId);
    const acc = emptyAccumulator();

    for (const equipment of equipments) {
      const bindings = this.equipmentManager.getDataBindingsWithValues(equipment.id);
      this.accumulateBindings(acc, bindings);
    }

    return acc;
  }

  /**
   * Accumulate data bindings into an accumulator.
   */
  private accumulateBindings(acc: Accumulator, bindings: DataBindingWithValue[]): void {
    for (const binding of bindings) {
      const category: DataCategory = binding.category;
      const value = binding.value;

      switch (category) {
        case "temperature":
          if (typeof value === "number") {
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

        case "motion":
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
          acc.lightsTotal += 1;
          if (isBooleanActive(value)) {
            acc.lightsOn += 1;
          }
          break;
      }
    }
  }
}
