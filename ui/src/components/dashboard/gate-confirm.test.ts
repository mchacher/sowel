import { describe, it, expect } from "vitest";
import { gateNeedsConfirm } from "./gate-confirm";
import type { EquipmentWithDetails } from "../../types";

/** Minimal EquipmentWithDetails fixture for the guard decision. */
function equip(
  over: Partial<EquipmentWithDetails> & {
    command?: { category?: string; enumValues?: string[] } | null;
  },
): EquipmentWithDetails {
  const { command, ...rest } = over;
  const orderBindings =
    command === null
      ? []
      : [
          {
            alias: "command",
            category: command?.category ?? "gate_trigger",
            enumValues: command?.enumValues,
          },
        ];
  return {
    id: "e1",
    name: "Portail",
    type: "gate",
    zoneId: "z1",
    enabled: true,
    createdAt: "",
    updatedAt: "",
    status: "online",
    dataBindings: [],
    orderBindings,
    ...rest,
  } as unknown as EquipmentWithDetails;
}

describe("gateNeedsConfirm", () => {
  it("is true for a gate with the flag on and a single-action command", () => {
    expect(gateNeedsConfirm(equip({ requireConfirmation: true }))).toBe(true);
  });

  it("is true for a single-enum command", () => {
    expect(
      gateNeedsConfirm(equip({ requireConfirmation: true, command: { enumValues: ["OPEN"] } })),
    ).toBe(true);
  });

  it("is false for a multi-action gate (not guarded in v1)", () => {
    expect(
      gateNeedsConfirm(
        equip({ requireConfirmation: true, command: { enumValues: ["OPEN", "CLOSE", "STOP"] } }),
      ),
    ).toBe(false);
  });

  it("is false when the flag is off", () => {
    expect(gateNeedsConfirm(equip({ requireConfirmation: false }))).toBe(false);
    expect(gateNeedsConfirm(equip({}))).toBe(false);
  });

  it("is false when there is no command binding", () => {
    expect(gateNeedsConfirm(equip({ requireConfirmation: true, command: null }))).toBe(false);
  });

  it("is false for a non-gate equipment even with the flag on", () => {
    expect(gateNeedsConfirm(equip({ requireConfirmation: true, type: "switch" }))).toBe(false);
  });
});
