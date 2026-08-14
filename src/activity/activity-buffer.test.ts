import { describe, it, expect, beforeEach, vi } from "vitest";
import { ActivityBuffer } from "./activity-buffer.js";
import type { ActivityStore } from "./activity-store.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { ActivityItem, Equipment } from "../shared/types.js";

const logger = createLogger("silent").logger;

function mkEquipment(id: string, name: string, zoneId: string | null): Equipment {
  return {
    id,
    name,
    type: "light_onoff",
    zoneId,
    enabled: true,
    icon: null,
    pinned: false,
    createdAt: new Date().toISOString(),
  };
}

function buildHarness() {
  const bus = new EventBus(logger);
  const equipments = new Map<string, Equipment>();
  const bindings = new Map<string, { alias: string; category: string }[]>();
  const instances = new Map<
    string,
    { recipeId: string; recipeName: string; zoneId: string | null }
  >();
  const descendants = new Map<string, string[]>();
  let isDaylight: boolean | null = false;

  const equipmentManager = {
    getById: (id: string) => equipments.get(id) ?? null,
    getDataBindingsWithValues: (id: string) => bindings.get(id) ?? [],
  } as unknown as Parameters<typeof ActivityBuffer.prototype.constructor>[1];

  const recipeManager = {
    getInstanceMeta: (id: string) => instances.get(id) ?? null,
  } as unknown as Parameters<typeof ActivityBuffer.prototype.constructor>[2];

  const zoneManager = {
    getDescendantIds: (zoneId: string) => [zoneId, ...(descendants.get(zoneId) ?? [])],
  } as unknown as Parameters<typeof ActivityBuffer.prototype.constructor>[3];

  const sunlightManager = {
    getSunlightData: () => ({ sunrise: null, sunset: null, isDaylight }),
  } as unknown as Parameters<typeof ActivityBuffer.prototype.constructor>[4];

  const buffer = new ActivityBuffer(
    bus,
    equipmentManager,
    recipeManager,
    zoneManager,
    sunlightManager,
    logger,
  );
  buffer.start();

  return {
    bus,
    buffer,
    addEquipment: (eq: Equipment) => equipments.set(eq.id, eq),
    setBindings: (eqId: string, bs: { alias: string; category: string }[]) =>
      bindings.set(eqId, bs),
    addInstance: (
      id: string,
      meta: { recipeId: string; recipeName: string; zoneId: string | null },
    ) => instances.set(id, meta),
    setDescendants: (zoneId: string, descIds: string[]) => descendants.set(zoneId, descIds),
    setIsDaylight: (v: boolean | null) => {
      isDaylight = v;
    },
  };
}

