import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { HeaterControl } from "./HeaterControl";
import type { EquipmentWithDetails } from "../../types";

// Spec 217 — one equipment, two wirings.

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

// #1331 — a relay Sowel has no reading of is unknown, never comfort.
describe("HeaterControl — relay without a reading", () => {
  const relay = (value: unknown) =>
    heater({
      dataBindings: [{ id: "d-0", alias: "state", category: "light_state", value }],
      orderBindings: [
        {
          id: "o-0",
          alias: "state",
          category: "light_toggle",
          type: "enum",
          enumValues: ["ON", "OFF"],
        },
      ],
    });

  it("shows Unknown and offers comfort and eco explicitly", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<HeaterControl equipment={relay(null)} onExecuteOrder={send} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Comfort/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Eco/ }));
    expect(send).toHaveBeenCalledWith("state", "ON");
  });

  it("compact: shows Unknown and a tap puts the heater in comfort (relay OFF)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<HeaterControl equipment={relay(null)} onExecuteOrder={send} compact />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Switch to comfort" }));
    expect(send).toHaveBeenCalledWith("state", "OFF");
  });

  it("compact: still toggles a known relay both ways", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <HeaterControl equipment={relay("OFF")} onExecuteOrder={send} compact />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Switch to eco" }));
    expect(send).toHaveBeenLastCalledWith("state", "ON");
    unmount();
    render(<HeaterControl equipment={relay("ON")} onExecuteOrder={send} compact />);
    await userEvent.click(screen.getByRole("button", { name: "Switch to comfort" }));
    expect(send).toHaveBeenLastCalledWith("state", "OFF");
  });
});
