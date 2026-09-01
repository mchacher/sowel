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


// ============================================================
// Issue #839 — the home row must not print an aged wattage either.
// ============================================================

function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function powerBinding(over: Record<string, unknown> = {}) {
  return {
    id: "db-p",
    equipmentId: "eq-1",
    deviceDataId: "dd-p",
    alias: "power",
    deviceId: "dev-1",
    deviceName: "Clamp",
    key: "power",
    type: "number",
    category: "power",
    value: 560,
    unit: "W",
    lastUpdated: agoIso(5),
    lastChanged: agoIso(5),
    stale: false,
    ...over,
  } as EquipmentWithDetails["dataBindings"][number];
}

describe("CompactEquipmentCard — stale power readings (#839)", () => {
  it("prints a fresh metering plug draw", () => {
    renderCard(
      makeEquipment("switch", [], { dataBindings: [powerBinding()] }),
    );

    expect(screen.getByText("560 W")).toBeTruthy();
  });

  it("withholds an aged plug draw and shows its age instead", () => {
    renderCard(
      makeEquipment("switch", [], {
        dataBindings: [powerBinding({ value: 0, lastUpdated: agoIso(944) })],
      }),
    );

    expect(screen.queryByText("0 W")).toBeNull();
    expect(screen.getByText("\u2014")).toBeTruthy();
    expect(screen.getByText(/15 min/)).toBeTruthy();
  });

  it("withholds an aged solar headline rather than reading it as zero", () => {
    renderCard(
      makeEquipment("solar_panel", [], {
        dataBindings: [powerBinding({ value: 1240, lastUpdated: agoIso(1800) })],
      }),
    );

    expect(screen.queryByText(/1.24 kW/)).toBeNull();
    expect(screen.getByText("\u2014")).toBeTruthy();
  });

  it("withholds an aged meter reading while keeping the day total", () => {
    // The cumulative figure is a different binding with its own life: it must
    // survive the instantaneous power being withheld.
    renderCard(
      makeEquipment("energy_meter", [dayEnergy(1230)], {
        dataBindings: [
          powerBinding({ alias: "demand_5min", value: 1240, lastUpdated: agoIso(3600) }),
        ],
      }),
    );

    expect(screen.queryByText("1.2")).toBeNull();
    expect(screen.getByText("1.23")).toBeTruthy();
    expect(screen.getByText("kWh")).toBeTruthy();
    expect(screen.getByText(/1 h/)).toBeTruthy();
  });

  it("keeps a demand_5min reading inside its own five-minute nature", () => {
    renderCard(
      makeEquipment("energy_meter", [dayEnergy(1230)], {
        dataBindings: [
          powerBinding({ alias: "demand_5min", value: 1240, lastUpdated: agoIso(290) }),
        ],
      }),
    );

    expect(screen.getByText("1.2")).toBeTruthy();
  });

  it("keeps a solar reading inside the inverter's own reporting cadence", () => {
    // apsystems arrives on a Tasmota SENSOR topic whose default TelePeriod is
    // 300 s. Under a declared meter's two-minute window a panel in full sun
    // would blank for three minutes out of every five.
    renderCard(
      makeEquipment("solar_panel", [], {
        dataBindings: [powerBinding({ value: 1240, lastUpdated: agoIso(290) })],
      }),
    );

    expect(screen.getByText("1.24 kW")).toBeTruthy();
  });
});

// ============================================================
// Spec 174 phase 2 — the timed control on the row
// ============================================================

describe("CompactEquipmentCard — timed command (spec 174)", () => {
  const timedGate = (over: Partial<EquipmentWithDetails> = {}) =>
    makeEquipment("gate", [], {
      name: "Portail",
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
      ...over,
    });

  it("adds nothing to a row whose equipment has no timed command", () => {
    renderCard(makeEquipment("gate", [], { name: "Portail" }));
    expect(screen.queryByTitle(/Lancer|Run for/i)).toBeNull();
  });

  it("offers the command when one is configured", () => {
    renderCard(timedGate());
    expect(screen.getByTitle(/Lancer|Run for/i)).toBeTruthy();
  });

  it("keeps the row on one line, controls and all", () => {
    // The row is a three-column grid: a second right-hand child wrapped onto a
    // line of its own, which is what the timed control did beside a gate's own
    // control. Everything on the right shares one cell now.
    const { container } = renderCard(timedGate());
    const row = container.querySelector('[class*="grid-cols-[32px"]');
    expect(row).toBeTruthy();
    expect(row!.children).toHaveLength(3);
  });

  it("shows the countdown and offers to end it while a window is open", () => {
    renderCard(
      timedGate({
        timedAction: {
          alias: "command",
          value: null,
          revertValue: null,
          armedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      }),
    );

    expect(screen.getByText("10:00")).toBeTruthy();
    // Pressing again on a dense row means "close it", not "keep it open longer":
    // the extend gesture lives on the tile.
    expect(screen.getByTitle(/Arrêter|End it/i)).toBeTruthy();
    expect(screen.queryByTitle(/Lancer|Run for/i)).toBeNull();
  });
});
