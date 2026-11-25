import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { HeaterControl } from "./HeaterControl";
import type { EquipmentWithDetails } from "../../types";

// Spec 216 — one equipment, two wirings.

function heater(over: object = {}): EquipmentWithDetails {
  return {
    id: "h-1",
    name: "Radiateur",
    type: "heater",
    zoneId: "z-1",
    enabled: true,
    createdAt: "",
    updatedAt: "",
    status: "online",
    ...over,
  } as unknown as EquipmentWithDetails;
}

const pilot = (value: unknown, over: object = {}) =>
  heater({
    dataBindings: [
      { id: "d-0", alias: "state", category: "light_state", value: false },
      { id: "d-1", alias: "wire", category: "pilot_wire_mode", value },
    ],
    orderBindings: [
      { id: "o-0", alias: "state", category: "light_toggle", type: "boolean" },
      {
        id: "o-1",
        alias: "wire",
        category: "set_pilot_wire_mode",
        type: "enum",
        enumValues: ["comfort", "eco", "frost_protection", "off"],
      },
    ],
    ...over,
  });

describe("HeaterControl — pilot wire", () => {
  it("offers the declared modes, marks the current one, sends under the bound alias", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<HeaterControl equipment={pilot("eco")} onExecuteOrder={send} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Eco" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Frost protection" }));
    expect(send).toHaveBeenCalledWith("wire", "frost_protection");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows an unknown mode as unknown, not comfort", () => {
    render(<HeaterControl equipment={pilot(null)} onExecuteOrder={vi.fn()} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    for (const b of screen.getAllByRole("button")) {
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("offers no command when disabled", () => {
    render(<HeaterControl equipment={pilot("eco", { enabled: false })} onExecuteOrder={vi.fn()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Eco")).toBeTruthy();
  });

  it("selects a mode from the compact row", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<HeaterControl equipment={pilot("eco")} onExecuteOrder={send} compact />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "off");
    expect(send).toHaveBeenCalledWith("wire", "off");
  });
});

describe("HeaterControl — relay", () => {
  it.each([
    [false, /Switch to eco/, "ON"],
    [true, /Switch to comfort/, "OFF"],
  ])("keeps its Comfort / Eco toggle: relay %s", async (value, name, sent) => {
    const send = vi.fn().mockResolvedValue(undefined);
    const relay = heater({
      dataBindings: [{ id: "d", alias: "state", category: "light_state", value }],
      orderBindings: [{ id: "o", alias: "state", category: "light_toggle", type: "boolean" }],
    });
    render(<HeaterControl equipment={relay} onExecuteOrder={send} />);
    await userEvent.click(screen.getByRole("button", { name }));
    expect(send).toHaveBeenCalledWith("state", sent);
  });
});
