import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EquipmentStatusTracker } from "./equipment-status-tracker.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EquipmentManager } from "./equipment-manager.js";
import type { EquipmentWithDetails, EngineEvent } from "../shared/types.js";

const testLogger = createLogger("silent").logger;

// Minimal stub of EquipmentManager — the tracker only ever calls getAllWithDetails().
function makeEquipmentManager(snapshots: EquipmentWithDetails[][]): {
  manager: EquipmentManager;
  advance: () => void;
} {
  let cursor = 0;
  const manager = {
    getAllWithDetails: () => snapshots[Math.min(cursor, snapshots.length - 1)],
  } as unknown as EquipmentManager;
  return {
    manager,
    advance: () => {
      cursor += 1;
    },
  };
}

function makeEquipment(
  id: string,
  status: EquipmentWithDetails["status"],
  name = id,
): EquipmentWithDetails {
  return {
    id,
    name,
    zoneId: "zone-1",
    type: "sensor",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    dataBindings: [],
    orderBindings: [],
    status,
  };
}

describe("EquipmentStatusTracker", () => {
  let bus: EventBus;
  let emitted: EngineEvent[];
  let unsub: (() => void) | null;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus(testLogger);
    emitted = [];
    unsub = bus.on((event) => {
      if (event.type === "equipment.status.changed") emitted.push(event);
    });
  });

  afterEach(() => {
    unsub?.();
    vi.useRealTimers();
  });

  it("does not emit on first observation (seeds the cache)", () => {
    const { manager } = makeEquipmentManager([[makeEquipment("eq-1", "online")]]);
    const tracker = new EquipmentStatusTracker(manager, bus, testLogger);
    tracker.start();
    tracker.recompute(); // explicit second pass — still no change
    expect(emitted).toHaveLength(0);
    tracker.destroy();
  });

  it("emits equipment.status.changed on online → offline transition", () => {
    const initial = [makeEquipment("eq-1", "online", "Compteur")];
    const next = [makeEquipment("eq-1", "offline", "Compteur")];
    const { manager, advance } = makeEquipmentManager([initial, next]);
    const tracker = new EquipmentStatusTracker(manager, bus, testLogger);
    tracker.start();

    advance();
    bus.emit({
      type: "device.status_changed",
      deviceId: "d-1",
      deviceName: "d",
      status: "offline",
    });
    vi.advanceTimersByTime(250); // past the 200ms debounce

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: "equipment.status.changed",
      equipmentId: "eq-1",
      equipmentName: "Compteur",
      oldStatus: "online",
      newStatus: "offline",
    });
    tracker.destroy();
  });

  it("coalesces bursts of events into a single recompute within the debounce window", () => {
    const initial = [makeEquipment("eq-1", "online")];
    const next = [makeEquipment("eq-1", "degraded")];
    const { manager, advance } = makeEquipmentManager([initial, next]);
    const tracker = new EquipmentStatusTracker(manager, bus, testLogger);
    tracker.start();

    advance();
    // Fire 5 events in rapid succession — debounce should coalesce to 1 recompute.
    for (let i = 0; i < 5; i++) {
      bus.emit({
        type: "device.data.updated",
        deviceId: "d-1",
        deviceName: "d",
        dataId: "dd-1",
        key: "k",
        value: i,
        previous: i - 1,
        timestamp: new Date().toISOString(),
      });
    }
    vi.advanceTimersByTime(250);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ oldStatus: "online", newStatus: "degraded" });
    tracker.destroy();
  });

  it("does not emit when status stays the same across events", () => {
    const { manager } = makeEquipmentManager([[makeEquipment("eq-1", "online")]]);
    const tracker = new EquipmentStatusTracker(manager, bus, testLogger);
    tracker.start();

    bus.emit({
      type: "device.data.updated",
      deviceId: "d-1",
      deviceName: "d",
      dataId: "dd-1",
      key: "k",
      value: 1,
      previous: 0,
      timestamp: new Date().toISOString(),
    });
    vi.advanceTimersByTime(250);

    expect(emitted).toHaveLength(0);
    tracker.destroy();
  });

  it("wallclock tick catches staleness transitions without any event", () => {
    const initial = [makeEquipment("eq-1", "online")];
    const next = [makeEquipment("eq-1", "degraded")];
    const { manager, advance } = makeEquipmentManager([initial, next]);
    const tracker = new EquipmentStatusTracker(manager, bus, testLogger);
    tracker.start();

    // Simulate time passing: the underlying lastUpdated would now be older
    // than the streaming timeout — getAllWithDetails returns the new snapshot.
    advance();
    vi.advanceTimersByTime(60_000);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ oldStatus: "online", newStatus: "degraded" });
    tracker.destroy();
  });

  it("forgets equipment state when equipment.removed fires", () => {
    const { manager } = makeEquipmentManager([[makeEquipment("eq-1", "online")]]);
    const tracker = new EquipmentStatusTracker(manager, bus, testLogger);
    tracker.start();

    bus.emit({
      type: "equipment.removed",
      equipmentId: "eq-1",
      equipmentName: "Eq",
      zoneId: "z",
    });

    // Once forgotten, if the same id reappears, the next observation is fresh
    // (seeded silently) and does NOT emit a transition.
    vi.advanceTimersByTime(60_000);
    expect(emitted).toHaveLength(0);
    tracker.destroy();
  });
});
