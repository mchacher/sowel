/**
 * Spec 174 phase 2 (FR-12) — configuring the timed command.
 *
 * The panel's real job is the shape it saves: three values that the arm call
 * then does not have to restate. The impulse case is the one to pin, since an
 * order with no vocabulary is what the whole FR-9b fix exists for.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { TimedCommandPanel } from "./TimedCommandPanel";
import * as api from "../../api";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  updateEquipment: vi.fn().mockResolvedValue({}),
}));

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
    dataBindings: [{ id: "d1", alias: "state", category: "gate_state" }],
    // A sliding gate: one impulse order carrying no vocabulary at all.
    orderBindings: [{ id: "o1", alias: "command", enumValues: [] }],
    ...over,
  } as unknown as EquipmentWithDetails;
}

describe("TimedCommandPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is off by default and leaves its fields disabled", () => {
    render(<TimedCommandPanel equipment={gate()} onUpdated={() => {}} />);

    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    for (const select of screen.getAllByRole("combobox")) {
      expect((select as HTMLSelectElement).disabled).toBe(true);
    }
  });

  it("saves an impulse: the same command both ways, carrying no value", async () => {
    render(<TimedCommandPanel equipment={gate()} onUpdated={() => {}} />);

    await userEvent.click(screen.getByRole("checkbox"));

    // FR-9b: action and revert are identical here, which the first draft refused.
    expect(api.updateEquipment).toHaveBeenCalledWith("g1", {
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
    });
  });

  it("gives a boolean order true then false, never null both ways", async () => {
    // null both ways looks right and is wrong: `resolveOrderValue` maps an
    // empty value on a boolean binding to `true`, so the deadline would turn
    // the light on again and the window would never end.
    const light = gate({
      type: "light_onoff",
      name: "Terrasse",
      dataBindings: [{ id: "d1", alias: "state", category: "light_state" }],
      orderBindings: [{ id: "o1", alias: "state", type: "boolean" }],
    } as never);
    render(<TimedCommandPanel equipment={light} onUpdated={() => {}} />);

    await userEvent.click(screen.getByRole("checkbox"));

    expect(api.updateEquipment).toHaveBeenCalledWith("g1", {
      timedCommand: { alias: "state", value: true, revertValue: false, durationMs: 900_000 },
    });
  });

  it("changes the duration on an equipment already configured", async () => {
    const configured = gate({
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
    });
    render(<TimedCommandPanel equipment={configured} onUpdated={() => {}} />);

    await userEvent.selectOptions(screen.getByLabelText(/Durée|Duration/i), String(30 * 60_000));

    expect(api.updateEquipment).toHaveBeenCalledWith("g1", {
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 1_800_000 },
    });
  });

  it("clears the configuration when it is switched off", async () => {
    const configured = gate({
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
    });
    const onUpdated = vi.fn();
    render(<TimedCommandPanel equipment={configured} onUpdated={onUpdated} />);

    // Named, not "the checkbox": a configured panel also offers the spec 178
    // ladder switch, and the two must not be told apart by their order.
    await userEvent.click(screen.getByRole("checkbox", { name: "Enable" }));

    // null, not an empty object: the API keeps what is stored on undefined.
    expect(api.updateEquipment).toHaveBeenCalledWith("g1", { timedCommand: null });
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
  });

  it("shows the running window rather than only the configuration", () => {
    const running = gate({
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
      timedAction: {
        alias: "command",
        value: null,
        revertValue: null,
        armedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        stepIndex: 0,
        nextDurationMs: null,
      },
    });
    render(<TimedCommandPanel equipment={running} onUpdated={() => {}} />);

    expect(screen.getByText("10:00")).toBeTruthy();
  });

  it("surfaces a refusal from the API instead of pretending it saved", async () => {
    vi.mocked(api.updateEquipment).mockRejectedValueOnce(new Error("TimedCommandNotEligible"));
    render(<TimedCommandPanel equipment={gate()} onUpdated={() => {}} />);

    await userEvent.click(screen.getByRole("checkbox"));

    expect(await screen.findByText("TimedCommandNotEligible")).toBeTruthy();
  });

  // ── Spec 178 — the ladder ──────────────────────────────────

  describe("the ladder (spec 178)", () => {
    const configured = () =>
      gate({
        timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
      });

    it("is off until it is asked for, and proposes 15/30/60 from a quarter-hour", async () => {
      render(<TimedCommandPanel equipment={configured()} onUpdated={() => {}} />);

      const ladder = screen.getByRole("checkbox", {
        name: "Steps: each press asks for longer",
      }) as HTMLInputElement;
      expect(ladder.checked).toBe(false);

      await userEvent.click(ladder);

      expect(api.updateEquipment).toHaveBeenCalledWith("g1", {
        timedCommand: expect.objectContaining({
          durationStepsMs: [900_000, 1_800_000, 3_600_000],
          durationMs: 900_000,
        }),
      });
    });

    it("keeps the duration select from claiming what the first rung already says", () => {
      const laddered = gate({
        timedCommand: {
          alias: "command",
          value: null,
          revertValue: null,
          durationMs: 900_000,
          durationStepsMs: [900_000, 1_800_000],
        },
      });
      render(<TimedCommandPanel equipment={laddered} onUpdated={() => {}} />);

      const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
      expect(selects[selects.length - 1].disabled).toBe(true);
    });

    it("adds a rung, keeping the ladder sorted and the duration on its first", async () => {
      const laddered = gate({
        timedCommand: {
          alias: "command",
          value: null,
          revertValue: null,
          durationMs: 900_000,
          durationStepsMs: [900_000, 1_800_000],
        },
      });
      render(<TimedCommandPanel equipment={laddered} onUpdated={() => {}} />);

      // A shorter rung than any configured: it must land FIRST, and drag the
      // duration with it, or the tile would announce a length nothing arms.
      // Exact: a regex would also match the "15 min" rung already on the ladder.
      await userEvent.click(screen.getByRole("button", { name: "5 min" }));

      expect(api.updateEquipment).toHaveBeenCalledWith("g1", {
        timedCommand: expect.objectContaining({
          durationStepsMs: [300_000, 900_000, 1_800_000],
          durationMs: 300_000,
        }),
      });
    });

    it("refuses to drop below two rungs", async () => {
      const laddered = gate({
        timedCommand: {
          alias: "command",
          value: null,
          revertValue: null,
          durationMs: 900_000,
          durationStepsMs: [900_000, 1_800_000],
        },
      });
      render(<TimedCommandPanel equipment={laddered} onUpdated={() => {}} />);

      // One rung means the SECOND press walks off the top and stops the
      // countdown — a foot-gun on a gate, refused here as well as by the API.
      await userEvent.click(screen.getByRole("button", { name: /30 min/ }));
      expect(api.updateEquipment).not.toHaveBeenCalled();
    });
  });
});
