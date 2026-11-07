import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { MobileWidgetCard } from "./MobileWidgetCard";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";

// Issue #323 — an energy_meter used to render a blank mobile card (label only)
// because useMobileState had no isEnergyMeter branch. It now shows today's
// consumption and the current power.

function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

// The binding timestamp has to be a live one since #839: the card withholds a
// power reading past its freshness budget, and this fixture's original
// hard-coded "2026-01-01" would age out of any budget. The #323 assertion is
// unchanged — a meter renders its power on mobile — it just needs a reading
// the card has reason to believe.
function makeEnergyMeter(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return {
    id: "em-1",
    name: "Main meter",
    zoneId: "z-1",
    type: "energy_meter",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [
      {
        id: "db-d",
        equipmentId: "em-1",
        deviceDataId: "dd-d",
        alias: "power",
        deviceId: "dev-1",
        deviceName: "Meter",
        key: "power",
        type: "number",
        category: "power",
        value: 800,
        lastUpdated: agoIso(30),
        lastChanged: agoIso(30),
        stale: false,
      },
    ] as EquipmentWithDetails["dataBindings"],
    orderBindings: [],
    computedData: [{ alias: "energy_day", value: 1500, lastUpdated: "2026-01-01T00:00:00Z" }],
    ...over,
  };
}

