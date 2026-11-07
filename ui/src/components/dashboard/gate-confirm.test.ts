import { describe, it, expect } from "vitest";
import i18n from "../../i18n";
import {
  gateActionOf,
  gateConfirmTexts,
  gateNeedsConfirm,
  gatePrompt,
  gateStateOf,
  gateValueLabel,
} from "./gate-confirm";
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

  // Spec 196 — the buttons of a multi-action gate actuate on one press too.
  it("is true for a multi-action gate (spec 196; spec 146 v1 left it out)", () => {
    expect(
      gateNeedsConfirm(
        equip({ requireConfirmation: true, command: { enumValues: ["OPEN", "CLOSE", "STOP"] } }),
      ),
    ).toBe(true);
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
    const withState = (value: unknown) =>
      equip({
        dataBindings: [{ alias: "state", category: "gate_state", value }],
      } as unknown as Partial<EquipmentWithDetails>);
    await i18n.changeLanguage("fr");
    try {
      expect(gatePrompt(withState("open"), null, t)).toMatchObject({
        title: "Fermer Portail\u202f?",
        subtitle: "Ouvert",
        slideLabel: "Glisser pour fermer",
        confirmLabel: "Fermer",
      });
      expect(gatePrompt(withState("closed"), null, t, "Entrée")).toMatchObject({
        title: "Ouvrir Portail\u202f?",
        subtitle: "Entrée · Fermé",
        slideLabel: "Glisser pour ouvrir",
        confirmLabel: "Ouvrir",
      });
      expect(gatePrompt(withState(null), null, t)).toMatchObject({
        title: "Actionner Portail\u202f?",
        subtitle: "État inconnu",
        confirmLabel: "Actionner",
      });
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("names the button pressed on a multi-action gate, whatever the state", () => {
    expect(gateActionOf("OPEN", "open")).toBe("open");
    expect(gateActionOf("close", "closed")).toBe("close");
    expect(gateActionOf("STOP", "unknown")).toBe("stop");
    expect(gateActionOf("PEDESTRIAN", "closed")).toBe("operate");
    expect(gateConfirmTexts("stop", "Portail", t)).toEqual({
      title: "Stop Portail?",
      slideLabel: "Slide to stop",
      confirmLabel: "Stop",
    });
  });

  it("labels the buttons in words, keeping a value it has no word for", async () => {
    await i18n.changeLanguage("fr");
    try {
      expect(["OPEN", "CLOSE", "STOP", "PEDESTRIAN"].map((v) => gateValueLabel(v, t))).toEqual([
        "Ouvrir",
        "Fermer",
        "Arrêter",
        "PEDESTRIAN",
      ]);
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
