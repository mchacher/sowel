import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import { MappingSourceFields } from "./MappingSourceFields";
import type { EquipmentWithDetails } from "../../types";

// The shared publisher mapping-source selector (issue #457). These pin the
// universal behaviour both the MQTT and notification pages now rely on: the key
// options follow the selected source, and switching source type resets the
// downstream selections.

function equipmentWithKeys(id: string, aliases: string[]): EquipmentWithDetails {
  return {
    id,
    name: id,
    zoneId: "z-1",
    type: "sensor",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: aliases.map((alias) => ({ alias })) as EquipmentWithDetails["dataBindings"],
    orderBindings: [],
  };
}

function renderFields(over: Partial<Parameters<typeof MappingSourceFields>[0]> = {}) {
  const props = {
    keyPrefix: "mqttPublishers",
    sourceType: "equipment" as const,
    setSourceType: vi.fn(),
    sourceId: "eq-1",
    setSourceId: vi.fn(),
    sourceKey: "",
    setSourceKey: vi.fn(),
    filterZoneId: "",
    setFilterZoneId: vi.fn(),
    equipments: [equipmentWithKeys("eq-1", ["temperature", "humidity"])],
    zones: [{ id: "z-1", label: "Salon" }] as Parameters<typeof MappingSourceFields>[0]["zones"],
    recipeInstances: [],
    recipes: [],
    ...over,
  };
  render(<MappingSourceFields {...props} />);
  return props;
}

describe("MappingSourceFields", () => {
  it("lists the selected equipment's binding aliases as key options", () => {
    renderFields();
    expect(screen.getByRole("option", { name: "temperature" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "humidity" })).toBeTruthy();
  });

  it("lists the zone aggregate keys when the source is a zone", () => {
    renderFields({ sourceType: "zone", sourceId: "z-1" });
    // motion is a zone-aggregate key, never an equipment binding alias here.
    expect(screen.getByRole("option", { name: "motion" })).toBeTruthy();
  });

  it("uses recipeOptionLabel for recipe options when provided (notif page)", () => {
    const inst = { id: "ri-1", recipeId: "r-1", params: {}, state: {} } as Parameters<
      typeof MappingSourceFields
    >[0]["recipeInstances"][number];
    renderFields({
      sourceType: "recipe",
      sourceId: "",
      recipeInstances: [inst],
      recipes: [{ id: "r-1", name: "State Watch" } as never],
      recipeOptionLabel: (i) => `${i.recipeId} (Washer)`,
    });
    expect(screen.getByRole("option", { name: "r-1 (Washer)" })).toBeTruthy();
  });

  it("resets the downstream selections when the source type changes", () => {
    const props = renderFields();
    const sourceTypeSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(sourceTypeSelect, { target: { value: "zone" } });
    expect(props.setSourceType).toHaveBeenCalledWith("zone");
    expect(props.setFilterZoneId).toHaveBeenCalledWith("");
    expect(props.setSourceId).toHaveBeenCalledWith("");
    expect(props.setSourceKey).toHaveBeenCalledWith("");
  });
});
