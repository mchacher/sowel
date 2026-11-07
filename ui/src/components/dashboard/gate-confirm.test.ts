import { describe, it, expect } from "vitest";
import i18n from "../../i18n";
import { gateConfirmTexts, gateNeedsConfirm, gateStateOf } from "./gate-confirm";
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

// Spec 196 — the confirmation follows the state it reads: an open gate is about to
// close, a closed one to open, and a gate Sowel cannot see reads « État inconnu »,
// never « En mouvement ».
describe("gateConfirmTexts", () => {
  const t = i18n.t.bind(i18n);

  it("says what the tap will do from each state, in French", async () => {
    await i18n.changeLanguage("fr");
    try {
      expect(gateConfirmTexts("open", "Portail", t)).toEqual({
        title: "Fermer Portail\u202f?",
        slideLabel: "Glisser pour fermer",
      });
      expect(gateConfirmTexts("closed", "Portail", t)).toEqual({
        title: "Ouvrir Portail\u202f?",
        slideLabel: "Glisser pour ouvrir",
      });
      expect(gateConfirmTexts("unknown", "Portail", t).title).toBe("Actionner Portail\u202f?");
      expect(t("controls.gate.unknown")).toBe("État inconnu");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("reads the state by category, and anything but open/closed as unknown", () => {
    const withState = (value: unknown) =>
      equip({
        dataBindings: [{ alias: "contact", category: "gate_state", value }],
      } as unknown as Partial<EquipmentWithDetails>);
    expect(gateStateOf(withState("open"))).toBe("open");
    expect(gateStateOf(withState("closed"))).toBe("closed");
    expect(gateStateOf(withState(null))).toBe("unknown");
    expect(gateStateOf(equip({}))).toBe("unknown");
  });
});
