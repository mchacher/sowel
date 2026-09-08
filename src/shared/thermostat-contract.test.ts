import { describe, it, expect } from "vitest";
import {
  THERMOSTAT_CORE_DATA_ALIASES,
  THERMOSTAT_CORE_ORDER_ALIASES,
  THERMOSTAT_STATE_ALIAS,
  isThermostatCoreAlias,
  isThermostatDevice,
  splitThermostatExtras,
} from "./thermostat-contract";
import { computeBindingCandidates } from "./binding-candidates";
import type { CandidateData, CandidateOrder } from "./binding-candidates";

// Spec 177 — the thermostat core is declared once; identity and the extras
// split derive from it. The shapes below mirror what the two plugins Sowel
// has met publish today, and one vendor it never has.

const panasonicData: CandidateData[] = [
  { key: "power", category: "power" },
  { key: "operationMode", category: "generic" },
  { key: "targetTemperature", category: "setpoint" },
  { key: "insideTemperature", category: "temperature" },
  { key: "nanoe", category: "generic" },
];
const panasonicOrders: CandidateOrder[] = [
  { key: "power", category: "toggle_power", type: "boolean" },
  { key: "targetTemperature", category: "set_setpoint", type: "number" },
  { key: "nanoe", type: "enum", enumValues: ["on", "off"] },
];

const mczData: CandidateData[] = [
  { key: "power", category: "power" },
  { key: "stoveState", category: "generic" },
  { key: "targetTemperature", category: "setpoint" },
  { key: "profile", category: "generic" },
];

describe("thermostat contract — core", () => {
  it("declares the core aliases and nothing vendor-shaped", () => {
    expect([...THERMOSTAT_CORE_DATA_ALIASES].sort()).toEqual(
      ["operationMode", "outsideTemperature", "power", "setpoint", "state", "temperature"].sort(),
    );
    expect([...THERMOSTAT_CORE_ORDER_ALIASES].sort()).toEqual(
      ["operationMode", "power", "setpoint"].sort(),
    );
    expect(THERMOSTAT_STATE_ALIAS).toBe("state");
  });

  it("knows a core alias by side", () => {
    expect(isThermostatCoreAlias("data", "temperature")).toBe(true);
    expect(isThermostatCoreAlias("order", "temperature")).toBe(false);
    expect(isThermostatCoreAlias("data", "state")).toBe(true);
    expect(isThermostatCoreAlias("order", "state")).toBe(false);
    expect(isThermostatCoreAlias("order", "power")).toBe(true);
    expect(isThermostatCoreAlias("order", "nanoe")).toBe(false);
    expect(isThermostatCoreAlias("data", "resetAlarm")).toBe(false);
  });
});

describe("thermostat contract — identity", () => {
  it("accepts a Panasonic-shaped and an MCZ-shaped device through their categories", () => {
    expect(isThermostatDevice(panasonicData, panasonicOrders)).toBe(true);
    expect(isThermostatDevice(mczData, [])).toBe(true);
  });

  it("accepts a device that only exposes the set_setpoint order (first poll pending)", () => {
    expect(isThermostatDevice([], [{ category: "set_setpoint" }])).toBe(true);
  });

  it("accepts an unknown vendor as long as it publishes the setpoint category", () => {
    expect(isThermostatDevice([{ category: "setpoint" }], [])).toBe(true);
  });

  it("refuses a sensor and a clamp: a temperature is not a thermostat", () => {
    expect(isThermostatDevice([{ category: "temperature" }, { category: "humidity" }], [])).toBe(
      false,
    );
    expect(isThermostatDevice([{ category: "power" }], [])).toBe(false);
  });

  it("never keys on the raw targetTemperature key", () => {
    // Same key the Panasonic uses, no setpoint category: not a thermostat.
    expect(isThermostatDevice([{ category: "generic" }], [])).toBe(false);
  });
});

describe("thermostat contract — extras", () => {
  it("splits the full MCZ surface into core and extras, sorted by alias", () => {
    const data = [
      { alias: "state" },
      { alias: "temperature" },
      { alias: "setpoint" },
      { alias: "stoveState" },
      { alias: "profile" },
      { alias: "ecoMode" },
      { alias: "pelletSensor" },
      { alias: "ignitionCount" },
      { alias: "sparkPlug" },
    ];
    const orders = [
      { alias: "power" },
      { alias: "setpoint" },
      { alias: "resetAlarm" },
      { alias: "profile" },
      { alias: "ecoMode" },
    ];
    const { extraData, extraOrders } = splitThermostatExtras(data, orders);
    expect(extraData.map((b) => b.alias)).toEqual([
      "ecoMode",
      "ignitionCount",
      "pelletSensor",
      "profile",
      "sparkPlug",
      "stoveState",
    ]);
    expect(extraOrders.map((b) => b.alias)).toEqual(["ecoMode", "profile", "resetAlarm"]);
  });

  it("keeps the submetered wattage and the run state in the core", () => {
    const { extraData } = splitThermostatExtras(
      [{ alias: "power" }, { alias: "state" }, { alias: "outsideTemperature" }],
      [],
    );
    expect(extraData).toEqual([]);
  });

  it("treats a legacy state ORDER as an extra: the core order for on/off is power", () => {
    const { extraOrders } = splitThermostatExtras([], [{ alias: "state" }, { alias: "power" }]);
    expect(extraOrders.map((b) => b.alias)).toEqual(["state"]);
  });

  it("does not mutate its inputs", () => {
    const data = [{ alias: "zeta" }, { alias: "alpha" }];
    splitThermostatExtras(data, []);
    expect(data.map((b) => b.alias)).toEqual(["zeta", "alpha"]);
  });
});

describe("binding candidates — thermostat follows the contract identity", () => {
  it("offers one candidate grouping everything on a setpoint-carrying device", () => {
    const candidates = computeBindingCandidates("thermostat", panasonicData, panasonicOrders);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dataKeys).toEqual(panasonicData.map((d) => d.key));
    expect(candidates[0].orderKeys).toEqual(panasonicOrders.map((o) => o.key));
  });

  it("offers nothing on a device without a setpoint", () => {
    expect(
      computeBindingCandidates("thermostat", [{ key: "temperature", category: "temperature" }], []),
    ).toEqual([]);
  });

  it("leaves the heater candidate as it was", () => {
    expect(
      computeBindingCandidates(
        "heater",
        [{ key: "state", category: "light_state" }],
        [{ key: "state", category: "light_toggle", type: "boolean" }],
      ),
    ).toHaveLength(1);
  });
});
