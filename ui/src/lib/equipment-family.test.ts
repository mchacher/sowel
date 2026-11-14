import { describe, expect, it } from "vitest";
import type { EquipmentType } from "../types";
import { TYPE_ICONS } from "../components/equipments/equipment-type-meta";
import {
  FAMILY_CLASSES,
  NEUTRAL_TILE,
  SECTIONS,
  TYPE_SECTION,
  familyOf,
  sectionOf,
  tileClasses,
} from "./equipment-family";

// Spec 208, FR1 — the grouping rule, as the maintainer approved it.
const EXPECTED: Record<string, EquipmentType[]> = {
  lighting: ["light_onoff", "light_dimmable", "light_color"],
  openings: ["shutter", "awning", "door", "gate", "pool_cover"],
  climate: ["thermostat", "heater", "vmc"],
  water: ["water_valve", "pool_pump", "pool_heat_pump", "water_heater"],
  energy: [
    "main_energy_meter",
    "energy_meter",
    "energy_production_meter",
    "solar_panel",
    "ups",
    "ev_charger",
    "electric_vehicle",
  ],
  sensors: ["sensor", "weather", "weather_forecast", "camera"],
  media: ["media_player"],
  appliances: ["appliance"],
  plugs: ["switch"],
  controls: ["button"],
  displays: ["display"],
};

describe("equipment families (spec 208)", () => {
  it("puts every equipment type in exactly the section of the FR1 table", () => {
    // TYPE_ICONS is keyed by every EquipmentType: a new type without a section fails here.
    const allTypes = Object.keys(TYPE_ICONS) as EquipmentType[];
    const listed = Object.values(EXPECTED).flat();
    expect([...listed].sort()).toEqual([...allTypes].sort());
    for (const [section, types] of Object.entries(EXPECTED)) {
      for (const type of types) expect(TYPE_SECTION[type]).toBe(section);
    }
  });

  it("orders the sections: the six families, the neutral ones, then other", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      "lighting",
      "openings",
      "climate",
      "water",
      "energy",
      "sensors",
      "media",
      "appliances",
      "plugs",
      "controls",
      "displays",
      "other",
    ]);
    expect(SECTIONS.filter((s) => s.family !== null).map((s) => s.id)).toEqual(
      SECTIONS.slice(0, 6).map((s) => s.id),
    );
  });

  it("gives a family to the type of a family section, and none to a neutral one", () => {
    expect(familyOf({ type: "shutter" })).toBe("openings");
    expect(familyOf({ type: "pool_heat_pump" })).toBe("water");
    expect(familyOf({ type: "button" })).toBeNull();
    expect(familyOf({ type: "media_player" })).toBeNull();
  });

  it("moves a switch with a family into that family", () => {
    const plug = { type: "switch" as const, family: "climate" as const };
    expect(sectionOf(plug)).toBe("climate");
    expect(familyOf(plug)).toBe("climate");
  });

  it("keeps a switch without a family with the plugs", () => {
    expect(sectionOf({ type: "switch" })).toBe("plugs");
    expect(sectionOf({ type: "switch", family: null })).toBe("plugs");
    expect(familyOf({ type: "switch", family: null })).toBeNull();
  });

  it("ignores a family stored on another type", () => {
    expect(sectionOf({ type: "light_onoff", family: "climate" })).toBe("lighting");
    expect(sectionOf({ type: "button", family: "water" })).toBe("controls");
  });

  it("sends an unknown type to the trailing other section, without a colour", () => {
    const future = { type: "robot_mower" as EquipmentType };
    expect(sectionOf(future)).toBe("other");
    expect(familyOf(future)).toBeNull();
  });

  it("paints the pale at rest, the fill while running, and never a neutral tile", () => {
    expect(tileClasses("water", false)).toBe(FAMILY_CLASSES.water.tile);
    expect(tileClasses("water", true)).toBe(FAMILY_CLASSES.water.tileRunning);
    expect(tileClasses(null, true)).toBe(NEUTRAL_TILE);
    expect(tileClasses(null, false)).toBe(NEUTRAL_TILE);
  });
});
