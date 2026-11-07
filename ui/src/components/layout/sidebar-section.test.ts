import { describe, it, expect } from "vitest";
import { getSectionForPath } from "./sidebar-section";
import { equipmentLinkState } from "../../lib/equipment-origin";

// Spec 196, slice 9 (pr9-retour) — the sidebar used to open Administration on
// every equipment page, whatever the user came from.

describe("sidebar section", () => {
  it("opens Maison on an equipment page reached from a room, the dashboard or a direct link", () => {
    expect(getSectionForPath("/equipments/eq-1", equipmentLinkState("Salon", "/home/z1"))).toBe("maison");
    expect(getSectionForPath("/equipments/eq-1", equipmentLinkState("Accueil", "/dashboard"))).toBe("maison");
    expect(getSectionForPath("/equipments/eq-1", null)).toBe("maison");
  });

  it("keeps Administration on an equipment page reached from the equipment or device list", () => {
    expect(getSectionForPath("/equipments/eq-1", equipmentLinkState("Équipements", "/equipments"))).toBe("admin");
    expect(getSectionForPath("/equipments/eq-1", equipmentLinkState("Appareils", "/devices"))).toBe("admin");
  });

  it("leaves the other routes where they were", () => {
    expect(getSectionForPath("/equipments", null)).toBe("admin");
    expect(getSectionForPath("/home/z1")).toBe("maison");
    expect(getSectionForPath("/energy/live")).toBe("energy");
    expect(getSectionForPath("/dashboard")).toBeNull();
  });
});
