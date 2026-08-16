import { describe, it, expect } from "vitest";
import { hasMeteringBinding, isMeteringSwitch, isSubmeterEquipment } from "./metering.js";

const power = [{ alias: "power", category: "power", type: "number" }];
const energy = [{ alias: "energy", category: "energy", type: "number" }];
const state = [{ alias: "state", category: "light_state", type: "boolean" }];
const battery = [{ alias: "battery", category: "battery", type: "number" }];
// An on/off switch mis-categorised as `power` (Panasonic AC, media_player): a
// STATE, not a measurement. Must not count as a metering channel (#523).
const booleanPower = [{ alias: "power", category: "power", type: "boolean" }];

describe("metering helpers (spec 129 / #523)", () => {
  it("hasMeteringBinding detects NUMERIC power or energy channels", () => {
    expect(hasMeteringBinding(power)).toBe(true);
    expect(hasMeteringBinding(energy)).toBe(true);
    expect(hasMeteringBinding([...state, ...battery])).toBe(false);
    expect(hasMeteringBinding([])).toBe(false);
    // #523 numeric gate: a boolean on/off `power` is not a measurement.
    expect(hasMeteringBinding(booleanPower)).toBe(false);
    // Absent type stays lenient (bare callers/tests) — treated as numeric.
    expect(hasMeteringBinding([{ alias: "power", category: "power" }])).toBe(true);
  });

  it("isMeteringSwitch: switch/water_heater card concern is unchanged (spec 129)", () => {
    expect(isMeteringSwitch("switch", power)).toBe(true);
    expect(isMeteringSwitch("switch", energy)).toBe(true);
    expect(isMeteringSwitch("switch", state)).toBe(false); // bare relay
    expect(isMeteringSwitch("light_onoff", power)).toBe(false); // not a relay type
    expect(isMeteringSwitch("energy_meter", power)).toBe(false); // not a relay type
    expect(isMeteringSwitch("water_heater", power)).toBe(true); // #521
    expect(isMeteringSwitch("water_heater", state)).toBe(false);
  });

  it("isSubmeterEquipment: ANY numeric-metered load except house/production (#523)", () => {
    // The headline: a metering thermostat (the AC on its clamp) now enrols.
    expect(isSubmeterEquipment("thermostat", power)).toBe(true);
    // Numeric gate: the thermostat's own boolean on/off must NOT enrol it.
    expect(isSubmeterEquipment("thermostat", booleanPower)).toBe(false);

    // Other generic metered loads enrol without a per-type whitelist.
    expect(isSubmeterEquipment("appliance", power)).toBe(true);
    expect(isSubmeterEquipment("pool_pump", energy)).toBe(true);
    expect(isSubmeterEquipment("light_dimmable", power)).toBe(true);

    // Still-valid prior cases.
    expect(isSubmeterEquipment("energy_meter", power)).toBe(true);
    expect(isSubmeterEquipment("switch", power)).toBe(true);
    expect(isSubmeterEquipment("water_heater", power)).toBe(true); // #521
    // A declared energy_meter qualifies on type alone (card renders at 0, #527).
    expect(isSubmeterEquipment("energy_meter", [])).toBe(true);

    // A non-meter load with no numeric channel does not enrol.
    expect(isSubmeterEquipment("thermostat", [])).toBe(false);
    expect(isSubmeterEquipment("switch", state)).toBe(false);
    expect(isSubmeterEquipment("media_player", booleanPower)).toBe(false);
    // The real old-vs-new regression guard: under the OLD code a metering
    // `switch` with a boolean `power` was a submeter (no numeric gate); the
    // #523 numeric gate now excludes it.
    expect(isSubmeterEquipment("switch", booleanPower)).toBe(false);

    // The three exclusions: house total + production must never be submeters.
    expect(isSubmeterEquipment("main_energy_meter", power)).toBe(false);
    expect(isSubmeterEquipment("energy_production_meter", power)).toBe(false);
    expect(isSubmeterEquipment("solar_panel", power)).toBe(false);
  });
});
