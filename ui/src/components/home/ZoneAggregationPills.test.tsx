import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { ZoneAggregationPills } from "./ZoneAggregationPills";
import { ROOT_ZONE_ID } from "../../lib/constants";
import type { ZoneAggregatedData } from "../../types";

// Spec 196, decision pr6-soleil — phones have no room for sunrise and sunset in
// the top bar any more; the root zone's strip carries them instead.

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

describe("ZoneAggregationPills — sun", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
  });

  it("shows sunrise and sunset in the root zone's strip below lg, named for screen readers", () => {
    render(<ZoneAggregationPills data={data} zoneId={ROOT_ZONE_ID} />);
    const pill = screen.getByText(/^07:22\s–\s17:17$/).parentElement!;
    expect(pill.textContent).toContain("Soleil");
    // The desktop top bar already shows them: the strip does not repeat them there.
    expect(pill.className).toContain("lg:hidden");
  });

  it("hides the separator before the sun along with it", () => {
    const { container } = render(<ZoneAggregationPills data={data} zoneId={ROOT_ZONE_ID} />);
    const pill = screen.getByText(/^07:22\s–\s17:17$/).parentElement!;
    const separator = pill.previousElementSibling!;
    expect(separator.className).toContain("w-px");
    // Separators only show from lg, where the sun pill is gone: this one never does.
    expect(separator.className.split(/\s+/)).toContain("hidden");
    expect(container.querySelectorAll(".w-px.lg\\:block")).toHaveLength(0);
  });

  it("wraps on phones and tablets, a single scrolling line only from lg", () => {
    const { container } = render(<ZoneAggregationPills data={data} zoneId={ROOT_ZONE_ID} />);
    const strip = container.firstElementChild!;
    const classes = strip.className.split(/\s+/);
    // At 820 px (a tablet) the strip used to stop wrapping and overflow sideways.
    expect(classes).toContain("flex-wrap");
    expect(classes).toContain("lg:flex-nowrap");
    expect(classes).not.toContain("sm:flex-nowrap");
    expect(classes).not.toContain("sm:overflow-x-auto");
  });

  it("leaves them out of any other zone's strip", () => {
    render(<ZoneAggregationPills data={data} zoneId="zone-salon" />);
    expect(screen.queryByText(/07:22/)).toBeNull();
  });

  it("leaves them out when the home has no sun times", () => {
    render(
      <ZoneAggregationPills
        data={{ ...data, sunrise: null, sunset: null }}
        zoneId={ROOT_ZONE_ID}
      />,
    );
    expect(screen.queryByText("Soleil")).toBeNull();
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

  it("shows no marker when nothing is offline", () => {
    const { container } = render(
      <ZoneAggregationPills data={{ ...data, lightsOn: 1, lightsTotal: 3 }} zoneId="zone-salon" />,
    );
    expect(container.querySelector(".bg-warning")).toBeNull();
    expect(screen.queryByTitle(/Hors ligne/)).toBeNull();
  });
});
