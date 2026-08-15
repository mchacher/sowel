import { describe, it, expect } from "vitest";
import i18n from "../../../i18n";
import { resolveWidgetPresentation } from "./resolveWidgetPresentation";
import { formatRuntime } from "./resolve-helpers";
import { CUSTOM_ICON_REGISTRY } from "../widget-icons";
import type {
  DashboardWidget,
  DataBindingWithValue,
  EquipmentWithDetails,
  OrderBindingWithDetails,
} from "../../../types";

// Spec 149 (issue #325) — the resolver is the single source of truth for a
// migrated type's icon/state/controls. These tests pin the descriptor
// contract every surface (desktop, mobile card, mobile tap) renders from.

const t = i18n.t.bind(i18n);

function dataBinding(over: Partial<DataBindingWithValue>): DataBindingWithValue {
  return {
    id: "db-1",
    equipmentId: "eq-1",
    deviceDataId: "dd-1",
    alias: "state",
    deviceId: "dev-1",
    deviceName: "Device",
    key: "state",
    type: "boolean",
    category: "light_state",
    value: false,
    lastUpdated: "2026-01-01T00:00:00Z",
    lastChanged: "2026-01-01T00:00:00Z",
    stale: false,
    ...over,
  } as DataBindingWithValue;
}

function orderBinding(over: Partial<OrderBindingWithDetails>): OrderBindingWithDetails {
  return {
    id: "ob-1",
    equipmentId: "eq-1",
    deviceOrderId: "do-1",
    alias: "state",
    deviceId: "dev-1",
    deviceName: "Device",
    key: "state",
    type: "enum",
    enumValues: ["ON", "OFF"],
    ...over,
  } as OrderBindingWithDetails;
}

function makeEquipment(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Plug",
    zoneId: "z-1",
    type: "switch",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [dataBinding({})],
    orderBindings: [orderBinding({})],
    ...over,
  } as EquipmentWithDetails;
}

