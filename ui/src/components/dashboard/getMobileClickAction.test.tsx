import { describe, it, expect, vi } from "vitest";
import "../../test-utils";
import i18n from "../../i18n";
import { getMobileClickAction } from "./mobile-click-action";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";

// Spec 149 — for migrated types the mobile direct-tap toggle is derived from
// the presentation descriptor (same source as the desktop button), so the
// alias/value semantics cannot drift between the two surfaces anymore.

const t = i18n.t.bind(i18n);

function makeSwitch(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return {
    id: "sw-1",
    name: "Plug",
    zoneId: "z-1",
    type: "switch",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [
      {
        id: "db-1",
        equipmentId: "sw-1",
        deviceDataId: "dd-1",
        alias: "state",
        deviceId: "dev-1",
        deviceName: "Plug",
        key: "state",
        type: "boolean",
        category: "light_state",
        value: false,
        lastUpdated: "2026-01-01T00:00:00Z",
        lastChanged: "2026-01-01T00:00:00Z",
        stale: false,
      },
    ] as EquipmentWithDetails["dataBindings"],
    orderBindings: [
      {
        id: "ob-1",
        equipmentId: "sw-1",
        deviceOrderId: "do-1",
        alias: "state",
        deviceId: "dev-1",
        deviceName: "Plug",
        key: "state",
        type: "enum",
        enumValues: ["ON", "OFF"],
      },
    ] as EquipmentWithDetails["orderBindings"],
    ...over,
  } as EquipmentWithDetails;
}

const widget: DashboardWidget = {
  id: "w-1",
  type: "equipment",
  equipmentId: "sw-1",
  displayOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("getMobileClickAction", () => {
  it("fires the descriptor toggle for an OFF switch (sends ON)", () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const action = getMobileClickAction(widget, makeSwitch(), t, onExecuteOrder);
    expect(action).toBeTypeOf("function");
    action!();
    expect(onExecuteOrder).toHaveBeenCalledWith("sw-1", "state", "ON");
  });

  it("sends OFF when the switch is ON", () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const eq = makeSwitch();
    eq.dataBindings[0].value = true;
    getMobileClickAction(widget, eq, t, onExecuteOrder)!();
    expect(onExecuteOrder).toHaveBeenCalledWith("sw-1", "state", "OFF");
  });

  it("returns no action for a migrated type without a toggle", () => {
    const eq = makeSwitch({ orderBindings: [] });
    expect(getMobileClickAction(widget, eq, t, vi.fn())).toBeUndefined();
  });

  it("returns no action when the equipment is disabled", () => {
    const eq = makeSwitch({ enabled: false });
    expect(getMobileClickAction(widget, eq, t, vi.fn())).toBeUndefined();
  });

  it("still opens the detail sheet for complex (unmigrated) types", () => {
    const onOpenDetail = vi.fn();
    const eq = makeSwitch({ type: "thermostat" });
    const action = getMobileClickAction(widget, eq, t, vi.fn(), onOpenDetail);
    expect(action).toBe(onOpenDetail);
  });

  // Spec 152 — a water heater on permanent mains carries only the solar channel;
  // the single mobile tap must toggle it, and when a main on/off also exists the
  // tap targets main (solar is managed from the detail sheet).
  describe("solar channel (spec 152)", () => {
    function makeWaterHeater(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
      return {
        ...makeSwitch(),
        id: "wh-1",
        type: "water_heater",
        dataBindings: [] as EquipmentWithDetails["dataBindings"],
        orderBindings: [] as EquipmentWithDetails["orderBindings"],
        ...over,
      } as EquipmentWithDetails;
    }
    const solarOrder = {
      id: "ob-solar",
      equipmentId: "wh-1",
      deviceOrderId: "do-solar",
      alias: "solar",
      deviceId: "dev-solar",
      deviceName: "SolarRelay",
      key: "state",
      type: "boolean",
      category: "solar_toggle",
    } as EquipmentWithDetails["orderBindings"][number];
    const solarState = {
      id: "db-solar",
      equipmentId: "wh-1",
      deviceDataId: "dd-solar",
      alias: "solar_state",
      deviceId: "dev-solar",
      deviceName: "SolarRelay",
      key: "state",
      type: "boolean",
      category: "solar_state",
      value: false,
      lastUpdated: "2026-01-01T00:00:00Z",
      lastChanged: "2026-01-01T00:00:00Z",
      stale: false,
    } as EquipmentWithDetails["dataBindings"][number];

    it("toggles the solar channel when only a solar binding exists (no main)", () => {
      const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
      const eq = makeWaterHeater({
        orderBindings: [solarOrder] as EquipmentWithDetails["orderBindings"],
        dataBindings: [solarState] as EquipmentWithDetails["dataBindings"],
      });
      const action = getMobileClickAction(widget, eq, t, onExecuteOrder);
      expect(action).toBeTypeOf("function");
      action!();
      expect(onExecuteOrder).toHaveBeenCalledWith("wh-1", "solar", "ON");
    });

    it("targets the main on/off (not solar) when both channels are bound", () => {
      const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
      const mainOrder = {
        id: "ob-main",
        equipmentId: "wh-1",
        deviceOrderId: "do-main",
        alias: "state",
        deviceId: "dev-main",
        deviceName: "MainRelay",
        key: "state",
        type: "enum",
        enumValues: ["ON", "OFF"],
        category: "light_toggle",
      } as EquipmentWithDetails["orderBindings"][number];
      const mainState = {
        ...solarState,
        id: "db-main",
        alias: "state",
        category: "light_state",
      } as EquipmentWithDetails["dataBindings"][number];
      const eq = makeWaterHeater({
        orderBindings: [mainOrder, solarOrder] as EquipmentWithDetails["orderBindings"],
        dataBindings: [mainState, solarState] as EquipmentWithDetails["dataBindings"],
      });
      getMobileClickAction(widget, eq, t, onExecuteOrder)!();
      expect(onExecuteOrder).toHaveBeenCalledWith("wh-1", "state", "ON");
    });
  });
});
