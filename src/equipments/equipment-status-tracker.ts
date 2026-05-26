/**
 * EquipmentStatusTracker (spec 116).
 *
 * Listens to device + equipment events, recomputes equipment.status on a
 * debounced cadence + a periodic wallclock tick (for staleness transitions
 * that fire without any event), and emits `equipment.status.changed` on
 * transitions so the WebSocket layer can push updates to UI clients.
 */

import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "./equipment-manager.js";
import type { EquipmentStatus } from "../shared/types.js";

/** Coalesce bursts of device events (e.g. integration startup) into a single recompute. */
const DEBOUNCE_MS = 200;

/** Wallclock cadence for catching staleness transitions when no event fires. */
const TICK_MS = 60_000;

export class EquipmentStatusTracker {
  private logger: Logger;
  private equipmentManager: EquipmentManager;
  private eventBus: EventBus;

  private currentStatus = new Map<string, EquipmentStatus>();
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(equipmentManager: EquipmentManager, eventBus: EventBus, logger: Logger) {
    this.equipmentManager = equipmentManager;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "equipment-status-tracker" });
  }

  start(): void {
    // Take an initial snapshot so we only emit on subsequent transitions.
    for (const equipment of this.equipmentManager.getAllWithDetails()) {
      this.currentStatus.set(equipment.id, equipment.status);
    }

    this.unsubscribe = this.eventBus.on((event) => {
      switch (event.type) {
        case "device.status_changed":
        case "device.data.updated":
        case "equipment.created":
        case "equipment.updated":
          this.scheduleRecompute();
          break;
        case "equipment.removed":
          this.currentStatus.delete(event.equipmentId);
          break;
      }
    });

    // Catch staleness transitions even when no event fires.
    this.tickTimer = setInterval(() => this.recompute(), TICK_MS);
    if (typeof this.tickTimer.unref === "function") this.tickTimer.unref();

    this.logger.info({ initialCount: this.currentStatus.size }, "Equipment status tracker started");
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private scheduleRecompute(): void {
    if (this.pendingTimer) return; // already scheduled within the debounce window
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.recompute();
    }, DEBOUNCE_MS);
    if (typeof this.pendingTimer.unref === "function") this.pendingTimer.unref();
  }

  /** Iterate equipments, emit on every status transition. Visible for tests. */
  recompute(): void {
    for (const equipment of this.equipmentManager.getAllWithDetails()) {
      const previous = this.currentStatus.get(equipment.id);
      if (previous === equipment.status) continue;
      this.currentStatus.set(equipment.id, equipment.status);
      // First-time observation (no previous): skip the event but seed the cache.
      if (previous === undefined) continue;
      this.eventBus.emit({
        type: "equipment.status.changed",
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        oldStatus: previous,
        newStatus: equipment.status,
      });
      this.logger.info(
        {
          equipmentId: equipment.id,
          equipmentName: equipment.name,
          oldStatus: previous,
          newStatus: equipment.status,
        },
        "Equipment status changed",
      );
    }
  }
}
