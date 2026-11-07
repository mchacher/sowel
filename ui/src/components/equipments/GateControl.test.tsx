import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { GateControl } from "./GateControl";
import type { EquipmentWithDetails } from "../../types";

// Spec 196 — the Maison row and the equipment page found the command by its alias
// `command` only, while the dashboard resolves it by category: a gate bound under
// another alias had a button on the dashboard and none here.

function gate(state: string | null): EquipmentWithDetails {
  return {
    id: "g-1",
    name: "Portail",
    type: "gate",
    zoneId: "z-1",
    enabled: true,
    createdAt: "",
    updatedAt: "",
    status: "online",
    dataBindings:
      state === null ? [] : [{ id: "d-1", alias: "contact", category: "gate_state", value: state }],
    orderBindings: [{ id: "o-1", alias: "relay", category: "gate_trigger" }],
  } as unknown as EquipmentWithDetails;
}

describe("GateControl", () => {
  it("finds the command by category and sends it under its own alias", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(<GateControl equipment={gate("open")} onExecuteOrder={onExecuteOrder} />);

    expect(screen.getByText("Open")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Command/ }));
    expect(onExecuteOrder).toHaveBeenCalledWith("relay", null);
  });

  it("reads « Unknown state » without a sensor, not « Moving »", () => {
    render(<GateControl equipment={gate(null)} onExecuteOrder={vi.fn()} compact />);
    expect(screen.getByText("Unknown state")).toBeTruthy();
    expect(screen.queryByText("Moving")).toBeNull();
  });
});
