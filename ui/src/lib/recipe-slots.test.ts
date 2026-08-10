import { describe, it, expect } from "vitest";
import { isSlotHidden, matchesEquipmentType, equipmentCandidates } from "./recipe-slots";
import type { RecipeSlotDef } from "../types";

const kind: RecipeSlotDef = {
  id: "k",
  name: "Kind",
  description: "",
  type: "select",
  required: true,
  defaultValue: "time",
  options: [
    { value: "time", label: "Fixed time" },
    { value: "sunset", label: "Sunset" },
  ],
};
const timeSlot: RecipeSlotDef = {
  id: "t",
  name: "Time",
  description: "",
  type: "time",
  required: false,
  hiddenWhen: { slot: "k", equals: ["sunrise", "sunset"] },
};
const offsetSlot: RecipeSlotDef = {
  id: "o",
  name: "Offset",
  description: "",
  type: "number",
  required: false,
  hiddenWhen: { slot: "k", equals: "time" },
};
const all = [kind, timeSlot, offsetSlot];

describe("isSlotHidden", () => {
  it("returns false for a slot without hiddenWhen", () => {
    expect(isSlotHidden(kind, { k: "sunset" }, all)).toBe(false);
  });

  it("hides the time field when kind is sunset", () => {
    expect(isSlotHidden(timeSlot, { k: "sunset" }, all)).toBe(true);
  });

  it("shows the time field when kind is a fixed time", () => {
    expect(isSlotHidden(timeSlot, { k: "time" }, all)).toBe(false);
  });

  it("uses the referenced slot's defaultValue when its param is untouched", () => {
    // kind defaults to "time" -> offset (hidden when kind==time) is hidden,
    // and the time field is shown.
    expect(isSlotHidden(offsetSlot, {}, all)).toBe(true);
    expect(isSlotHidden(timeSlot, {}, all)).toBe(false);
  });

  it("hides the offset field only for fixed time", () => {
    expect(isSlotHidden(offsetSlot, { k: "sunset" }, all)).toBe(false);
    expect(isSlotHidden(offsetSlot, { k: "time" }, all)).toBe(true);
  });
});

describe("matchesEquipmentType", () => {
  it("accepts a single-type constraint", () => {
    expect(matchesEquipmentType("temperature", "temperature")).toBe(true);
    expect(matchesEquipmentType("humidity", "temperature")).toBe(false);
  });

  it("accepts any type of a list constraint", () => {
    expect(matchesEquipmentType("humidity", ["temperature", "humidity"])).toBe(true);
    expect(matchesEquipmentType("light", ["temperature", "humidity"])).toBe(false);
  });
});

describe("equipmentCandidates", () => {
  const equipments = [
    { id: "t-bath", type: "temperature", zoneId: "bath" },
    { id: "h-bath", type: "humidity", zoneId: "bath" },
    { id: "h-laundry", type: "humidity", zoneId: "laundry" },
    { id: "l-laundry", type: "light", zoneId: "laundry" },
  ];

  it("keeps only the equipments of the picked zone", () => {
    expect(equipmentCandidates(equipments, "laundry").map((e) => e.id)).toEqual([
      "h-laundry",
      "l-laundry",
    ]);
  });

  it("returns nothing when no zone is picked", () => {
    expect(equipmentCandidates(equipments, "")).toEqual([]);
  });

  it("returns nothing for a zone holding no equipment", () => {
    expect(equipmentCandidates(equipments, "attic")).toEqual([]);
  });

  it("applies the slot's type constraint", () => {
    expect(
      equipmentCandidates(equipments, "bath", { constraint: "humidity" }).map((e) => e.id),
    ).toEqual(["h-bath"]);
    expect(
      equipmentCandidates(equipments, "laundry", { constraint: ["humidity", "light"] }).map(
        (e) => e.id,
      ),
    ).toEqual(["h-laundry", "l-laundry"]);
  });

  it("drops the equipments already selected", () => {
    expect(
      equipmentCandidates(equipments, "bath", { excludeIds: ["t-bath"] }).map((e) => e.id),
    ).toEqual(["h-bath"]);
    expect(equipmentCandidates(equipments, "bath", { excludeIds: ["t-bath", "h-bath"] })).toEqual(
      [],
    );
  });

  it("combines constraint and exclusion — the single-candidate case", () => {
    const left = equipmentCandidates(equipments, "laundry", {
      constraint: ["humidity", "light"],
      excludeIds: ["l-laundry"],
    });
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe("h-laundry");
  });

  it("leaves the input array untouched", () => {
    const before = [...equipments];
    equipmentCandidates(equipments, "bath", { excludeIds: ["t-bath"] });
    expect(equipments).toEqual(before);
  });
});
