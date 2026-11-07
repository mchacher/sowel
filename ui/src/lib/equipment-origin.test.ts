import { describe, it, expect } from "vitest";
import {
  equipmentIdFromPath,
  equipmentLinkState,
  isAdminOrigin,
  isUsageEquipmentPage,
  readEquipmentOrigin,
} from "./equipment-origin";

// Spec 196, slice 9 — where the equipment page was opened from.

describe("equipment origin", () => {
  it("reads back the origin a link sets, and nothing from a malformed state", () => {
    expect(readEquipmentOrigin(equipmentLinkState("Salon", "/home/z1"))).toEqual({
      label: "Salon",
      to: "/home/z1",
    });
    expect(readEquipmentOrigin(null)).toBeNull();
    expect(readEquipmentOrigin({ fromZone: "Salon" })).toBeNull();
    expect(readEquipmentOrigin({ from: { label: "", to: "/home" } })).toBeNull();
    expect(readEquipmentOrigin({ from: { label: "Salon" } })).toBeNull();
  });

  it("treats the equipment and device lists as Administration, another equipment page as usage", () => {
    expect(isAdminOrigin({ label: "Équipements", to: "/equipments" })).toBe(true);
    expect(isAdminOrigin({ label: "Appareils", to: "/devices" })).toBe(true);
    expect(isAdminOrigin({ label: "Prise", to: "/devices/d1" })).toBe(true);
    expect(isAdminOrigin({ label: "Zoé", to: "/equipments/ev-1" })).toBe(false);
    expect(isAdminOrigin({ label: "Salon", to: "/home/z1" })).toBe(false);
    expect(isAdminOrigin({ label: "Accueil", to: "/dashboard" })).toBe(false);
    expect(isAdminOrigin(null)).toBe(false);
  });

  it("places an equipment page under Maison unless it came from Administration", () => {
    expect(equipmentIdFromPath("/equipments/eq-1")).toBe("eq-1");
    expect(equipmentIdFromPath("/equipments")).toBeNull();
    expect(isUsageEquipmentPage("/equipments/eq-1", null)).toBe(true);
    expect(isUsageEquipmentPage("/equipments/eq-1", equipmentLinkState("Salon", "/home/z1"))).toBe(
      true,
    );
    expect(
      isUsageEquipmentPage("/equipments/eq-1", equipmentLinkState("Équipements", "/equipments")),
    ).toBe(false);
    expect(isUsageEquipmentPage("/equipments", null)).toBe(false);
  });
});
