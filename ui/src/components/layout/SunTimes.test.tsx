import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { MobileSunTimes, SunTimes } from "./SunTimes";
import type { ZoneAggregatedData } from "../../types";

// #1133 — the sun is back in the top bar on phones and tablets, on every page.

const root = {
  sunrise: "07:22",
  sunset: "17:17",
  isDaylight: true,
} as ZoneAggregatedData;

describe("SunTimes", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
  });

  it("shows sunrise and sunset, named for screen readers", () => {
    render(<SunTimes data={root} />);
    const range = screen.getByText(/^07:22\s–\s17:17$/);
    expect(range.parentElement!.textContent).toContain("Soleil");
  });

  it("shows nothing without sun times", () => {
    const { container } = render(<SunTimes data={{ ...root, sunrise: null, sunset: null }} />);
    expect(container.textContent).toBe("");
  });
});

describe("MobileSunTimes", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
  });

  const wrapperClasses = (headerPills: number): string[] => {
    const { container } = render(<MobileSunTimes data={root} headerPills={headerPills} />);
    return (container.firstElementChild as HTMLElement).className.split(/\s+/);
  };

  it("shows on a phone beside no pill or one", () => {
    expect(wrapperClasses(0)).toEqual(["flex"]);
    expect(wrapperClasses(1)).toEqual(["flex"]);
  });

  it("gives way to two pills or more below sm, so the bar never wraps", () => {
    expect(wrapperClasses(2)).toEqual(["hidden", "sm:flex"]);
    expect(wrapperClasses(3)).toEqual(["hidden", "sm:flex"]);
  });
});
