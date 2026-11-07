import { describe, expect, it } from "vitest";
import { render, screen } from "../../test-utils";
import { EnergyDataPanel } from "./EnergyDataPanel";
import type { ComputedDataEntry } from "../../types";

// #1129 — on a phone a tile is half the card: with its 52 px icon, « Heure en
// cours » wrapped on two lines and « 4 568 kWh » ran past the tile at 360 px
// (measured in Chromium). The icon is shown from `sm` only.
describe("EnergyDataPanel tiles", () => {
  it("keeps the decorative icon off the phone layout", () => {
    const entry = { alias: "energy_hour", value: 1234 } as unknown as ComputedDataEntry;
    render(<EnergyDataPanel section computedData={[entry]} />);
    const label = screen.getByText("Current hour");
    const tile = label.parentElement!.parentElement!;
    const icon = tile.firstElementChild as HTMLElement;
    expect(icon.querySelector("svg")).toBeTruthy();
    expect(icon.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(icon.className).toMatch(/(^|\s)sm:flex(\s|$)/);
  });
});
