import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { InvertDirectionPanel } from "./InvertDirectionPanel";
import * as api from "../../api";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  updateEquipment: vi.fn().mockResolvedValue(undefined),
}));

function equipment(
  invertDirection?: boolean,
  type: EquipmentWithDetails["type"] = "awning",
): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Store",
    zoneId: "z-1",
    type,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    invertDirection,
    dataBindings: [],
    orderBindings: [],
    status: "online",
  };
}

describe("InvertDirectionPanel (#614)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void i18n.changeLanguage("en");
  });

  it("reflects the current flag and persists a toggle", async () => {
    const onUpdated = vi.fn();
    render(<InvertDirectionPanel equipment={equipment(false)} onUpdated={onUpdated} />);

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);

    expect(api.updateEquipment).toHaveBeenCalledWith("eq-1", { invertDirection: true });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("shows the toggle as on when the equipment is inverted", () => {
    render(<InvertDirectionPanel equipment={equipment(true)} onUpdated={() => {}} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  // Issue #627 — extended to gate equipments (boolean momentary trigger),
  // with copy that talks about a trigger command rather than open/close.
  it("shows the gate-specific copy for a gate equipment", () => {
    render(<InvertDirectionPanel equipment={equipment(false, "gate")} onUpdated={() => {}} />);
    expect(screen.getByText("Invert trigger command")).toBeTruthy();
    expect(screen.queryByText("Invert open/close direction")).toBeNull();
  });

  it("shows the shutter-specific copy for a non-gate equipment", () => {
    render(<InvertDirectionPanel equipment={equipment(false, "awning")} onUpdated={() => {}} />);
    expect(screen.getByText("Invert open/close direction")).toBeTruthy();
    expect(screen.queryByText("Invert trigger command")).toBeNull();
  });

  it("persists a toggle for a gate equipment the same way as a shutter", async () => {
    const onUpdated = vi.fn();
    render(
      <InvertDirectionPanel equipment={equipment(false, "gate")} onUpdated={onUpdated} />,
    );
    await userEvent.click(screen.getByRole("checkbox"));
    expect(api.updateEquipment).toHaveBeenCalledWith("eq-1", { invertDirection: true });
    expect(onUpdated).toHaveBeenCalled();
  });
});
