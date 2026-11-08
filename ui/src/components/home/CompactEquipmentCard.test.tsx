import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen } from "../../test-utils";
import { CompactEquipmentCard } from "./CompactEquipmentCard";
import { GateControl } from "../equipments/GateControl";
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
    const link = screen.getByRole("link");
    const name = link.querySelector("[data-marquee]")!;
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).not.toContain("truncate");
    // Read once: the link's accessible name is the name, nothing doubled.
    expect(link.textContent).toBe("Circulation - Escalier Piscine");
  });

  it("puts a control's own reading where it can give way, the control where it cannot", () => {
    const { container } = renderCard(thermostat());
    const temp = screen.getByText(/21[.,]0/);
    expect(temp.closest('[data-row-part="readings"]')).toBeTruthy();
    expect(temp.closest('[data-row-part="controls"]')).toBeNull();
    const power = screen.getByTitle(/Allumer|Turn on/i);
    expect(power.closest('[data-row-part="controls"]')).toBeTruthy();
    // The row draws a button, which is what lets its readings all go: the CSS
    // keys the group's minimum width and its empty opener on that button.
    expect(container.querySelector('[data-row-part="controls"] button')).toBeTruthy();
    const group = container.querySelector('[data-row-readings="main"]')!;
    expect(group.className).toContain("group-has-[[data-row-part=controls]_button]/eqrow:min-w-0");
    expect(group.querySelector("[data-row-opener]")!.className).toContain(
      "group-has-[[data-row-part=controls]_button]/eqrow:block",
    );
  });

  it("keeps the first reading of a row whose control draws no button", () => {
    // A gate without a command, or any disabled equipment, has nothing to press:
    // its state pill must not give way to the name.
    const { container } = renderCard(makeEquipment("gate", [], { name: "Portail" }));
    expect(container.querySelector('[data-row-part="controls"] button')).toBeNull();
    const group = container.querySelector('[data-row-readings="main"]')!;
    expect(group.textContent).toMatch(/\S/);
    // Without the row variant the group keeps its widest item and the opener
    // stays hidden, so the first item cannot wrap away.
    expect(group.className).toContain("overflow-clip");
    expect(group.querySelector("[data-row-opener]")!.className).toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("leaves the equipment list's compact controls drawing their own readings", () => {
    render(
      <MemoryRouter>
        <GateControl equipment={makeEquipment("gate", [])} onExecuteOrder={vi.fn()} compact />
      </MemoryRouter>,
    );
    // The default `withReadings` keeps the state pill inside the control.
    expect(screen.getByText(/Inconnu|Unknown|Fermé|Closed|Ouvert|Open/i)).toBeTruthy();
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
    // One group for all of them, which drops days from the last; a forecast has
    // no control, so the opener stays hidden and day one is never dropped.
    const group = days[0].closest('[data-row-part="readings"]')!;
    expect(group.getAttribute("data-row-readings")).toBe("main");
    expect(group.querySelectorAll("[data-forecast-day]")).toHaveLength(5);
    expect(container.querySelector('[data-row-part="controls"]')).toBeNull();
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
    const group = container.querySelector('[data-row-readings="main"]')!;
    const items = [...group.children]
      .filter((c) => !c.hasAttribute("data-row-opener"))
      .map((c) => c.textContent);
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

// ============================================================
// Issue #1163 follow-up — the icon carries an open / closed state, so the pill
// can leave every phone row of the type alike
// ============================================================

describe("CompactEquipmentCard — state in the row icon (#1163)", () => {
  const shutter = (position: number, over: Partial<EquipmentWithDetails> = {}) =>
    makeEquipment("shutter", [], {
      name: "Volet Sud Ouest",
      dataBindings: [dataBinding("position", position, { category: "shutter_position" })],
      orderBindings: [
        orderBinding("state", { category: "shutter_move", enumValues: ["OPEN", "STOP", "CLOSE"] }),
      ],
      ...over,
    });
  const gate = (state: "open" | "closed" | null) =>
    makeEquipment("gate", [], {
      name: "Porte Garage",
      dataBindings: state ? [dataBinding("state", state, { category: "gate_state" })] : [],
      orderBindings: [orderBinding("command", { category: "gate_trigger" })],
    });

  /** Slats drawn by the shutter icon: one per closed quarter. */
  const visibleSlats = (icon: Element) =>
    [...icon.querySelectorAll("line")].filter((l) => (l as SVGElement).style.opacity === "1")
      .length;

  it("draws a shutter's position in its icon, with the state in words", () => {
    renderCard(shutter(40));
    const icon = screen.getByRole("img", { name: /40/ });
    expect(icon.getAttribute("aria-label")).toMatch(/(Ouvert à|Open) 40/);
    expect(visibleSlats(icon)).toBe(2);
  });

  it("closes the icon's slats on a closed shutter and opens them on an open one", () => {
    const { unmount } = renderCard(shutter(0));
    const closed = screen.getByRole("img", { name: /Fermé|Closed/ });
    expect(visibleSlats(closed)).toBe(4);
    unmount();
    renderCard(shutter(100));
    expect(visibleSlats(screen.getByRole("img", { name: /^(Ouvert|Open)$/ }))).toBe(0);
  });

  it("draws a gate open or closed in its icon", () => {
    const { container, unmount } = renderCard(gate("closed"));
    expect(screen.getByRole("img", { name: /Fermé|Closed/ })).toBeTruthy();
    expect(container.querySelector(".lucide-door-closed")).toBeTruthy();
    unmount();
    const open = renderCard(gate("open"));
    expect(screen.getByRole("img", { name: /^(Ouvert|Open)$/ })).toBeTruthy();
    expect(open.container.querySelector(".lucide-door-open")).toBeTruthy();
  });

  it("keeps an unknown gate's pill on phones, its picto saying nothing", () => {
    const { container } = renderCard(gate(null));
    expect(screen.getByRole("img", { name: /inconnu|Unknown/i })).toBeTruthy();
    expect(container.querySelector(".lucide-door-closed")).toBeNull();
    const pillGroup = container.querySelector('[data-row-readings="main"]')!;
    expect(pillGroup.className).not.toContain("sm:flex");
    expect(pillGroup.textContent).toMatch(/inconnu|Unknown/i);
  });

  it("hides the state pill on phones for every shutter and gate row, whatever its name", () => {
    for (const eq of [shutter(40, { name: "Volet" }), shutter(0), gate("open")]) {
      const { container, unmount } = renderCard(eq);
      const pillGroup = container.querySelector('[data-row-readings="main"]')!;
      expect(pillGroup.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(pillGroup.className).toContain("sm:flex");
      unmount();
    }
  });

  it("leaves the other readings to their give-way rule", () => {
    const { container } = renderCard(thermostat());
    const group = container.querySelector('[data-row-readings="main"]')!;
    expect(group.className).not.toContain("sm:flex");
    expect(container.querySelector("[data-row-state]")).toBeNull();
  });
});

describe("CompactEquipmentCard — door, awning and pool cover state icons (#1163)", () => {
  const door = (bindings: EquipmentWithDetails["dataBindings"]) =>
    makeEquipment("door", [], {
      name: "Porte poulailler",
      dataBindings: bindings,
      orderBindings: [
        orderBinding("state", { category: "shutter_move", enumValues: ["OPEN", "STOP", "CLOSE"] }),
      ],
    });
  const pillGroup = (container: HTMLElement) =>
    container.querySelector('[data-row-readings="main"]')!;

  it("draws a closed door closed and leaves its pill to wider screens", () => {
    const { container } = renderCard(door([dataBinding("state", "CLOSED")]));
    expect(screen.getByRole("img", { name: /Fermée|Closed/ })).toBeTruthy();
    expect(container.querySelector(".lucide-door-closed")).toBeTruthy();
    expect(pillGroup(container).className).toContain("sm:flex");
  });

  it("keeps a door's pill on phones while it is in fault or moving", () => {
    for (const [word, label] of [
      ["FAULT", /Défaut|Fault/],
      ["OPENING", /En mouvement|Moving/],
    ] as const) {
      const { container, unmount } = renderCard(door([dataBinding("state", word)]));
      expect(screen.getByRole("img", { name: label })).toBeTruthy();
      expect(pillGroup(container).className).not.toContain("sm:flex");
      expect(pillGroup(container).textContent).toMatch(label);
      unmount();
    }
  });

  it("names a door's partial position in the door's own words", () => {
    renderCard(door([dataBinding("position", 40, { category: "shutter_position" })]));
    expect(screen.getByRole("img", { name: /(Ouverte à|Open) 40/ })).toBeTruthy();
  });

  it("names an awning's partial position as deployed", () => {
    renderCard(
      makeEquipment("awning", [], {
        name: "Store",
        dataBindings: [dataBinding("position", 40, { category: "shutter_position" })],
      }),
    );
    expect(screen.getByRole("img", { name: /(Déployé à|Deployed) 40/ })).toBeTruthy();
  });

  it("draws a pool cover's position like a shutter's", () => {
    const { container } = renderCard(
      makeEquipment("pool_cover", [], {
        name: "Volet Piscine",
        dataBindings: [dataBinding("position", 0, { category: "shutter_position" })],
      }),
    );
    const icon = screen.getByRole("img", { name: /Fermé|Closed/ });
    expect(icon.querySelectorAll("line").length).toBe(4);
    expect(container.querySelector("[data-row-state]")).toBe(icon);
  });
});