describe("ActivityBuffer", () => {
  let h: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    h = buildHarness();
  });

  describe("order events", () => {
    it("records equipment.order.executed with source preserved", () => {
      h.addEquipment(mkEquipment("eq-1", "Apliques", "zone-living"));
      h.bus.emit({
        type: "equipment.order.executed",
        equipmentId: "eq-1",
        orderAlias: "brightness",
        value: 0.04,
        source: { kind: "recipe", instanceId: "inst-x", recipeName: "Motion Light" },
      });
      const items = h.buffer.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].category).toBe("order");
      expect(items[0].zoneId).toBe("zone-living");
      expect(items[0].source).toEqual({
        kind: "recipe",
        instanceId: "inst-x",
        recipeName: "Motion Light",
      });
      expect(items[0].message.template).toBe("order.executed");
    });

    it("records equipment.order.executed without source (source undefined)", () => {
      h.addEquipment(mkEquipment("eq-1", "Light", "zone-living"));
      h.bus.emit({
        type: "equipment.order.executed",
        equipmentId: "eq-1",
        orderAlias: "state",
        value: "ON",
      });
      expect(h.buffer.getItems()).toHaveLength(1);
      expect(h.buffer.getItems()[0].source).toBeUndefined();
    });

    it("ignores order from unknown equipment (silently)", () => {
      h.bus.emit({
        type: "equipment.order.executed",
        equipmentId: "ghost",
        orderAlias: "state",
        value: "ON",
      });
      expect(h.buffer.getItems()).toHaveLength(0);
    });
  });

  describe("motion filter (by category, not alias)", () => {
    beforeEach(() => {
      h.addEquipment(mkEquipment("pir-1", "PIR_00", "zone-living"));
    });

    it("records motion rising edge when binding category is 'motion'", () => {
      h.setBindings("pir-1", [{ alias: "motion", category: "motion" }]);
      h.bus.emit({
        type: "equipment.data.changed",
        equipmentId: "pir-1",
        alias: "motion",
        value: true,
        previous: false,
      });
      expect(h.buffer.getItems()).toHaveLength(1);
      expect(h.buffer.getItems()[0].category).toBe("motion");
    });

    it("records motion even when alias is custom (e.g. 'presence')", () => {
      h.setBindings("pir-1", [{ alias: "presence", category: "motion" }]);
      h.bus.emit({
        type: "equipment.data.changed",
        equipmentId: "pir-1",
        alias: "presence",
        value: true,
        previous: false,
      });
      expect(h.buffer.getItems()).toHaveLength(1);
      expect(h.buffer.getItems()[0].category).toBe("motion");
    });

    it("accepts string rising values like 'ON', 'DETECTED', '1'", () => {
      h.setBindings("pir-1", [{ alias: "motion", category: "motion" }]);
      for (const v of ["ON", "detected", "1", "true"]) {
        h.buffer.clear();
        h.bus.emit({
          type: "equipment.data.changed",
          equipmentId: "pir-1",
          alias: "motion",
          value: v,
          previous: null,
        });
        expect(h.buffer.size()).toBe(1);
      }
    });

    it("ignores motion=false (falling edge)", () => {
      h.setBindings("pir-1", [{ alias: "motion", category: "motion" }]);
      h.bus.emit({
        type: "equipment.data.changed",
        equipmentId: "pir-1",
        alias: "motion",
        value: false,
        previous: true,
      });
      expect(h.buffer.getItems()).toHaveLength(0);
    });

    it("ignores changes whose binding category is not motion/water_leak/smoke", () => {
      h.setBindings("pir-1", [{ alias: "temperature", category: "temperature" }]);
      h.bus.emit({
        type: "equipment.data.changed",
        equipmentId: "pir-1",
        alias: "temperature",
        value: 21.5,
        previous: 21,
      });
      expect(h.buffer.getItems()).toHaveLength(0);
    });

    it("ignores when no binding matches the alias", () => {
      h.setBindings("pir-1", [{ alias: "other", category: "motion" }]);
      h.bus.emit({
        type: "equipment.data.changed",
        equipmentId: "pir-1",
        alias: "ghost",
        value: true,
        previous: false,
      });
      expect(h.buffer.getItems()).toHaveLength(0);
    });
  });

  describe("water_leak & smoke (alarm category)", () => {
    it("records water_leak rising edge as alarm", () => {
      h.addEquipment(mkEquipment("leak-1", "Détecteur Cuisine", "zone-kitchen"));
      h.setBindings("leak-1", [{ alias: "leak", category: "water_leak" }]);
      h.bus.emit({
        type: "equipment.data.changed",
        equipmentId: "leak-1",
        alias: "leak",
        value: true,
        previous: false,
      });
      const items = h.buffer.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].category).toBe("alarm");
      expect(items[0].zoneId).toBe("zone-kitchen");
      expect(items[0].message.template).toBe("alarm.raised");
    });

    it("records smoke rising edge as alarm", () => {
      h.addEquipment(mkEquipment("smoke-1", "Détecteur Salon", "zone-living"));
      h.setBindings("smoke-1", [{ alias: "smoke", category: "smoke" }]);
      h.bus.emit({
        type: "equipment.data.changed",
        equipmentId: "smoke-1",
        alias: "smoke",
        value: true,
        previous: false,
      });
      expect(h.buffer.getItems()[0].category).toBe("alarm");
    });

    it("ignores leak/smoke falling edge", () => {
      h.addEquipment(mkEquipment("leak-1", "L", "z"));
      h.setBindings("leak-1", [{ alias: "leak", category: "water_leak" }]);
      h.bus.emit({
        type: "equipment.data.changed",
        equipmentId: "leak-1",
        alias: "leak",
        value: false,
        previous: true,
      });
      expect(h.buffer.getItems()).toHaveLength(0);
    });
  });

  describe("recipe lifecycle", () => {
    it("records recipe.instance.started with zone resolved", () => {
      h.addInstance("inst-1", { recipeId: "r1", recipeName: "Motion Light", zoneId: "zone-A" });
      h.bus.emit({ type: "recipe.instance.started", instanceId: "inst-1", recipeId: "r1" });
      const items = h.buffer.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].category).toBe("recipe");
      expect(items[0].zoneId).toBe("zone-A");
      expect(items[0].message).toEqual({
        template: "recipe.started",
        params: { recipeName: "Motion Light" },
      });
    });

    it("records cross-zone recipe with zoneId=null", () => {
      h.addInstance("inst-x", { recipeId: "r1", recipeName: "Sunset Shutters", zoneId: null });
      h.bus.emit({ type: "recipe.instance.started", instanceId: "inst-x", recipeId: "r1" });
      expect(h.buffer.getItems()[0].zoneId).toBeNull();
    });

    it("records recipe.instance.error as alarm category", () => {
      h.addInstance("inst-1", { recipeId: "r1", recipeName: "X", zoneId: null });
      h.bus.emit({
        type: "recipe.instance.error",
        instanceId: "inst-1",
        recipeId: "r1",
        error: "boom",
      });
      expect(h.buffer.getItems()[0].category).toBe("alarm");
    });

    it("ignores recipe events for unknown instance", () => {
      h.bus.emit({ type: "recipe.instance.started", instanceId: "ghost", recipeId: "r" });
      expect(h.buffer.getItems()).toHaveLength(0);
    });
  });

  describe("mode events", () => {
    it("records mode.activated as global (zoneId=null)", () => {
      h.bus.emit({ type: "mode.activated", modeId: "m1", modeName: "Lumière soir" });
      const items = h.buffer.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].category).toBe("mode");
      expect(items[0].zoneId).toBeNull();
    });

    it("records mode.deactivated", () => {
      h.bus.emit({ type: "mode.deactivated", modeId: "m1", modeName: "Lumière soir" });
      expect(h.buffer.getItems()[0].message.template).toBe("mode.deactivated");
    });
  });

  describe("sunlight transitions", () => {
    it("records sunrise when isDaylight flips false→true", () => {
      h.setIsDaylight(true);
      h.bus.emit({ type: "sunlight.changed" });
      const items = h.buffer.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].message.template).toBe("sunlight.sunrise");
      expect(items[0].zoneId).toBeNull();
    });

    it("records sunset when isDaylight flips true→false", () => {
      h.setIsDaylight(true);
      h.bus.emit({ type: "sunlight.changed" });
      h.setIsDaylight(false);
      h.bus.emit({ type: "sunlight.changed" });
      const items = h.buffer.getItems();
      expect(items).toHaveLength(2);
      expect(items[0].message.template).toBe("sunlight.sunset");
    });

    it("ignores sunlight.changed when isDaylight unchanged", () => {
      h.setIsDaylight(false);
      h.bus.emit({ type: "sunlight.changed" });
      expect(h.buffer.getItems()).toHaveLength(0);
    });
  });

  describe("alarms", () => {
    it("records system.alarm.raised as global alarm", () => {
      h.bus.emit({
        type: "system.alarm.raised",
        alarmId: "a1",
        level: "error",
        source: "z2m",
        message: "broker disconnected",
      });
      expect(h.buffer.getItems()[0]).toMatchObject({
        category: "alarm",
        zoneId: null,
        message: { template: "alarm.raised" },
      });
    });
  });

  describe("filter by zone", () => {
    beforeEach(() => {
      h.addEquipment(mkEquipment("eq-a", "EqA", "zone-A"));
      h.addEquipment(mkEquipment("eq-b", "EqB", "zone-B"));
      h.setDescendants("zone-parent", ["zone-A"]);
      h.bus.emit({
        type: "equipment.order.executed",
        equipmentId: "eq-a",
        orderAlias: "state",
        value: "ON",
      });
      h.bus.emit({
        type: "equipment.order.executed",
        equipmentId: "eq-b",
        orderAlias: "state",
        value: "ON",
      });
      h.bus.emit({ type: "mode.activated", modeId: "m", modeName: "Day" }); // global
    });

    it("returns zone-A items + global when filtering by zone-A", () => {
      const items = h.buffer.getItems({ zoneId: "zone-A", includeDescendants: true });
      const zones = items.map((i) => i.zoneId);
      expect(zones).toContain("zone-A");
      expect(zones).toContain(null);
      expect(zones).not.toContain("zone-B");
    });

    it("includes descendants when filtering by parent", () => {
      const items = h.buffer.getItems({ zoneId: "zone-parent", includeDescendants: true });
      expect(items.some((i) => i.zoneId === "zone-A")).toBe(true);
    });

    it("excludes descendants when includeDescendants=false", () => {
      const items = h.buffer.getItems({ zoneId: "zone-parent", includeDescendants: false });
      expect(items.some((i) => i.zoneId === "zone-A")).toBe(false);
    });

    it("returns all items when zoneId is null", () => {
      const items = h.buffer.getItems({ zoneId: null });
      expect(items.length).toBe(3);
    });

    it("respects the limit", () => {
      const items = h.buffer.getItems({ zoneId: null, limit: 1 });
      expect(items.length).toBe(1);
    });
  });

  describe("system alarms (spec 143/#472)", () => {
    const isAlarm = (i: { message: { template: string } }) => i.message.template === "alarm.raised";

    it("scopes a zone-tagged alarm to that zone only, not every zone", () => {
      h.bus.emit({
        type: "system.alarm.raised",
        alarmId: "battery-low:dd-1",
        level: "warning",
        source: "Détecteur salon",
        message: "Low battery: 12% (Capteur porte)",
        zoneId: "zone-A",
      });

      expect(h.buffer.getItems({ zoneId: "zone-A" }).some(isAlarm)).toBe(true);
      expect(h.buffer.getItems({ zoneId: "zone-B" }).some(isAlarm)).toBe(false);
    });

    it("keeps an alarm with no zone global (shown in every zone)", () => {
      h.bus.emit({
        type: "system.alarm.raised",
        alarmId: "poll-fail:z2m",
        level: "error",
        source: "Zigbee2MQTT",
        message: "down",
      });

      expect(h.buffer.getItems({ zoneId: "zone-A" }).some(isAlarm)).toBe(true);
      expect(h.buffer.getItems({ zoneId: "zone-B" }).some(isAlarm)).toBe(true);
    });
  });

  describe("ring buffer cap and emit", () => {
    it("emits activity.added on the bus for every push", () => {
      const onActivity = vi.fn();
      h.bus.onType("activity.added", onActivity);
      h.bus.emit({ type: "mode.activated", modeId: "m1", modeName: "A" });
      h.bus.emit({ type: "mode.activated", modeId: "m2", modeName: "B" });
      expect(onActivity).toHaveBeenCalledTimes(2);
    });

    it("caps the buffer at 2000 items", () => {
      for (let i = 0; i < 2500; i++) {
        h.bus.emit({ type: "mode.activated", modeId: `m${i}`, modeName: `M${i}` });
      }
      expect(h.buffer.size()).toBe(2000);
    });
  });
});

