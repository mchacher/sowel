import { describe, it, expect, vi } from "vitest";
import "../../test-utils";
import i18n from "../../i18n";
import { getMobileClickAction, tapGlyphOf } from "./mobile-click-action";
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
    expect(action?.kind).toBe("toggle");
    action!.run();
    expect(onExecuteOrder).toHaveBeenCalledWith("sw-1", "state", "ON");
  });

  it("sends OFF when the switch is ON", () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const eq = makeSwitch();
    eq.dataBindings[0].value = true;
    getMobileClickAction(widget, eq, t, onExecuteOrder)!.run();
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

  // Spec 196 — a disabled gate no longer actuates on a tap, like a disabled light.
  it("returns no action for a disabled single-action gate", () => {
    const gate = makeSwitch({
      type: "gate",
      enabled: false,
      dataBindings: [] as EquipmentWithDetails["dataBindings"],
      orderBindings: [
        { id: "ob-g", alias: "trigger", category: "gate_trigger" },
      ] as EquipmentWithDetails["orderBindings"],
    });
    const onExecuteOrder = vi.fn();
    expect(getMobileClickAction(widget, gate, t, onExecuteOrder)).toBeUndefined();
    const enabled = { ...gate, enabled: true };
    getMobileClickAction(widget, enabled, t, onExecuteOrder)!.run();
    expect(onExecuteOrder).toHaveBeenCalledWith("sw-1", "trigger", null);
  });

  it("still opens the detail sheet for complex (unmigrated) types", () => {
    const onOpenDetail = vi.fn();
    const eq = makeSwitch({ type: "thermostat" });
    const action = getMobileClickAction(widget, eq, t, vi.fn(), onOpenDetail);
    expect(action).toEqual({ kind: "sheet", run: onOpenDetail });
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
      expect(action?.kind).toBe("toggle");
      action!.run();
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
      getMobileClickAction(widget, eq, t, onExecuteOrder)!.run();
      expect(onExecuteOrder).toHaveBeenCalledWith("wh-1", "state", "ON");
    });
  });

  // Spec 168 — the forecast tile now has somewhere to go: the tile qualifies
  // tomorrow, the sheet shows the five days with their confidence.
  describe("weather forecast (spec 168)", () => {
    const forecast = () =>
      makeSwitch({
        id: "wf-1",
        type: "weather_forecast",
        orderBindings: [] as EquipmentWithDetails["orderBindings"],
      });

    it("opens the detail sheet", () => {
      const onOpenDetail = vi.fn();
      const action = getMobileClickAction(widget, forecast(), t, vi.fn(), onOpenDetail);
      expect(action?.run).toBe(onOpenDetail);
    });

    it("stays inert when no sheet handler is wired", () => {
      // The tile must not advertise a tap that leads nowhere.
      expect(getMobileClickAction(widget, forecast(), t, vi.fn())).toBeUndefined();
    });

    it("leaves sensor and weather on the same path", () => {
      const onOpenDetail = vi.fn();
      for (const type of ["sensor", "weather"] as const) {
        const eq = makeSwitch({ type, orderBindings: [] as EquipmentWithDetails["orderBindings"] });
        expect(getMobileClickAction(widget, eq, t, vi.fn(), onOpenDetail)?.run).toBe(onOpenDetail);
      }
    });
  });
});

// Spec 182 — starting a charge is never a single tap: the charger tile opens
// its sheet, and nothing is sent.
describe("ev_charger mobile tap", () => {
  it("opens the detail sheet and sends no order", () => {
    const widget = { id: "w-ev", type: "equipment", equipmentId: "sw-1" } as DashboardWidget;
    const onExecuteOrder = vi.fn();
    const onOpenDetail = vi.fn();
    const action = getMobileClickAction(
      widget,
      makeSwitch({ type: "ev_charger" }),
      t,
      onExecuteOrder,
      onOpenDetail,
    );
    expect(action?.kind).toBe("sheet");
    action?.run();
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onExecuteOrder).not.toHaveBeenCalled();
  });
});