const widget: DashboardWidget = {
  id: "w-1",
  type: "equipment",
  equipmentId: "em-1",
  displayOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("MobileWidgetCard", () => {
  it("renders an energy_meter's today value and current power (issue #323)", () => {
    render(<MobileWidgetCard widget={widget} equipment={makeEnergyMeter()} />);
    // energy_day 1500 Wh -> 1.5 kWh, power 800 -> 800 W, joined by " · ".
    expect(screen.getByText(/1\.5 kWh/)).toBeTruthy();
    expect(screen.getByText(/800 W/)).toBeTruthy();
  });

  it("still shows the equipment label", () => {
    render(<MobileWidgetCard widget={widget} equipment={makeEnergyMeter()} />);
    expect(screen.getByText("Main meter")).toBeTruthy();
  });

  // Spec 149 — switch/pool_pump/media_player state comes from the shared
  // presentation descriptor, the same source the desktop widget renders.
  it("renders a switch ON state from the presentation descriptor", () => {
    const plug = makeEquipment({
      id: "sw-1",
      name: "Plug",
      type: "switch",
      dataBindings: [
        stateDataBinding({ equipmentId: "sw-1", value: true }),
      ] as EquipmentWithDetails["dataBindings"],
    });
    render(<MobileWidgetCard widget={{ ...widget, equipmentId: "sw-1" }} equipment={plug} />);
    expect(screen.getByText("On")).toBeTruthy();
  });

  // Issue #325 divergence 1 — the daily runtime was desktop-only; the mobile
  // card now shows it as a secondary line.
  it("renders a pool_pump's runtime line next to its ON/OFF state", () => {
    const pump = makeEquipment({
      id: "pp-1",
      name: "Pool pump",
      type: "pool_pump",
      dataBindings: [
        stateDataBinding({ equipmentId: "pp-1", value: true }),
      ] as EquipmentWithDetails["dataBindings"],
      computedData: [{ alias: "runtime_daily", value: 5400, lastUpdated: "2026-01-01T00:00:00Z" }],
    });
    render(<MobileWidgetCard widget={{ ...widget, equipmentId: "pp-1" }} equipment={pump} />);
    expect(screen.getByText(/^On · /)).toBeTruthy();
    expect(screen.getByText(/1\sh\s30/)).toBeTruthy();
  });

  // Issue #325 divergence 3 — a boolean-category sensor emitting a string
  // ("OFF" contact) must render the same localized label as a real boolean,
  // not the raw string (same rule as the desktop SensorValues, #315).
  it("normalizes a string-valued contact sensor through the boolean formatter", () => {
    const door = makeEquipment({
      id: "se-1",
      name: "Door",
      type: "sensor",
      dataBindings: [
        {
          id: "db-c",
          equipmentId: "se-1",
          deviceDataId: "dd-c",
          alias: "contact",
          deviceId: "dev-c",
          deviceName: "Door sensor",
          key: "contact",
          type: "enum",
          category: "contact_door",
          value: "OFF",
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
    });
    render(<MobileWidgetCard widget={{ ...widget, equipmentId: "se-1" }} equipment={door} />);
    // "OFF" on a contact means open — the localized label, never the raw string.
    expect(screen.getByText(i18n.t("controls.opened") as string)).toBeTruthy();
    expect(screen.queryByText("OFF")).toBeNull();
  });

  it("understands an explicit OPEN string on a contact sensor", () => {
    const door = makeEquipment({
      id: "se-2",
      name: "Gate door",
      type: "sensor",
      dataBindings: [
        {
          id: "db-c2",
          equipmentId: "se-2",
          deviceDataId: "dd-c2",
          alias: "contact",
          deviceId: "dev-c2",
          deviceName: "Door sensor",
          key: "contact",
          type: "enum",
          category: "contact_door",
          value: "OPEN",
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
    });
    render(<MobileWidgetCard widget={{ ...widget, equipmentId: "se-2" }} equipment={door} />);
    expect(screen.getByText(i18n.t("controls.opened") as string)).toBeTruthy();
    expect(screen.queryByText("OPEN")).toBeNull();
  });
});

function makeEquipment(over: Partial<EquipmentWithDetails>): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Equipment",
    zoneId: "z-1",
    type: "switch",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [],
    orderBindings: [],
    ...over,
  } as EquipmentWithDetails;
}

function stateDataBinding(over: Record<string, unknown>) {
  return {
    id: "db-s",
    equipmentId: "eq-1",
    deviceDataId: "dd-s",
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
  };
}

describe("MobileWidgetCard — stale power readings (#839)", () => {
  it("withholds an aged meter power while keeping today's consumption", () => {
    const eq = makeEnergyMeter();
    eq.dataBindings[0].lastUpdated = agoIso(3600);

    render(<MobileWidgetCard widget={widget} equipment={eq} />);

    expect(screen.queryByText(/800 W/)).toBeNull();
    expect(screen.getByText(/1\.5 kWh/)).toBeTruthy();
    expect(screen.getByText(/1 h/)).toBeTruthy();
  });

  it("keeps a reading its source's cadence still vouches for", () => {
    // 290 s is past the old two-minute meter window. The budget comes from the
    // source now (spec 175); this fixture has none resolved, so it answers to
    // the learning window.
    const eq = makeEnergyMeter();
    eq.dataBindings[0].lastUpdated = agoIso(290);

    render(<MobileWidgetCard widget={widget} equipment={eq} />);

    expect(screen.getByText(/800 W/)).toBeTruthy();
  });

  // A joined single line cut the range and state off on a half-width card:
  // battery and "range · state" are now two separate lines.
  it("renders an electric_vehicle's battery and range/state on separate lines", () => {
    const car = makeEquipment({
      id: "ev-1",
      name: "Rafale",
      type: "electric_vehicle",
      dataBindings: [
        { alias: "battery_level", category: "ev_battery_level", value: 9, lastUpdated: agoIso(60) },
        { alias: "range", category: "ev_range", value: 1, lastUpdated: agoIso(60) },
        {
          alias: "charging_state",
          category: "ev_charging_state",
          value: "unplugged",
          lastUpdated: agoIso(60),
        },
      ] as unknown as EquipmentWithDetails["dataBindings"],
    });
    render(<MobileWidgetCard widget={{ ...widget, equipmentId: "ev-1" }} equipment={car} />);
    expect(screen.getByText(/^9\s?%$/)).toBeTruthy();
    expect(screen.getByText(/1 km/)).toBeTruthy();
    expect(screen.getByText(/Débranché|Unplugged/)).toBeTruthy();
  });
});

// Spec 196, slice 8a — the thermostat card shows its setpoint, not only the
// level of its thermometer.
describe("MobileWidgetCard — thermostat setpoint line", () => {
  const thermostat = (state: boolean | null) =>
    makeEquipment({
      id: "th-1",
      name: "PAC",
      type: "thermostat",
      dataBindings: [
        { alias: "temperature", value: 21, lastUpdated: agoIso(60) },
        { alias: "setpoint", value: 20, lastUpdated: agoIso(60) },
        ...(state === null
          ? []
          : [{ alias: "state", type: "boolean", value: state, lastUpdated: agoIso(60) }]),
      ] as unknown as EquipmentWithDetails["dataBindings"],
      orderBindings: [
        { alias: "setpoint", deviceId: "dev-1", min: 16, max: 30 },
      ] as unknown as EquipmentWithDetails["orderBindings"],
    });

  it("reads « temperature → setpoint » when running", () => {
    render(
      <MobileWidgetCard widget={{ ...widget, equipmentId: "th-1" }} equipment={thermostat(true)} />,
    );
    expect(screen.getByText("21.0° → 20.0°")).toBeTruthy();
  });

  it("says off instead of the setpoint when the thermostat is off", () => {
    render(
      <MobileWidgetCard
        widget={{ ...widget, equipmentId: "th-1" }}
        equipment={thermostat(false)}
      />,
    );
    expect(screen.getByText("21.0° · off")).toBeTruthy();
  });

  it("reads « — → setpoint » when the setpoint is known and the temperature not", () => {
    const noTemp = makeEquipment({
      id: "th-2",
      name: "PAC",
      type: "thermostat",
      dataBindings: [
        { alias: "setpoint", value: 20, lastUpdated: agoIso(60) },
      ] as unknown as EquipmentWithDetails["dataBindings"],
      orderBindings: [
        { alias: "setpoint", deviceId: "dev-1", min: 20, max: 20 },
      ] as unknown as EquipmentWithDetails["orderBindings"],
    });
    render(<MobileWidgetCard widget={{ ...widget, equipmentId: "th-2" }} equipment={noTemp} />);
    expect(screen.getByText("\u2014 → 20.0°")).toBeTruthy();
  });

  it("does not take a thermostat without a run state for off", () => {
    render(
      <MobileWidgetCard widget={{ ...widget, equipmentId: "th-1" }} equipment={thermostat(null)} />,
    );
    expect(screen.getByText("21.0° → 20.0°")).toBeTruthy();
  });
});

describe("MobileWidgetCard — tap gesture (spec 196)", () => {
  const meter = () => makeEnergyMeter();

  it("renders a plain block, no glyph, when a tap does nothing", () => {
    const { container } = render(<MobileWidgetCard widget={widget} equipment={meter()} />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".active\\:scale-\\[0\\.98\\]")).toBeNull();
    expect(container.querySelector("[data-tap-glyph]")).toBeNull();
  });

  it.each([
    ["toggle", "power", "toggle"],
    ["now", "power", "operate"],
    ["sheet", "chevron", "open details"],
    ["confirm", "shield", "operate with confirmation"],
  ] as const)(
    "%s → %s glyph, and a name that keeps the tile's text before the gesture",
    (kind, glyph, gesture) => {
      const { container } = render(
        <MobileWidgetCard widget={widget} equipment={meter()} onClick={() => {}} tapKind={kind} />,
      );
      expect(container.querySelector("[data-tap-glyph]")?.getAttribute("data-tap-glyph")).toBe(
        glyph,
      );
      expect(screen.getByRole("button").getAttribute("aria-label")).toBeNull();
      // Title, state line, then the gesture, in that order.
      expect(
        screen.getByRole("button", {
          name: new RegExp(`^Main meter.*1\\.5\\s?kWh.*800\\s?W, ${gesture}$`),
        }),
      ).toBeTruthy();
    },
  );

  it("shows no glyph in edit mode", () => {
    const { container } = render(
      <MobileWidgetCard widget={widget} equipment={meter()} tapKind="sheet" editMode />,
    );
    expect(container.querySelector("[data-tap-glyph]")).toBeNull();
  });
});

describe("MobileWidgetCard — vehicle report age (spec 196)", () => {
  it("puts a stale report's age on the state line, not in the corner", () => {
    const car = makeEquipment({
      id: "ev-2",
      name: "Megane",
      type: "electric_vehicle",
      dataBindings: [
        {
          alias: "battery_level",
          category: "ev_battery_level",
          value: 39,
          lastUpdated: agoIso(7200),
        },
        { alias: "range", category: "ev_range", value: 114, lastUpdated: agoIso(7200) },
        {
          alias: "charging_state",
          category: "ev_charging_state",
          value: "unplugged",
          lastUpdated: agoIso(7200),
        },
      ] as unknown as EquipmentWithDetails["dataBindings"],
    });
    const { container } = render(
      <MobileWidgetCard widget={{ ...widget, equipmentId: "ev-2" }} equipment={car} />,
    );
    expect(screen.getByText(/114 km · (Débranché|Unplugged) · 2 h/)).toBeTruthy();
    expect(container.querySelector(".absolute")).toBeNull();
  });
});
