/**
 * Spec 174 phase 2 (FR-14/FR-15) — the timed tile.
 *
 * What the tests pin is the pair of gestures: pressing again while the window
 * is open must EXTEND it (one arm call, nothing dispatched by the engine), and
 * the cancel must send the revert rather than silently drop the deadline —
 * somebody looking at an open gate means "close it".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { TimedEquipmentWidget } from "./TimedEquipmentWidget";
import * as api from "../../api";
import type { EquipmentWithDetails, TimedAction } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  armTimedCommand: vi.fn().mockResolvedValue({}),
  cancelTimedCommand: vi.fn().mockResolvedValue(undefined),
  getEquipments: vi.fn().mockResolvedValue([]),
}));

const RUNNING: TimedAction = {
  alias: "command",
  value: null,
  revertValue: null,
  armedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
};

function gate(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return {
    id: "g1",
    name: "Portail",
    zoneId: "z1",
    type: "gate",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [],
    orderBindings: [{ id: "o1", alias: "command", enumValues: [] }],
    timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
    ...over,
  } as unknown as EquipmentWithDetails;
}

describe("TimedEquipmentWidget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("announces the configured window before anything is running", () => {
    render(<TimedEquipmentWidget label="Portail" equipment={gate()} />);

    // The duration is on the tile, twice over: in the sublabel and in the idle
    // pill, so a press is never a surprise wherever the eye lands.
    expect(screen.getAllByText(/15 min/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTitle(/Lancer|Run for/i)).toBeTruthy();
  });

  it("arms from the equipment's own configuration, with no values of its own", async () => {
    render(<TimedEquipmentWidget label="Portail" equipment={gate()} />);

    await userEvent.click(screen.getByTitle(/Lancer|Run for/i));

    expect(api.armTimedCommand).toHaveBeenCalledWith("g1");
    expect(api.armTimedCommand).toHaveBeenCalledTimes(1);
  });

  it("shows the countdown and extends on a second press", async () => {
    render(<TimedEquipmentWidget label="Portail" equipment={gate({ timedAction: RUNNING })} />);

    expect(screen.getByText("10:00")).toBeTruthy();

    await userEvent.click(screen.getByTitle(/Prolonger|more time/i));

    // Same call: the engine turns it into an extension (FR-5) and dispatches
    // nothing, which is why the tile does not need a second endpoint.
    expect(api.armTimedCommand).toHaveBeenCalledWith("g1");
    expect(api.cancelTimedCommand).not.toHaveBeenCalled();
  });

  it("cancelling sends the revert now", async () => {
    render(<TimedEquipmentWidget label="Portail" equipment={gate({ timedAction: RUNNING })} />);

    await userEvent.click(screen.getByTitle(/Arrêter|End it/i));

    expect(api.cancelTimedCommand).toHaveBeenCalledWith("g1", true);
  });

  it("says so when the order could not go out", async () => {
    vi.mocked(api.armTimedCommand).mockRejectedValueOnce(new Error("integration not connected"));
    render(<TimedEquipmentWidget label="Portail" equipment={gate()} />);

    await userEvent.click(screen.getByTitle(/Lancer|Run for/i));

    await waitFor(() =>
      expect(screen.getByText(/Commande non envoyée|Command not sent/)).toBeTruthy(),
    );
  });

  it("goes inert when the configuration was cleared under it", async () => {
    // An admin unticks "Timed command" while the tile stays pinned. It must
    // not fall through to actuating outright: the next press would open the
    // gate with no deadline at all.
    render(<TimedEquipmentWidget label="Portail" equipment={gate({ timedCommand: null })} />);

    expect(screen.getByText(/Commande non configurée|No timed command/)).toBeTruthy();
    await userEvent.click(screen.getByTitle(/Lancer|Run for/i));
    expect(api.armTimedCommand).not.toHaveBeenCalled();
  });

  it("goes inert on a disabled equipment", async () => {
    render(<TimedEquipmentWidget label="Portail" equipment={gate({ enabled: false })} />);

    await userEvent.click(screen.getByTitle(/Lancer|Run for/i));
    expect(api.armTimedCommand).not.toHaveBeenCalled();
  });

  it("never lets the controls be the row that gives ground", () => {
    // There is no layout engine here, so what is pinned is the rule the fix
    // rests on. Measured in a browser at 390 px: the arm button used to hang
    // 14 px below the card's edge, and `overflow-hidden` cut it in half.
    // The illustration is the flexible row and the only one hidden on a
    // phone; the state and the controls never shrink.
    const { container } = render(<TimedEquipmentWidget label="Portail" equipment={gate()} />);

    const illustration = container.querySelector(".flex-1");
    expect(illustration?.className).toContain("min-h-0");
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("hidden sm:block");

    const arm = screen.getByTitle(/Lancer|Run for/i);
    expect(arm.parentElement?.className).toContain("shrink-0");
    const pill = container.querySelector(".rounded-full");
    expect(pill?.parentElement?.className).toContain("shrink-0");
  });

  it("is inert in edit mode, where the tile is a drag target", async () => {
    render(<TimedEquipmentWidget label="Portail" equipment={gate()} editMode />);

    await userEvent.click(screen.getByTitle(/Lancer|Run for/i));

    expect(api.armTimedCommand).not.toHaveBeenCalled();
  });
});
