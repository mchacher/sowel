import { describe, expect, it } from "vitest";
import { render, screen } from "../../test-utils";
import { TooltipSeriesRow } from "./TooltipSeriesRow";

// #1126 — a tooltip row carries its series colour on a swatch; its words are
// neutral. Written in the off-peak blue, the row was 2.08:1 on a light card.
describe("TooltipSeriesRow", () => {
  it("puts the series colour on the swatch and none on the words", () => {
    const { container } = render(
      <TooltipSeriesRow color="var(--color-energy-hc)" label="Heures creuses" value="1,2 kWh" />,
    );
    expect(screen.getByTestId("tooltip-swatch").style.backgroundColor).toBe(
      "var(--color-energy-hc)",
    );
    const withColour = [...container.querySelectorAll<HTMLElement>("*")].filter(
      (el) => el.style.color !== "",
    );
    expect(withColour).toEqual([]);
    expect(screen.getByText("Heures creuses").parentElement!.className).toContain(
      "text-text-secondary",
    );
    expect(screen.getByText("1,2 kWh").className).toContain("text-text");
  });
});
