/**
 * Spec 168 — the five-day strip on the dashboard tile.
 *
 * The tile showed tomorrow and nothing else, so the confidence the plugin has
 * published since 2.0 was invisible where the forecast is actually read, and
 * nothing suggested there was more behind the card.
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

/** The strip's bars, in order, by their colour class. */
function bars(container: HTMLElement): string[] {
  return [...container.querySelectorAll("span.rounded-full")]
    .map((el) => [...el.classList].find((c) => c.startsWith("bg-")) ?? "")
    .filter(Boolean);
}

describe("WeatherForecastWidget — five-day strip (spec 168)", () => {
  it("shows one column per day with its maximum", () => {
    render(<WeatherForecastWidget label="Météo" equipment={forecast(FIVE)} />);
    // 26 appears on the J+1 summary and twice in the strip.
    expect(screen.getAllByText("26").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("30").length).toBe(1);
  });

  it("colours each bar by that day's confidence, not by a fixed colour", () => {
    const { container } = render(
      <WeatherForecastWidget label="Météo" equipment={forecast(FIVE)} />,
    );
    expect(bars(container)).toEqual([
      "bg-warning",
      "bg-warning",
      "bg-error",
      "bg-success",
      "bg-warning",
    ]);
  });

  it("falls back to neutral when the plugin publishes no confidence", () => {
    // A household on a plugin older than 2.0. An absent verdict must not
    // borrow a confidence colour and read as a good one.
    const { container } = render(
      <WeatherForecastWidget
        label="Météo"
        equipment={forecast([
          [26, null],
          [27, null],
        ])}
      />,
    );
    expect(bars(container)).toEqual(["bg-border", "bg-border"]);
  });

  it("renders no strip when only tomorrow is bound", () => {
    const { container } = render(
      <WeatherForecastWidget label="Météo" equipment={forecast([[26, "medium"]])} />,
    );
    // One day is the summary, not a strip: a single column would be noise.
    expect(bars(container)).toEqual([]);
  });

  it("caps the strip at five even when the plugin publishes more", () => {
    const seven: Array<[number | null, string | null]> = Array.from({ length: 7 }, () => [
      20,
      "medium",
    ]);
    const { container } = render(
      <WeatherForecastWidget label="Météo" equipment={forecast(seven)} />,
    );
    expect(bars(container)).toHaveLength(5);
  });

  it("shows a dash rather than a number when a day has no maximum", () => {
    const { container } = render(
      <WeatherForecastWidget
        label="Météo"
        equipment={forecast([
          [26, "medium"],
          [null, "medium"],
        ])}
      />,
    );
    expect(container.textContent).toContain("—");
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
