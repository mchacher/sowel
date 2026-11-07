/**
 * Spec 196 (slice P) — gate confirmation on every path.
 *
 * When the admin turned on « Confirmation avant action » for a gate, every UI path
 * where one press actuates it asks first: the slide sheet on a touch screen, a
 * two-button dialog with a pointer. No order leaves before the confirmation; an
 * unguarded gate acts straight away. The hook is pinned first, then each surface
 * that goes through it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, mockPointer, render, screen, userEvent, within } from "../test-utils";
import { useGuardedAction } from "./useGuardedAction";
import { EquipmentWidget } from "../components/dashboard/EquipmentWidget";
import { EquipmentDetailSheet } from "../components/dashboard/WidgetDetailSheet";
import { TimedEquipmentWidget } from "../components/dashboard/TimedEquipmentWidget";
import { GateControl } from "../components/equipments/GateControl";
import { TimedCommandControl } from "../components/equipments/TimedCommandControl";
import * as api from "../api";
import type { DashboardWidget, EquipmentWithDetails } from "../types";

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  armTimedCommand: vi.fn().mockResolvedValue({}),
  cancelTimedCommand: vi.fn().mockResolvedValue(undefined),
  getEquipments: vi.fn().mockResolvedValue([]),
}));

function gate(
  over: Partial<EquipmentWithDetails> & { state?: string | null; enumValues?: string[] } = {},
): EquipmentWithDetails {
  const { state = "closed", enumValues, ...rest } = over;
  return {
    id: "g1",
    name: "Portail",
    zoneId: "z1",
    type: "gate",
    enabled: true,
    requireConfirmation: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings:
      state === null ? [] : [{ id: "d1", alias: "contact", category: "gate_state", value: state }],
    orderBindings: [{ id: "o1", alias: "relay", category: "gate_trigger", enumValues }],
    ...rest,
  } as unknown as EquipmentWithDetails;
}

const WIDGET = {
  id: "w1",
  type: "equipment",
  equipmentId: "g1",
  displayOrder: 0,
  createdAt: "",
  updatedAt: "",
} as unknown as DashboardWidget;

/** Drag the slide knob its full travel on a 260 px track. */
function slide(label: string) {
  const knob = screen.getByRole("button", { name: label });
  fireEvent.pointerDown(knob, { pointerId: 1, clientX: 0 });
  fireEvent.pointerMove(knob, { pointerId: 1, clientX: 260 - 58 });
}

let restorePointer: () => void = () => {};
let widthSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  // jsdom lays nothing out; the slide track needs a width to have a travel.
  widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(260);
});
afterEach(() => {
  restorePointer();
  widthSpy.mockRestore();
});

function Harness({ equipment, run }: { equipment: EquipmentWithDetails; run: () => void }) {
  const { guardGate, element } = useGuardedAction();
  return (
    <>
      <button onClick={() => guardGate(equipment, null, run)}>press</button>
      {element}
    </>
  );
}

