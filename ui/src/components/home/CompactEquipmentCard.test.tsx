import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "../../test-utils";
import { CompactEquipmentCard } from "./CompactEquipmentCard";
import type { ComputedDataEntry, EquipmentType, EquipmentWithDetails } from "../../types";

// Issue #605 — the compact card must drop the "aujourd'hui" suffix from every
// submetered day-energy value (energy meters + submetered water heater) while
// keeping the kWh/Wh unit. These regression tests fail before the suffix removal.

function makeEquipment(
  type: EquipmentType,
  computedData: ComputedDataEntry[],
  over: Partial<EquipmentWithDetails> = {},
): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Meter",
    zoneId: "z-1",
    type,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [] as EquipmentWithDetails["dataBindings"],
    orderBindings: [] as EquipmentWithDetails["orderBindings"],
    computedData,
    ...over,
  };
}

function dayEnergy(value: number): ComputedDataEntry {
  return { alias: "energy_day", value, lastUpdated: "2026-01-01T00:00:00Z" };
}

function renderCard(equipment: EquipmentWithDetails) {
  return render(
    <MemoryRouter>
      <CompactEquipmentCard equipment={equipment} onExecuteOrder={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("CompactEquipmentCard — submetered day energy (#605)", () => {
  it("shows an energy meter's day value with its unit and no 'aujourd'hui' suffix", () => {
    renderCard(makeEquipment("energy_meter", [dayEnergy(1230)]));

    expect(screen.getByText("kWh")).toBeTruthy();
    expect(screen.getByText("1.23")).toBeTruthy();
    expect(screen.queryByText(/aujourd'hui/i)).toBeNull();
  });

  it("shows a submetered water heater's day value with its unit and no 'aujourd'hui' suffix", () => {
    renderCard(makeEquipment("water_heater", [dayEnergy(850)]));

    expect(screen.getByText("Wh")).toBeTruthy();
    expect(screen.getByText("850")).toBeTruthy();
    expect(screen.queryByText(/aujourd'hui/i)).toBeNull();
  });
});