function makeWidget(over: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id: "w-1",
    type: "equipment",
    equipmentId: "eq-1",
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function toggleOf(p: ReturnType<typeof resolveWidgetPresentation>) {
  const control = p?.controls.find((c) => c.kind === "toggle");
  if (!control || control.kind !== "toggle") throw new Error("no toggle control");
  return control;
}

describe("resolveWidgetPresentation", () => {
  it("returns null for a type that has not been migrated", () => {
    const eq = makeEquipment({ type: "light_onoff" });
    expect(resolveWidgetPresentation(makeWidget(), eq, t)).toBeNull();
  });

  describe("switch", () => {
    it("resolves OFF state and an ON/OFF enum toggle", () => {
      const p = resolveWidgetPresentation(makeWidget(), makeEquipment(), t);
      expect(p).not.toBeNull();
      expect(p!.isActive).toBe(false);
      expect(p!.state.primary).toBe("OFF");
      expect(toggleOf(p)).toMatchObject({
        alias: "state",
        on: false,
        onValue: "ON",
        offValue: "OFF",
      });
    });

    it("resolves ON state (string 'ON' value) and preserves lowercase enum values", () => {
      const eq = makeEquipment({
        dataBindings: [dataBinding({ value: "ON", type: "enum" })],
        orderBindings: [orderBinding({ enumValues: ["on", "off"] })],
      });
      const p = resolveWidgetPresentation(makeWidget(), eq, t);
      expect(p!.isActive).toBe(true);
      expect(p!.state.primary).toBe("ON");
      expect(toggleOf(p)).toMatchObject({ on: true, onValue: "on", offValue: "off" });
    });

    it("keeps the ON/OFF string contract for a boolean order aliased 'state' (legacy relay)", () => {
      const eq = makeEquipment({
        orderBindings: [orderBinding({ type: "boolean", enumValues: undefined })],
      });
      expect(toggleOf(resolveWidgetPresentation(makeWidget(), eq, t))).toMatchObject({
        alias: "state",
        onValue: "ON",
        offValue: "OFF",
      });
    });

    it("maps a boolean order binding (non-state alias) to true/false values", () => {
      const eq = makeEquipment({
        orderBindings: [
          orderBinding({ alias: "power_switch", key: "power_switch", type: "boolean", enumValues: undefined }),
        ],
      });
      expect(toggleOf(resolveWidgetPresentation(makeWidget(), eq, t))).toMatchObject({
        alias: "power_switch",
        onValue: true,
        offValue: false,
      });
    });

    it("has no control when the equipment exposes no togglable order", () => {
      const eq = makeEquipment({ orderBindings: [] });
      expect(resolveWidgetPresentation(makeWidget(), eq, t)!.controls).toEqual([]);
    });

    it("prefers the category-bound toggle (light_toggle) over an earlier generic boolean order", () => {
      const eq = makeEquipment({
        orderBindings: [
          orderBinding({ id: "ob-x", alias: "child_lock", key: "child_lock", type: "boolean", enumValues: undefined }),
          orderBinding({ id: "ob-y", alias: "relay", key: "relay", category: "light_toggle" }),
        ],
      });
      expect(toggleOf(resolveWidgetPresentation(makeWidget(), eq, t)).alias).toBe("relay");
    });
  });

  describe("media_player", () => {
    function makeTv(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
      return makeEquipment({
        type: "media_player",
        dataBindings: [
          dataBinding({ id: "db-p", alias: "power", key: "power", value: true }),
          dataBinding({
            id: "db-s",
            alias: "input_source",
            key: "input_source",
            type: "enum",
            category: "generic",
            value: "HDMI 1",
          }),
        ],
        orderBindings: [
          orderBinding({ alias: "power", key: "power", type: "boolean", enumValues: undefined }),
        ],
        ...over,
      });
    }

    it("shows the input source when ON and toggles power with booleans", () => {
      const p = resolveWidgetPresentation(makeWidget(), makeTv(), t);
      expect(p!.isActive).toBe(true);
      expect(p!.state.primary).toBe("HDMI 1");
      expect(toggleOf(p)).toMatchObject({ alias: "power", on: true, onValue: true, offValue: false });
    });

    it("falls back to ON when powered without a source, OFF otherwise", () => {
      const noSource = makeTv();
      noSource.dataBindings = noSource.dataBindings.filter((b) => b.alias !== "input_source");
      expect(resolveWidgetPresentation(makeWidget(), noSource, t)!.state.primary).toBe("ON");

      const off = makeTv();
      off.dataBindings[0].value = false;
      expect(resolveWidgetPresentation(makeWidget(), off, t)!.state.primary).toBe("OFF");
    });
  });

  describe("pool_pump", () => {
    it("adds the daily runtime as a secondary state line", () => {
      const eq = makeEquipment({
        type: "pool_pump",
        computedData: [{ alias: "runtime_daily", value: 5400, lastUpdated: "2026-01-01T00:00:00Z" }],
      });
      const p = resolveWidgetPresentation(makeWidget(), eq, t);
      expect(p!.state.secondary).toEqual(["1h 30m"]);
    });

    it("omits the runtime line when runtime_daily is absent", () => {
      const eq = makeEquipment({ type: "pool_pump" });
      expect(resolveWidgetPresentation(makeWidget(), eq, t)!.state.secondary).toBeUndefined();
    });

    it("prefers the pool_pump_toggle category over an unrelated boolean order (auto_mode)", () => {
      const eq = makeEquipment({
        type: "pool_pump",
        orderBindings: [
          orderBinding({ id: "ob-a", alias: "auto_mode", key: "auto_mode", type: "boolean", enumValues: undefined }),
          orderBinding({ id: "ob-t", alias: "relay", key: "relay", category: "pool_pump_toggle" }),
        ],
      });
      expect(toggleOf(resolveWidgetPresentation(makeWidget(), eq, t)).alias).toBe("relay");
    });
  });

  it("renders the custom widget icon override instead of the type default (#318)", () => {
    const p = resolveWidgetPresentation(makeWidget({ icon: "light_bulb" }), makeEquipment(), t);
    const node = p!.icon({ surface: "desktop" }) as { type: unknown };
    expect(node.type).toBe(CUSTOM_ICON_REGISTRY.light_bulb.component);
  });
});

describe("formatRuntime", () => {
  it("formats seconds, minutes and hours compactly", () => {
    expect(formatRuntime(45)).toBe("45s");
    expect(formatRuntime(720)).toBe("12m");
    expect(formatRuntime(5400)).toBe("1h 30m");
  });
});