describe("useGuardedAction", () => {
  it("asks in a two-button dialog with a fine pointer, and sends nothing before the confirm", async () => {
    restorePointer = mockPointer("fine");
    const run = vi.fn();
    render(<Harness equipment={gate({ state: "open" })} run={run} />);

    await userEvent.click(screen.getByText("press"));

    expect(screen.getByRole("alertdialog", { name: "Close Portail?" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Slide to close" })).toBeNull();
    expect(run).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks with the slide sheet with a coarse pointer, and sends on the slide only", async () => {
    restorePointer = mockPointer("coarse");
    const run = vi.fn();
    render(<Harness equipment={gate({ state: "closed" })} run={run} />);

    await userEvent.click(screen.getByText("press"));

    expect(screen.getByText("Open Portail?")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(run).not.toHaveBeenCalled();

    slide("Slide to open");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the dialog is cancelled", async () => {
    restorePointer = mockPointer("fine");
    const run = vi.fn();
    render(<Harness equipment={gate()} run={run} />);

    await userEvent.click(screen.getByText("press"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("closes on Escape pressed on the focused button, through the wrapper that stops the clicks", async () => {
    restorePointer = mockPointer("fine");
    const run = vi.fn();
    render(<Harness equipment={gate({ state: "open" })} run={run} />);

    await userEvent.click(screen.getByText("press"));
    const primary = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(primary);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("gives the focus back to the button that opened it", async () => {
    restorePointer = mockPointer("fine");
    render(<Harness equipment={gate()} run={vi.fn()} />);

    await userEvent.click(screen.getByText("press"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(screen.getByText("press"));
  });

  it("sends straight away on a gate that does not ask", async () => {
    restorePointer = mockPointer("fine");
    const run = vi.fn();
    render(<Harness equipment={gate({ requireConfirmation: false })} run={run} />);

    await userEvent.click(screen.getByText("press"));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("every path through the guard", () => {
  beforeEach(() => {
    restorePointer = mockPointer("fine");
  });

  it("desktop tile: the card click asks, then sends the impulse", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(<EquipmentWidget widget={WIDGET} equipment={gate()} onExecuteOrder={onExecuteOrder} />);

    await userEvent.click(screen.getByText("Portail"));
    expect(screen.getByRole("alertdialog", { name: "Open Portail?" })).toBeTruthy();
    expect(onExecuteOrder).not.toHaveBeenCalled();

    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Open" }),
    );
    expect(onExecuteOrder).toHaveBeenCalledTimes(1);
    expect(onExecuteOrder).toHaveBeenCalledWith("g1", "relay", null);
  });

  it("desktop tile, several actions: the dialog names the button pressed", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <EquipmentWidget
        widget={WIDGET}
        equipment={gate({ state: "closed", enumValues: ["OPEN", "CLOSE", "STOP"] })}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("alertdialog", { name: "Close Portail?" })).toBeTruthy();
    expect(onExecuteOrder).not.toHaveBeenCalled();

    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Close" }),
    );
    expect(onExecuteOrder).toHaveBeenCalledWith("g1", "relay", "CLOSE");
  });

  it("desktop tile, several actions: STOP never asks, it leaves at once", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <EquipmentWidget
        widget={WIDGET}
        equipment={gate({ state: "open", enumValues: ["OPEN", "CLOSE", "STOP"] })}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onExecuteOrder).toHaveBeenCalledWith("g1", "relay", "STOP");
  });

  it("mobile detail sheet of a multi-action gate: a button asks with the slide on touch", async () => {
    restorePointer();
    restorePointer = mockPointer("coarse");
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <EquipmentDetailSheet
        widget={WIDGET}
        equipment={gate({ enumValues: ["OPEN", "CLOSE"] })}
        onExecuteOrder={onExecuteOrder}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Open Portail?")).toBeTruthy();
    expect(onExecuteOrder).not.toHaveBeenCalled();

    slide("Slide to open");
    expect(onExecuteOrder).toHaveBeenCalledWith("g1", "relay", "OPEN");
  });

  it("Maison row: the compact button asks, and the click stays out of the row", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <GateControl equipment={gate()} onExecuteOrder={onExecuteOrder} compact />
      </div>,
    );

    await userEvent.click(screen.getByTitle("Command"));
    expect(screen.getByRole("alertdialog", { name: "Open Portail?" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onExecuteOrder).toHaveBeenCalledWith("relay", null);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("equipment page: the command button asks before it sends", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(<GateControl equipment={gate({ state: null })} onExecuteOrder={onExecuteOrder} />);

    await userEvent.click(screen.getByRole("button", { name: /Command/ }));
    expect(screen.getByRole("alertdialog", { name: "Operate Portail?" })).toBeTruthy();
    expect(onExecuteOrder).not.toHaveBeenCalled();
  });

  it("timed tile: arming asks first, nothing is armed before the confirm", async () => {
    const timed = gate({
      timedCommand: { alias: "relay", value: null, revertValue: null, durationMs: 900_000 },
    });
    render(<TimedEquipmentWidget label="Portail" equipment={timed} />);

    await userEvent.click(screen.getByTitle(/Run for/i));
    expect(screen.getByRole("alertdialog", { name: "Open Portail?" })).toBeTruthy();
    expect(api.armTimedCommand).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Open" }),
      );
    });
    expect(api.armTimedCommand).toHaveBeenCalledWith("g1");
  });

  it("timed tile: the phone corner shows the shield on a guarded gate, power otherwise", () => {
    const timedCommand = { alias: "relay", value: null, revertValue: null, durationMs: 900_000 };
    const { container, rerender } = render(
      <TimedEquipmentWidget label="Portail" equipment={gate({ timedCommand })} />,
    );
    expect(container.querySelector("[data-tap-glyph]")?.getAttribute("data-tap-glyph")).toBe(
      "shield",
    );

    rerender(
      <TimedEquipmentWidget
        label="Portail"
        equipment={gate({ timedCommand, requireConfirmation: false })}
      />,
    );
    expect(container.querySelector("[data-tap-glyph]")?.getAttribute("data-tap-glyph")).toBe(
      "power",
    );
  });

  it("timed control (Maison row, equipment page): arming asks, cancelling does not", async () => {
    const timed = gate({
      timedCommand: { alias: "relay", value: null, revertValue: null, durationMs: 900_000 },
    });
    const { rerender } = render(<TimedCommandControl equipment={timed} labelled />);

    await userEvent.click(screen.getByRole("button", { name: /Run for/i }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(api.armTimedCommand).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const running = {
      ...timed,
      timedAction: {
        alias: "relay",
        value: null,
        revertValue: null,
        armedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        stepIndex: 0,
        nextDurationMs: null,
      },
    } as unknown as EquipmentWithDetails;
    rerender(<TimedCommandControl equipment={running} labelled />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /End it now/ }));
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.cancelTimedCommand).toHaveBeenCalledWith("g1", true);
  });
});
