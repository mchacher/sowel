import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen } from "../../test-utils";
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
    renderCard(makeEquipment("switch", [], { dataBindings: [powerBinding()] }));

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

    expect(screen.queryByText(/1[.,]2\s?kW/)).toBeNull();
    expect(screen.getByText("\u2014")).toBeTruthy();
  });

  it("withholds an aged meter reading while keeping the day total", () => {
    // The cumulative figure is a different binding with its own life: it must
    // survive the instantaneous power being withheld.
    renderCard(
      makeEquipment("energy_meter", [dayEnergy(1230)], {
        dataBindings: [powerBinding({ alias: "power", value: 1240, lastUpdated: agoIso(3600) })],
      }),
    );

    expect(screen.queryByText("1.2")).toBeNull();
    expect(screen.getByText("1.23")).toBeTruthy();
    expect(screen.getByText("kWh")).toBeTruthy();
    expect(screen.getByText(/1 h/)).toBeTruthy();
  });

  it("keeps a reading its source's cadence still vouches for", () => {
    // 290 s is past the old two-minute meter window. The budget comes from the
    // source now (spec 175), and this one has none resolved, so it answers to
    // the learning window and the figure stays on screen.
    renderCard(
      makeEquipment("energy_meter", [dayEnergy(1230)], {
        dataBindings: [powerBinding({ alias: "power", value: 1240, lastUpdated: agoIso(290) })],
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

    expect(screen.getByText("1.2 kW")).toBeTruthy();
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
    // A second right-hand child used to wrap onto a line of its own beside a
    // gate's own control. The row is one flex line now (#1163), and the timed
    // button sits in a control group next to the gate's.
    const { container } = renderCard(timedGate());
    const row = container.firstElementChild!;
    expect(row.className).toContain("flex");
    expect(row.className).not.toContain("flex-wrap");
    expect(row.querySelectorAll('[data-row-part="controls"]').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTitle(/Lancer|Run for/i).closest('[data-row-part="controls"]')).toBeTruthy();
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
          stepIndex: 0,
          nextDurationMs: null,
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

// ============================================================
// Issue #1163 — the name gives way to readings, never to controls, and the
// whole row opens the equipment
// ============================================================

function dataBinding(alias: string, value: unknown, over: Record<string, unknown> = {}) {
  return {
    id: `db-${alias}`,
    equipmentId: "eq-1",
    deviceDataId: `dd-${alias}`,
    alias,
    deviceId: "dev-1",
    deviceName: "Device",
    key: alias,
    type: typeof value === "number" ? "number" : "enum",
    category: "generic",
    value,
    lastUpdated: agoIso(5),
    lastChanged: agoIso(5),
    stale: false,
    ...over,
  } as EquipmentWithDetails["dataBindings"][number];
}

function orderBinding(alias: string, over: Record<string, unknown> = {}) {
  return {
    id: `ob-${alias}`,
    equipmentId: "eq-1",
    deviceOrderId: `do-${alias}`,
    alias,
    deviceId: "dev-1",
    deviceName: "Device",
    key: alias,
    type: "enum",
    ...over,
  } as EquipmentWithDetails["orderBindings"][number];
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

/** The card inside a router that shows where a tap took us. */
function renderRouted(equipment: EquipmentWithDetails, onExecuteOrder = vi.fn()) {
  const utils = render(
    <MemoryRouter initialEntries={["/home/z-1"]}>
      <Routes>
        <Route
          path="/home/:zoneId"
          element={
            <>
              <CompactEquipmentCard equipment={equipment} onExecuteOrder={onExecuteOrder} />
              <Where />
            </>
          }
        />
        <Route path="/equipments/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...utils, onExecuteOrder };
}

const where = () => screen.getByTestId("where").textContent;

const light = (over: Partial<EquipmentWithDetails> = {}) =>
  makeEquipment("light_onoff", [], {
    name: "Circulation - Escalier Piscine",
    dataBindings: [dataBinding("state", "OFF", { category: "light_state" })],
    orderBindings: [orderBinding("state", { category: "light_toggle", enumValues: ["ON", "OFF"] })],
    ...over,
  });

const thermostat = () =>
  makeEquipment("thermostat", [], {
    name: "PAC",
    dataBindings: [dataBinding("temperature", 21, { category: "temperature" })],
    orderBindings: [orderBinding("power", { type: "boolean" })],
  });

function forecast(days: number) {
  const bindings = [];
  for (let d = 1; d <= days; d++) {
    bindings.push(dataBinding(`j${d}_condition`, "sunny"));
    bindings.push(dataBinding(`j${d}_temp_max`, 10 + d));
  }
  return makeEquipment("weather_forecast", [], {
    name: "Prévisions Météo",
    dataBindings: bindings,
  });
}

describe("CompactEquipmentCard — the row is one link (#1163)", () => {
  it("gives the keyboard one link per row, the name, stretched over the row", () => {
    const { container } = renderCard(light());
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("Circulation - Escalier Piscine");
    expect(links[0].getAttribute("href")).toBe("/equipments/eq-1");
    // The stretched-link pattern: the link's ::after covers the positioned row.
    expect(container.firstElementChild!.className).toContain("relative");
    expect(links[0].className).toContain("after:absolute");
    expect(links[0].className).toContain("after:inset-0");
  });

  it("keeps one link on an offline row too", () => {
    const { container } = renderCard(light({ status: "offline" }));
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.firstElementChild!.className).toContain("relative");
  });

  it("opens the equipment page from the row", () => {
    renderRouted(light());
    expect(where()).toBe("/home/z-1");
    fireEvent.click(screen.getByRole("link", { name: "Circulation - Escalier Piscine" }));
    expect(where()).toBe("/equipments/eq-1");
  });

  it("acts on a control without leaving the page", () => {
    const { onExecuteOrder } = renderRouted(light());
    const toggle = screen.getByTitle(/Allumer|Turn on/i);
    // Above the stretched link, and not inside it.
    expect(toggle.closest('[data-row-part="controls"]')!.className).toContain("relative");
    expect(toggle.closest("a")).toBeNull();
    fireEvent.click(toggle);
    expect(onExecuteOrder).toHaveBeenCalledWith("eq-1", "state", "ON");
    expect(where()).toBe("/home/z-1");
  });

  it("lets taps on readings through to the link", () => {
    const { container } = renderCard(forecast(3));
    for (const group of container.querySelectorAll('[data-row-part="readings"]')) {
      expect(group.className).toContain("pointer-events-none");
    }
  });
});

describe("CompactEquipmentCard — readings give way, controls never (#1163)", () => {
  it("wraps the name onto two lines instead of cutting it", () => {
    renderCard(light());
    const name = screen.getByRole("link");
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).not.toContain("truncate");
  });

  it("puts a control's own reading where it can give way, the control where it cannot", () => {
    const { container } = renderCard(thermostat());
    const temp = screen.getByText(/21[.,]0/);
    expect(temp.closest('[data-row-part="readings"]')).toBeTruthy();
    expect(temp.closest('[data-row-part="controls"]')).toBeNull();
    const power = screen.getByTitle(/Allumer|Turn on/i);
    expect(power.closest('[data-row-part="controls"]')).toBeTruthy();
    // A row with controls keeps none of its readings: they may all go.
    expect(container.querySelector('[data-row-readings="keepFirst"]')).toBeNull();
    expect(container.querySelector('[data-row-readings="fill"]')).toBeTruthy();
  });

  it("never puts a control in a group that gives way", () => {
    const { container } = renderCard(light());
    for (const group of container.querySelectorAll('[data-row-part="readings"]')) {
      expect(group.querySelector("button, input")).toBeNull();
    }
  });

  it("shows five forecast days at most, the first one kept", () => {
    const { container } = renderCard(forecast(7));
    const days = container.querySelectorAll("[data-forecast-day]");
    expect([...days].map((d) => d.getAttribute("data-forecast-day"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    // One group for all of them, which drops days from the last and never the
    // first: no empty opener ahead of day one.
    const group = days[0].closest('[data-row-part="readings"]')!;
    expect(group.getAttribute("data-row-readings")).toBe("keepFirst");
    expect(group.querySelectorAll("[data-forecast-day]")).toHaveLength(5);
    expect(group.firstElementChild!.querySelector("[data-forecast-day]")).toBeTruthy();
  });

  it("keeps a weather station's temperature first, the other readings after it", () => {
    const station = makeEquipment("weather", [], {
      name: "Station Météo",
      dataBindings: [
        dataBinding("humidity", 70, { key: "humidity", category: "humidity", unit: "%" }),
        dataBinding("temperature", 11.5, {
          key: "temperature",
          category: "temperature",
          unit: "°C",
        }),
      ],
    });
    const { container } = renderCard(station);
    const group = container.querySelector('[data-row-readings="keepFirst"]')!;
    const items = [...group.children].map((c) => c.textContent);
    expect(items[0]).toMatch(/11[.,]5/);
    expect(items[1]).toMatch(/70/);
  });

  it("lets a timed countdown give way without opening a gap between controls", () => {
    renderCard(
      makeEquipment("gate", [], {
        name: "Portail",
        timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
        timedAction: {
          alias: "command",
          value: null,
          revertValue: null,
          armedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          stepIndex: 0,
          nextDurationMs: null,
        },
      }),
    );
    const countdown = screen.getByText("10:00");
    expect(countdown.closest('[data-row-part="readings"]')!.getAttribute("data-row-readings")).toBe(
      "trailing",
    );
    expect(screen.getByTitle(/Arrêter|End it/i).closest('[data-row-part="controls"]')).toBeTruthy();
  });
});
