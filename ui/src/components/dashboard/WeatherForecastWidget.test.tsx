/**
 * Spec 168 — tomorrow's confidence on the dashboard tile (option A2).
 *
 * The tile showed tomorrow and nothing else, so the confidence the plugin has
 * published since 2.0 was invisible where the forecast is actually read. The
 * tile qualifies the day it shows; the other four days live in the panel
 * behind the click.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { WeatherForecastWidget } from "./WeatherForecastWidget";
import type { DataBindingWithValue, EquipmentWithDetails } from "../../types";

function binding(alias: string, value: unknown): DataBindingWithValue {
  return {
    id: "b-" + alias,
    equipmentId: "eq",
    deviceDataId: "dd-" + alias,
    deviceId: "d1",
    deviceName: "Open-Meteo",
    key: alias,
    alias,
    type: typeof value === "number" ? "number" : "string",
    category: "generic",
    value,
    lastUpdated: new Date().toISOString(),
    lastChanged: new Date().toISOString(),
    stale: false,
  } as unknown as DataBindingWithValue;
}

/** `days` entries: [tempMax, confidence | null]. */
function forecast(days: Array<[number | null, string | null]>): EquipmentWithDetails {
  const bindings: DataBindingWithValue[] = [];
  days.forEach(([tempMax, confidence], i) => {
    const n = i + 1;
    bindings.push(binding(`j${n}_condition`, "cloudy"));
    if (tempMax !== null) bindings.push(binding(`j${n}_temp_max`, tempMax));
    bindings.push(binding(`j${n}_temp_min`, 15));
    if (confidence) bindings.push(binding(`j${n}_confidence`, confidence));
  });
  return {
    id: "eq",
    name: "Prévisions Météo",
    type: "weather_forecast",
    zoneId: "z",
    enabled: true,
    status: "online",
    dataBindings: bindings,
    orderBindings: [],
  } as unknown as EquipmentWithDetails;
}

const FIVE: Array<[number | null, string | null]> = [
  [26, "medium"],
  [26, "medium"],
  [27, "low"],
  [27, "high"],
  [30, "medium"],
];

/** The confidence dot, by its colour class. */
function dots(container: HTMLElement): string[] {
  return [...container.querySelectorAll("span.rounded-full")]
    .map((el) => [...el.classList].find((c) => c.startsWith("bg-")) ?? "")
    .filter(Boolean);
}

describe("WeatherForecastWidget — tomorrow's confidence (spec 168)", () => {
  it("names tomorrow's confidence next to the condition", () => {
    render(<WeatherForecastWidget label="Météo" equipment={forecast(FIVE)} />);
    // Tomorrow is medium here; the mark says so in words, not in colour alone.
    expect(screen.getByText("fairly reliable")).toBeTruthy();
  });

  it("colours the dot by tomorrow's confidence", () => {
    const { container } = render(
      <WeatherForecastWidget label="Météo" equipment={forecast([[26, "low"]])} />,
    );
    expect(dots(container)).toEqual(["bg-error"]);
  });

  it("qualifies tomorrow, not some other day", () => {
    // J+1 high, the rest low: the tile must not average or borrow.
    const { container } = render(
      <WeatherForecastWidget
        label="Météo"
        equipment={forecast([
          [26, "high"],
          [27, "low"],
          [28, "low"],
        ])}
      />,
    );
    expect(dots(container)).toEqual(["bg-success"]);
    expect(screen.getByText("reliable")).toBeTruthy();
  });

  it("shows nothing at all when the plugin publishes no confidence", () => {
    // A household on a plugin older than 2.0. A grey dot and "not qualified"
    // would spend a line of a 212px card saying nothing, and an uncoloured
    // dot must never read as a good verdict.
    const { container } = render(
      <WeatherForecastWidget
        label="Météo"
        equipment={forecast([
          [26, null],
          [27, null],
        ])}
      />,
    );
    expect(dots(container)).toEqual([]);
    expect(container.textContent).not.toMatch(/reliable/);
  });

  it("carries no five-day strip: the days are in the panel behind the click", () => {
    const { container } = render(
      <WeatherForecastWidget label="Météo" equipment={forecast(FIVE)} />,
    );
    expect(container.querySelector("[class*='h-[3px]']")).toBeNull();
    expect(container.querySelector("[class*='h-[2px]']")).toBeNull();
  });

  it("is clickable when a detail handler is given", () => {
    const onOpenDetail = vi.fn();
    const { container } = render(
      <WeatherForecastWidget label="Météo" equipment={forecast(FIVE)} onOpenDetail={onOpenDetail} />,
    );
    const card = container.querySelector(".cursor-pointer");
    expect(card).toBeTruthy();
    (card as HTMLElement).click();
    expect(onOpenDetail).toHaveBeenCalledOnce();
  });

  it("is not clickable without one, which is edit mode", () => {
    const { container } = render(
      <WeatherForecastWidget label="Météo" equipment={forecast(FIVE)} />,
    );
    expect(container.querySelector(".cursor-pointer")).toBeNull();
  });
});