// Spec 147 — persistence wiring (store injected).
describe("ActivityBuffer persistence", () => {
  function mkItem(id: string, timestamp: number): ActivityItem {
    return {
      id,
      timestamp,
      category: "mode",
      zoneId: null,
      message: { template: "mode.activated", params: { modeName: id } },
    };
  }

  function buildWithStore(store: Partial<ActivityStore>) {
    const bus = new EventBus(logger);
    const noop = {
      getById: () => null,
      getDataBindingsWithValues: () => [],
    } as unknown as Parameters<typeof ActivityBuffer.prototype.constructor>[1];
    const zoneManager = {
      getDescendantIds: (z: string) => [z],
    } as unknown as Parameters<typeof ActivityBuffer.prototype.constructor>[3];
    const sunlightManager = {
      getSunlightData: () => ({ sunrise: null, sunset: null, isDaylight: false }),
    } as unknown as Parameters<typeof ActivityBuffer.prototype.constructor>[4];
    const buffer = new ActivityBuffer(
      bus,
      noop,
      noop,
      zoneManager,
      sunlightManager,
      logger,
      store as ActivityStore,
    );
    return { bus, buffer };
  }

  it("seeds the ring from the store on start (newest-first, as returned)", () => {
    const seed = [mkItem("newer", 200), mkItem("older", 100)]; // store returns DESC
    const { buffer } = buildWithStore({ loadRecent: () => seed, insert: vi.fn() });
    buffer.start();
    expect(buffer.getItems({ limit: 10 }).map((i) => i.id)).toEqual(["newer", "older"]);
  });

  it("persists each pushed item to the store", () => {
    const insert = vi.fn();
    const { bus, buffer } = buildWithStore({ loadRecent: () => [], insert });
    buffer.start();
    bus.emit({ type: "mode.activated", modeId: "m1", modeName: "Night" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ category: "mode" });
  });
});
