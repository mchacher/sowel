/**
 * Spec 171 split this sheet in two: a presentational shell any widget can word
 * for itself, and the spec 146 gate wrapper that used to BE the component.
 * These pin the wrapper's wording, which is the part a refactor can silently
 * lose, plus the shell's one behaviour — confirm, then dismiss on a delay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "../../test-utils";
import { ConfirmActionSheet, GateConfirmSheet } from "./ConfirmActionSheet";
import type { EquipmentWithDetails } from "../../types";

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
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(260);
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

  it("falls back to the unknown state when the gate has no state binding", () => {
    render(
      <GateConfirmSheet
        equipment={makeGate(null)}
        zoneName="Entrée"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // No binding reads as `unknown`, which this gate's vocabulary calls Moving.
    expect(screen.getByText("Entrée · Moving")).toBeTruthy();
  });
});
