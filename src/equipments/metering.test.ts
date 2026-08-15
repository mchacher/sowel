import { describe, it, expect } from "vitest";
import { hasMeteringBinding, isMeteringSwitch, isSubmeterEquipment } from "./metering.js";

const power = [{ alias: "power", category: "power" }];
const energy = [{ alias: "energy", category: "energy" }];
const state = [{ alias: "state", category: "light_state" }];
const battery = [{ alias: "battery", category: "battery" }];

describe("metering helpers (spec 129)", () => {
  it("hasMeteringBinding detects power or energy channels", () => {
    expect(hasMeteringBinding(power)).toBe(true);
    expect(hasMeteringBinding(energy)).toBe(true);
    expect(hasMeteringBinding([...state, ...battery])).toBe(false);
    expect(hasMeteringBinding([])).toBe(false);
  });

  it("isMeteringSwitch: switch with power/energy is a metering plug", () => {
    expect(isMeteringSwitch("switch", power)).toBe(true);
    expect(isMeteringSwitch("switch", energy)).toBe(true);
    expect(isMeteringSwitch("switch", state)).toBe(false); // bare relay
    expect(isMeteringSwitch("light_onoff", power)).toBe(false); // not a switch
    expect(isMeteringSwitch("energy_meter", power)).toBe(false); // not a switch
  });

  it("isMeteringSwitch: water_heater with power/energy is a metering relay (#521)", () => {
    expect(isMeteringSwitch("water_heater", power)).toBe(true);
    expect(isMeteringSwitch("water_heater", energy)).toBe(true);
    expect(isMeteringSwitch("water_heater", state)).toBe(false); // bare relay, no metering
  });

  it("isSubmeterEquipment: energy_meter OR metering relay", () => {
    expect(isSubmeterEquipment("energy_meter", [])).toBe(true);
    expect(isSubmeterEquipment("switch", power)).toBe(true);
    expect(isSubmeterEquipment("switch", state)).toBe(false); // bare relay
    expect(isSubmeterEquipment("water_heater", power)).toBe(true); // #521
    expect(isSubmeterEquipment("water_heater", state)).toBe(false); // no metering binding
    expect(isSubmeterEquipment("main_energy_meter", power)).toBe(false); // house total, not a submeter
    expect(isSubmeterEquipment("light_onoff", power)).toBe(false);
  });
});
