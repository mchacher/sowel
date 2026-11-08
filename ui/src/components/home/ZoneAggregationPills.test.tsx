import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { ZoneAggregationPills } from "./ZoneAggregationPills";
import { ROOT_ZONE_ID } from "../../lib/constants";
import type { ZoneAggregatedData } from "../../types";

// #1133 — the sun is back in the top bar on every page and every viewport, so
// the root zone's strip no longer repeats it.

const data: ZoneAggregatedData = {
  temperature: 20.5,
  humidity: null,
  luminosity: null,
  motion: false,
  motionSensors: 0,
  motionSince: null,
  openDoors: 0,
  openWindows: 0,
  waterLeak: false,
  smoke: false,
  lightsOn: 0,
  lightsTotal: 0,
  shuttersOpen: 0,
  shuttersTotal: 0,
  averageShutterPosition: null,
  doorsOpen: 0,
  doorsTotal: 0,
  waterValvesOpen: 0,
  waterValvesTotal: 0,
  waterFlowTotal: null,
  powerTotal: null,
  sunrise: "07:22",
  sunset: "17:17",
  isDaylight: true,
  displaysOnline: 0,
  displaysTotal: 0,
  unavailableEquipmentsByCategory: {},
  unavailableEquipmentNamesByCategory: {},
};

describe("ZoneAggregationPills — sun and layout", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
  });

  it("leaves sunrise and sunset to the top bar, root zone included", () => {
    render(<ZoneAggregationPills data={data} zoneId={ROOT_ZONE_ID} />);
    expect(screen.queryByText(/07:22/)).toBeNull();
    expect(screen.queryByText("Soleil")).toBeNull();
  });

  it("wraps on phones and tablets, a single scrolling line only from lg", () => {
    const { container } = render(<ZoneAggregationPills data={data} zoneId={ROOT_ZONE_ID} />);
    const strip = container.firstElementChild!.firstElementChild!;
    const classes = strip.className.split(/\s+/);
    // At 820 px (a tablet) the strip used to stop wrapping and overflow sideways.
    expect(classes).toContain("flex-wrap");
    expect(classes).toContain("lg:flex-nowrap");
    expect(classes).not.toContain("sm:flex-nowrap");
    expect(classes).not.toContain("sm:overflow-x-auto");
  });
});

// #1134 — offline equipments: a marker on the pill that names them, traceable to
// the zone they are in.
describe("ZoneAggregationPills — offline equipments", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
  });

  const offlineLights = (lightsTotal: number): ZoneAggregatedData => ({
    ...data,
    lightsOn: lightsTotal > 0 ? 1 : 0,
    lightsTotal,
    unavailableEquipmentsByCategory: { light_state: 2 },
    unavailableEquipmentNamesByCategory: { light_state: ["Guirlande", "Spot Piscine"] },
  });

  it("marks the pill and names the offline equipments instead of a count", () => {
    const { container } = render(
      <ZoneAggregationPills data={offlineLights(16)} zoneId="zone-maison" />,
    );
    const pill = screen.getByText("1/16").parentElement!;
    expect(pill.getAttribute("title")).toBe("Hors ligne : Guirlande, Spot Piscine");
    expect(pill.querySelector(".bg-warning")).not.toBeNull();
    expect(container.textContent).not.toMatch(/indispo/);
  });

  it("keeps a greyed lights pill in a zone whose lights are all offline", () => {
    render(<ZoneAggregationPills data={offlineLights(0)} zoneId="zone-piscine" />);
    const pill = screen.getByTitle(/^Hors ligne\s: Guirlande, Spot Piscine$/);
    expect(pill.textContent).toContain("—");
    expect(pill.querySelector(".text-text-tertiary")).not.toBeNull();
  });

  it("keeps a greyed shutters pill in a zone whose shutters are all offline", () => {
    render(
      <ZoneAggregationPills
        data={{
          ...data,
          unavailableEquipmentsByCategory: { shutter_position: 1 },
          unavailableEquipmentNamesByCategory: { shutter_position: ["Volet bureau"] },
        }}
        zoneId="zone-bureau"
      />,
    );
    expect(screen.getByTitle(/^Hors ligne\s: Volet bureau$/).textContent).toContain("—");
  });

  // #1140 — a `title` never shows on a touch screen: at 390 px, a tap on the
  // marked pill must name the offline equipments in visible text.
  it("names the offline equipments on a tap, at a 390 px viewport", async () => {
    const width = window.innerWidth;
    window.innerWidth = 390;
    try {
      const user = userEvent.setup();
      render(<ZoneAggregationPills data={offlineLights(16)} zoneId="zone-maison" />);
      const pill = screen.getByRole("button", { name: /1\/16/ });
      expect(pill.getAttribute("aria-expanded")).toBe("false");
      const visibleNames = () =>
        screen
          .queryAllByText(/^Hors ligne\s: Guirlande, Spot Piscine$/)
          .filter((el) => !el.classList.contains("sr-only"));
      expect(visibleNames()).toHaveLength(0);

      await user.click(pill);
      expect(pill.getAttribute("aria-expanded")).toBe("true");
      const [line] = visibleNames();
      expect(line).toBeDefined();
      expect(pill.getAttribute("aria-controls")).toBe(line.id);

      await user.click(pill);
      expect(visibleNames()).toHaveLength(0);
    } finally {
      window.innerWidth = width;
    }
  });

  it("closes the names line on a zone change and once nothing is offline", async () => {
    const user = userEvent.setup();
    const visible = () =>
      screen.queryAllByText(/^Hors ligne\s:/).filter((el) => !el.classList.contains("sr-only"));
    const { rerender } = render(
      <ZoneAggregationPills data={offlineLights(16)} zoneId="zone-maison" />,
    );
    await user.click(screen.getByRole("button", { name: /1\/16/ }));
    expect(visible()).toHaveLength(1);

    rerender(<ZoneAggregationPills data={offlineLights(16)} zoneId="zone-salon" />);
    expect(visible()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /1\/16/ }));
    rerender(
      <ZoneAggregationPills data={{ ...data, lightsOn: 1, lightsTotal: 16 }} zoneId="zone-salon" />,
    );
    rerender(<ZoneAggregationPills data={offlineLights(16)} zoneId="zone-salon" />);
    expect(visible()).toHaveLength(0);
  });

  it("keeps an unmarked pill a plain element, not a button", () => {
    render(
      <ZoneAggregationPills data={{ ...data, lightsOn: 1, lightsTotal: 3 }} zoneId="zone-salon" />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows no marker when nothing is offline", () => {
    const { container } = render(
      <ZoneAggregationPills data={{ ...data, lightsOn: 1, lightsTotal: 3 }} zoneId="zone-salon" />,
    );
    expect(container.querySelector(".bg-warning")).toBeNull();
    expect(screen.queryByTitle(/Hors ligne/)).toBeNull();
  });
});
