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
    expect(separator.className).toContain("lg:hidden");
    expect(container.querySelectorAll(".w-px:not(.lg\\:hidden)")).toHaveLength(0);
  });

  it("leaves them out of any other zone's strip", () => {
    render(<ZoneAggregationPills data={data} zoneId="zone-salon" />);
    expect(screen.queryByText(/07:22/)).toBeNull();
  });

  it("leaves them out when the home has no sun times", () => {
    render(<ZoneAggregationPills data={{ ...data, sunrise: null, sunset: null }} zoneId={ROOT_ZONE_ID} />);
    expect(screen.queryByText("Soleil")).toBeNull();
  });
});
