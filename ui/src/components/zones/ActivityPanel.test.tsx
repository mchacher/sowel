import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "../../test-utils";
import i18n from "../../i18n";
import { useActivity } from "../../store/useActivity";
import { useWebSocket } from "../../store/useWebSocket";
import { useZones } from "../../store/useZones";
import type { ActivityItem } from "../../types";
import { ActivityPanel } from "./ActivityPanel";

// Spec 196, slice 7c — Activité is one log under its lid: newest first, one
// row per event, a separator where it crosses into another part of the day,
// no more one card per hour.

function sun(id: string, timestamp: number, template: "sunlight.sunrise" | "sunlight.sunset"): ActivityItem {
  return { id, timestamp, category: "sunlight", zoneId: null, message: { template, params: {} } };
}

describe("ActivityPanel", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 7, 17, 50));
    await i18n.changeLanguage("fr");
    useZones.setState({ tree: [] } as never);
    useWebSocket.setState({ status: "connected" } as never);
    useActivity.setState({
      items: [
        sun("set", new Date(2026, 10, 7, 16, 31).getTime(), "sunlight.sunset"),
        sun("rise", new Date(2026, 10, 7, 7, 54).getTime(), "sunlight.sunrise"),
      ],
      status: "ready",
      loadForZone: async () => {},
      reset: () => {},
      retry: async () => {},
    } as never);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await i18n.changeLanguage("en");
  });

  it("keeps title, subtitle and live badge in the lid, and lists the log newest first", () => {
    render(<ActivityPanel zoneId="z1" />);
    const lid = screen.getByRole("heading", { level: 2, name: "Activité" }).parentElement!;
    expect(lid.className).toMatch(/\bpanel-lid\b/);
    expect(within(lid).getByText("dernières 24 h")).toBeTruthy();
    expect(within(lid).getByText("en direct")).toBeTruthy();

    const log = screen.getByTestId("activity-log");
    expect(log.closest(".slices")).toBeTruthy();
    expect(lid.contains(log)).toBe(false);
    const times = [...log.querySelectorAll("time")].map((el) => el.textContent);
    expect(times).toEqual(["16:31", "07:54"]);
  });

  it("marks the morning with a separator and no hour cards", () => {
    render(<ActivityPanel zoneId="z1" />);
    const log = screen.getByTestId("activity-log");
    expect(within(log).getByText("Ce matin")).toBeTruthy();
    // The current part (this afternoon) carries no label, and no "HH:00" bucket is left.
    expect(within(log).queryByText("Cet après-midi")).toBeNull();
    expect(within(log).queryByText(/^\d\d:00/)).toBeNull();
  });
});
