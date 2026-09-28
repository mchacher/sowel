import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { LightControl } from "./LightControl";
import type { EquipmentWithDetails } from "../../types";

// Issue #933 — the slider and the percentage follow the range the dimmer's
// order declares; Zigbee's 0–254 is only the fallback.

function dimmer(brightness: number, order: { min?: number; max?: number }): EquipmentWithDetails {
  return {
    id: "l-1",
    name: "Variateur",
    zoneId: "z-1",
    type: "light_dimmable",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [
      { id: "b-s", alias: "state", category: "light_state", type: "boolean", value: true },
      { id: "b-b", alias: "brightness", category: "light_brightness", type: "number", value: brightness },
    ],
    orderBindings: [
      { id: "o-b", alias: "brightness", category: "set_brightness", type: "number", ...order },
    ],
  } as unknown as EquipmentWithDetails;
}

const noop = async () => {};

describe("LightControl — declared brightness range (#933)", () => {
  it("a 0–100 dimmer at full brightness reads 100 % on a 0–100 slider", () => {
    render(<LightControl equipment={dimmer(100, { min: 0, max: 100 })} onExecuteOrder={noop} />);

    expect(screen.getByText("100%")).toBeTruthy();
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("max")).toBe("100");
  });

  it("keeps the Zigbee 0–254 scale when the order declares none", () => {
    render(<LightControl equipment={dimmer(127, {})} onExecuteOrder={noop} />);

    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByRole("slider").getAttribute("max")).toBe("254");
  });
});