// Spec 196 (pr8-geste) — one row per line of the "what a tap does" table: the
// gesture the mobile tile performs and the corner glyph that announces it.
describe("mobile tap table (spec 196)", () => {
  const lightOrder = {
    id: "ob-l",
    alias: "state",
    type: "enum",
    enumValues: ["ON", "OFF"],
    category: "light_toggle",
  } as EquipmentWithDetails["orderBindings"][number];
  const gateOrder = (enumValues?: string[]) =>
    ({
      id: "ob-g",
      alias: "command",
      type: "enum",
      category: "gate_trigger",
      enumValues,
    }) as EquipmentWithDetails["orderBindings"][number];
  const eq = (over: Partial<EquipmentWithDetails>) =>
    makeSwitch({ dataBindings: [] as EquipmentWithDetails["dataBindings"], ...over });

  const cases: Array<{
    name: string;
    equipment: EquipmentWithDetails;
    kind: "toggle" | "now" | "sheet" | "confirm" | undefined;
    glyph?: "power" | "chevron" | "shield";
  }> = [
    { name: "switch", equipment: makeSwitch(), kind: "toggle", glyph: "power" },
    { name: "pool_pump", equipment: makeSwitch({ type: "pool_pump" }), kind: "toggle", glyph: "power" },
    ...(["light_onoff", "water_heater", "water_valve"] as const).map((type) => ({
      name: type,
      equipment: eq({ type, orderBindings: [lightOrder] }),
      kind: "toggle" as const,
      glyph: "power" as const,
    })),
    {
      name: "light_onoff disabled",
      equipment: eq({ type: "light_onoff", enabled: false, orderBindings: [lightOrder] }),
      kind: undefined,
    },
    {
      name: "light_onoff without an order",
      equipment: eq({ type: "light_onoff", orderBindings: [] }),
      kind: undefined,
    },
    ...(
      [
        "light_dimmable",
        "light_color",
        "shutter",
        "awning",
        "door",
        "pool_cover",
        "thermostat",
        "pool_heat_pump",
        "heater",
        "vmc",
        "ev_charger",
        "electric_vehicle",
        "sensor",
        "weather",
        "weather_forecast",
      ] as const
    ).map((type) => ({
      name: type,
      equipment: eq({ type, orderBindings: [] }),
      kind: "sheet" as const,
      glyph: "chevron" as const,
    })),
    {
      name: "gate, single action, unguarded",
      equipment: eq({ type: "gate", orderBindings: [gateOrder()] }),
      kind: "now",
      glyph: "power",
    },
    {
      name: "gate, single action, guarded",
      equipment: eq({ type: "gate", requireConfirmation: true, orderBindings: [gateOrder()] }),
      kind: "confirm",
      glyph: "shield",
    },
    {
      name: "gate, single action, disabled",
      equipment: eq({ type: "gate", enabled: false, orderBindings: [gateOrder()] }),
      kind: undefined,
    },
    {
      name: "gate, several actions",
      equipment: eq({
        type: "gate",
        requireConfirmation: true,
        orderBindings: [gateOrder(["open", "close", "stop"])],
      }),
      kind: "sheet",
      glyph: "chevron",
    },
    {
      name: "gate without a command",
      equipment: eq({ type: "gate", orderBindings: [] }),
      kind: "sheet",
      glyph: "chevron",
    },
    ...(
      [
        "energy_meter",
        "main_energy_meter",
        "energy_production_meter",
        "solar_panel",
        "appliance",
        "display",
        "camera",
        "ups",
        "button",
      ] as const
    ).map((type) => ({
      name: type,
      equipment: eq({ type, orderBindings: [] }),
      kind: undefined,
    })),
  ];

  it.each(cases)("$name → $kind", ({ equipment, kind, glyph }) => {
    const action = getMobileClickAction(widget, equipment, t, vi.fn(), vi.fn(), vi.fn());
    expect(action?.kind).toBe(kind);
    if (action) expect(tapGlyphOf(action.kind)).toBe(glyph);
  });

  it("does not advertise a sheet when no sheet is wired", () => {
    expect(getMobileClickAction(widget, eq({ type: "shutter" }), t, vi.fn())).toBeUndefined();
  });

  it("a disabled light sends nothing", () => {
    const onExecuteOrder = vi.fn();
    const light = eq({ type: "light_onoff", enabled: false, orderBindings: [lightOrder] });
    expect(getMobileClickAction(widget, light, t, onExecuteOrder)).toBeUndefined();
    expect(onExecuteOrder).not.toHaveBeenCalled();
  });
});
