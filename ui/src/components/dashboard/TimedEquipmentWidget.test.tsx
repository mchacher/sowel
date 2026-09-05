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
  stepIndex: 0,
  nextDurationMs: 15 * 60_000,
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

    // Spec 178 — the button says what the NEXT press does. Without a ladder
    // that is still "extend by the configured length", named rather than
    // implied.
    await userEvent.click(screen.getByTitle(/Next press: 15 min|Appui suivant/i));

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

  it("is inert in edit mode, where the tile is a drag target", async () => {
    render(<TimedEquipmentWidget label="Portail" equipment={gate()} editMode />);

    await userEvent.click(screen.getByTitle(/Lancer|Run for/i));

    expect(api.armTimedCommand).not.toHaveBeenCalled();
  });

  // ── Spec 178 — the tile names what the next press does ─────

  it("announces the next step rather than an interchangeable press", () => {
    const onSecondRung = { ...RUNNING, stepIndex: 1, nextDurationMs: 60 * 60_000 };
    render(
      <TimedEquipmentWidget label="Portail" equipment={gate({ timedAction: onSecondRung })} />,
    );

    expect(screen.getByTitle(/Next press: 60 min|Appui suivant : 60 min/i)).toBeTruthy();
  });

  it("says the top rung stops the countdown, which is not what cancel does", () => {
    // The two controls sit side by side and do opposite things: this one leaves
    // the gate open, the X beside it closes it. Naming them apart is the point.
    const onTopRung = { ...RUNNING, stepIndex: 2, nextDurationMs: null };
    render(<TimedEquipmentWidget label="Portail" equipment={gate({ timedAction: onTopRung })} />);

    expect(screen.getByTitle(/stop the countdown|arrêter le décompte/i)).toBeTruthy();
  });

  it("says the countdown was stopped instead of falling back to its resting face", async () => {
    // The trap this pins: after the give-up press there is no window left, so
    // the tile would otherwise read "Run for 15 min" over a gate standing open
    // — and on an impulse gate that press CLOSES it, then arms a window that
    // re-opens it later.
    vi.mocked(api.armTimedCommand).mockResolvedValueOnce({ disarmed: true });
    const onTopRung = { ...RUNNING, stepIndex: 2, nextDurationMs: null };
    const { rerender } = render(
      <TimedEquipmentWidget label="Portail" equipment={gate({ timedAction: onTopRung })} />,
    );

    await userEvent.click(screen.getByTitle(/stop the countdown|arrêter le décompte/i));

    // The refetch drops the window from the store, which is what would put the
    // tile back on its resting face.
    rerender(<TimedEquipmentWidget label="Portail" equipment={gate()} />);

    expect(await screen.findByText(/Countdown stopped|Décompte arrêté/i)).toBeTruthy();
  });
});
