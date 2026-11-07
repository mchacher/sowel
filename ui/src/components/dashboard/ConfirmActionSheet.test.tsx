/**
 * Spec 171 split this sheet in two: a presentational shell any widget can word
 * for itself, and the spec 146 gate wrapper that used to BE the component.
 * These pin the wrapper's wording, which is the part a refactor can silently
 * lose, plus the shell's one behaviour — confirm, then dismiss on a delay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createEvent, fireEvent, render, screen } from "../../test-utils";
import { useTranslation } from "react-i18next";
import { ConfirmActionDialog, ConfirmActionSheet } from "./ConfirmActionSheet";
import { gatePrompt } from "./gate-confirm";
import type { EquipmentWithDetails } from "../../types";

/** The sheet as `useGuardedAction` words it for a gate (spec 146, spec 196). */
function GateConfirmSheet({
  equipment,
  zoneName,
  value = null,
  onConfirm,
  onClose,
}: {
  equipment: EquipmentWithDetails;
  zoneName?: string;
  value?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const prompt = gatePrompt(equipment, value, t, zoneName);
  return (
    <ConfirmActionSheet
      title={prompt.title}
      subtitle={prompt.subtitle}
      slideLabel={prompt.slideLabel}
      confirmedLabel={prompt.confirmedLabel}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

function makeGate(gateState: string | null = "closed"): EquipmentWithDetails {
  return {
    id: "eq-gate",
    name: "Portail",
    zoneId: "z-1",
    type: "gate",
    enabled: true,
    requireConfirmation: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: (gateState === null
      ? []
      : [
          {
            id: "db-1",
            equipmentId: "eq-gate",
            deviceDataId: "dd-1",
            alias: "state",
            deviceId: "dev-1",
            deviceName: "Portail",
            key: "state",
            type: "text",
            category: "gate_state",
            value: gateState,
            lastUpdated: "2026-01-01T00:00:00Z",
            lastChanged: "2026-01-01T00:00:00Z",
            stale: false,
          },
        ]) as EquipmentWithDetails["dataBindings"],
    orderBindings: [] as EquipmentWithDetails["orderBindings"],
  } as EquipmentWithDetails;
}

describe("ConfirmActionSheet", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dismisses itself a beat after the slide, so the green state is seen", () => {
    const widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(260);
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmActionSheet
        title="Switch to “Livreur”?"
        subtitle="Portail livreur · Prêt"
        slideLabel="Slide to confirm"
        confirmedLabel="Sent"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Portail livreur · Prêt")).toBeTruthy();

    const knob = screen.getByRole("button", { name: "Slide to confirm" });
    fireEvent.pointerDown(knob, { pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientX: 202 });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(500));
    expect(onClose).toHaveBeenCalledTimes(1);
    widthSpy.mockRestore();
  });

  it("keeps the spec 146 gate wording: name, zone and the state it reads", () => {
    render(
      <GateConfirmSheet
        equipment={makeGate("closed")}
        zoneName="Entrée"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Open Portail?")).toBeTruthy();
    expect(screen.getByText(/Entrée/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Slide to open" })).toBeTruthy();
  });

  // Issue #858 tuned these on a real phone: the slide sits in the thumb's arc
  // because the stack is padded and the cancel is a real button rather than a
  // text link. The spec 171 extraction reverted both while every wording test
  // stayed green, so the dimensions are pinned here too.
  it("keeps the #858 spacing: a padded stack and a real cancel button", () => {
    render(
      <ConfirmActionSheet
        title="Switch to “Livreur”?"
        slideLabel="Slide to confirm"
        confirmedLabel="Sent"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // The sheet is portaled to the body, so it is not under the container.
    const stack = document.body.querySelector(".flex.flex-col.gap-6");
    expect(stack).toBeTruthy();
    expect(stack?.className).toContain("pb-8");

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.className).toContain("w-[150px]");
    expect(cancel.className).toContain("border");
  });

  it("falls back to the unknown state when the gate has no state binding", () => {
    render(
      <GateConfirmSheet
        equipment={makeGate(null)}
        zoneName="Entrée"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // No binding reads as `unknown`: Sowel cannot see the gate, so it does not
    // claim it is moving (spec 196), and the tap only « operates » it.
    expect(screen.getByText("Entrée · Unknown state")).toBeTruthy();
    expect(screen.getByText("Operate Portail?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Slide to operate" })).toBeTruthy();
  });

  // Spec 196 — the sheet said « Ouvrir » even on an open gate.
  it("asks to close a gate that reads open", () => {
    render(
      <GateConfirmSheet
        equipment={makeGate("open")}
        zoneName="Entrée"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Close Portail?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Slide to close" })).toBeTruthy();
  });

  // Spec 196 — a multi-action gate names the button pressed, not the state.
  it("names the action of a multi-action button, and a raw value it has no word for", () => {
    const { unmount } = render(
      <GateConfirmSheet
        equipment={makeGate("open")}
        value="STOP"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Stop Portail?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Slide to stop" })).toBeTruthy();
    unmount();

    render(
      <GateConfirmSheet
        equipment={makeGate("closed")}
        value="PEDESTRIAN"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Operate Portail?")).toBeTruthy();
    expect(screen.getByText("PEDESTRIAN · Closed")).toBeTruthy();
  });
});

// Spec 196 — the pointer form of the same question: two buttons, Enter confirms
// (the primary button holds the focus), Escape and the backdrop cancel.
describe("ConfirmActionDialog", () => {
  function open() {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmActionDialog
        title="Close Portail?"
        subtitle="Closed"
        confirmLabel="Close"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    return { onConfirm, onClose };
  }

  it("confirms on its primary button, which holds the focus", () => {
    const { onConfirm, onClose } = open();
    const primary = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(primary);
    fireEvent.click(primary);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels on Cancel without confirming", () => {
    const { onConfirm, onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on Escape pressed where the focus is, inside the dialog", () => {
    const { onConfirm, onClose } = open();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("is described by its subtitle", () => {
    open();
    const dialog = screen.getByRole("alertdialog", { description: "Closed" });
    expect(dialog).toBeTruthy();
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    open();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const primary = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(primary);
    fireEvent.keyDown(primary, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(primary);
  });

  it("gives the focus back to what opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <ConfirmActionDialog
        title="Close Portail?"
        confirmLabel="Close"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("is not confirmed by the second click of a double click, nor by a held Enter", () => {
    const { onConfirm } = open();
    const primary = screen.getByRole("button", { name: "Close" });
    fireEvent.click(primary, { detail: 2 });
    expect(onConfirm).not.toHaveBeenCalled();
    const held = createEvent.keyDown(primary, { key: "Enter", repeat: true });
    fireEvent(primary, held);
    expect(held.defaultPrevented).toBe(true);
    const fresh = createEvent.keyDown(primary, { key: "Enter" });
    fireEvent(primary, fresh);
    expect(fresh.defaultPrevented).toBe(false);
  });
});
