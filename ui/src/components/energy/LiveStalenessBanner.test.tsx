/**
 * Issue #854 — the banner above the live flow diagram must say WHICH meter is
 * frozen, and must keep quiet about readings this page never draws.
 *
 * Rendered through the whole page rather than against the helper, because the
 * reported defect is what the sentence says to a reader: the helper can be
 * right while the page prints the wrong label, or an i18n key that no longer
 * exists.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "../../test-utils";
import { MemoryRouter } from "react-router-dom";
import { LiveEnergyPage } from "./LiveEnergyPage";
import { useEquipments } from "../../store/useEquipments";
import type { DataBindingWithValue, EquipmentWithDetails } from "../../types";

vi.mock("../../hooks/useWsSubscription", () => ({ useWsSubscription: () => {} }));

const NOW = Date.parse("2026-08-30T15:17:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function meter(
  id: string,
  type: EquipmentWithDetails["type"],
  power: number,
  opts: {
    ageMs?: number;
    status?: EquipmentWithDetails["status"];
    offlineSince?: string;
    /** Force `lastUpdated`, including to null: a meter that never reported. */
    lastUpdated?: string | null;
    extra?: Partial<DataBindingWithValue>[];
  } = {},
): EquipmentWithDetails {
  return {
    id,
    name: id,
    type,
    zoneId: "z",
    enabled: true,
    status: opts.status ?? "online",
    statusReason: opts.offlineSince
      ? { offlineDevices: [], staleBindings: [], offlineSince: opts.offlineSince }
      : undefined,
    dataBindings: [
      {
        id: `${id}-p`,
        alias: "power",
        category: "power",
        type: "number",
        value: power,
        lastUpdated: opts.lastUpdated !== undefined ? opts.lastUpdated : ago(opts.ageMs ?? 20_000),
        stale: false,
      },
      ...(opts.extra ?? []).map((b, i) => ({
        id: `${id}-x${i}`,
        type: "number",
        stale: false,
        ...b,
      })),
    ],
    orderBindings: [],
  } as unknown as EquipmentWithDetails;
}

function seed(equipments: EquipmentWithDetails[]): void {
  useEquipments.setState({ equipments, fetchEquipments: async () => {} } as never);
}

const banners = () => screen.queryAllByRole("status");
const bannerText = () => banners().map((b) => b.textContent ?? "");

describe("Live energy staleness banner (#854)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    seed([]);
  });
  afterEach(() => vi.useRealTimers());

  it("names the production meter and leaves the live grid figure alone", () => {
    // The reported screenshot: production three minutes behind, grid updating.
    seed([
      meter("Grid", "main_energy_meter", 0),
      meter("Solar", "energy_production_meter", 3000, { ageMs: 3 * 60_000 }),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(bannerText()).toEqual(["Production: reading frozen for 3 min"]);
  });

  it("names the grid meter when it is the frozen one", () => {
    seed([
      meter("Grid", "main_energy_meter", 500, { ageMs: 5 * 60_000 }),
      meter("Solar", "energy_production_meter", 3000),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(bannerText()).toEqual(["Grid: reading frozen for 5 min"]);
  });

  it("says nothing when both readings are current", () => {
    seed([
      meter("Grid", "main_energy_meter", 500),
      meter("Solar", "energy_production_meter", 3000),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(banners()).toEqual([]);
  });

  it("stays quiet for a meter degraded only by a reading this page never draws", () => {
    // Whole-equipment status degraded, watts arriving normally: the old rule
    // printed an anonymous freeze over a diagram that was entirely live.
    seed([
      meter("Grid", "main_energy_meter", 500),
      meter("Solar", "energy_production_meter", 3000, {
        status: "degraded",
        extra: [
          {
            alias: "voltage",
            category: "voltage",
            value: 230.7,
            lastUpdated: ago(6 * 60_000),
          },
        ],
      }),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(banners()).toEqual([]);
  });

  it("keeps its own wording for a disconnected meter", () => {
    seed([
      meter("Grid", "main_energy_meter", 500, {
        status: "offline",
        offlineSince: ago(20 * 60_000),
      }),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(bannerText()).toEqual(["Grid: no connection for 20 min"]);
  });

  it("gives a disconnected meter and a late one one line each, with their own ages", () => {
    // Folded into a single sentence, the grid's 20 minutes was lent to a
    // production figure 3 minutes old (review of the first draft).
    seed([
      meter("Grid", "main_energy_meter", 0, {
        status: "offline",
        offlineSince: ago(20 * 60_000),
      }),
      meter("Solar", "energy_production_meter", 3000, { ageMs: 3 * 60_000 }),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(bannerText()).toEqual([
      "Grid: no connection for 20 min",
      "Production: reading frozen for 3 min",
    ]);
  });

  it("drops the duration rather than printing a blank one", () => {
    // An offline meter Sowel has never had a reading from: there is no
    // instant to count from, and "no connection for " is not a sentence.
    seed([
      meter("Grid", "main_energy_meter", 0, { status: "offline", lastUpdated: null }),
      meter("Solar", "energy_production_meter", 3000),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });

    expect(bannerText()).toEqual(["Grid: no connection"]);
  });

  it("ages a reading out on its own clock, with no event to re-render on", () => {
    // A meter that goes silent sends nothing: without the tick the page would
    // keep showing a reading as current for as long as the house stayed quiet.
    seed([
      meter("Grid", "main_energy_meter", 500),
      meter("Solar", "energy_production_meter", 3000),
    ]);
    render(<LiveEnergyPage />, { wrapper: MemoryRouter });
    expect(banners()).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(4 * 60_000);
    });

    expect(bannerText()).toEqual([
      "Grid: reading frozen for 4 min",
      "Production: reading frozen for 4 min",
    ]);
  });
});
