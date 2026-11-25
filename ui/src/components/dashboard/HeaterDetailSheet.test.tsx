import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, userEvent } from "../../test-utils";
import { EquipmentDetailSheet } from "./WidgetDetailSheet";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";

// Spec 217 — the sheet a heater tile opens.

function open(data: object[], orders: object[]) {
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <EquipmentDetailSheet
        widget={{ id: "w", type: "equipment", equipmentId: "h" } as DashboardWidget}
        equipment={
          {
            id: "h",
            name: "Radiateur",
            zoneId: "z",
            type: "heater",
            enabled: true,
            status: "online",
            dataBindings: data,
            orderBindings: orders,
          } as unknown as EquipmentWithDetails
        }
        onExecuteOrder={send}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
  return send;
}
const state = (value: boolean) => ({ id: "s", alias: "state", category: "light_state", value });
const toggle = { id: "t", alias: "state", category: "light_toggle", type: "boolean" };

describe("heater sheet", () => {
  it("pilot: the mode buttons, no relay toggle even with a state bound", async () => {
    const send = open(
      [state(false), { id: "m", alias: "wire", category: "pilot_wire_mode", value: "eco" }],
      [toggle, { id: "o", alias: "wire", category: "set_pilot_wire_mode", type: "enum" }],
    );
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Off" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0].slice(-2)).toEqual(["wire", "off"]);
  });

  it.each([
    [false, "ON"],
    [true, "OFF"],
  ])("relay %s: the toggle sends %s", async (value, sent) => {
    const send = open([state(value)], [toggle]);
    await userEvent.click(screen.getByRole("button", { name: /Switch to/ }));
    expect(send.mock.calls[0].slice(-2)).toEqual(["state", sent]);
  });
});
