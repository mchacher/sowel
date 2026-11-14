import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { ZoneEquipmentsView } from "./ZoneEquipmentsView";
import type { EquipmentType, EquipmentWithDetails } from "../../types";

// Spec 208 — the Maison view groups equipments by family, in FR1 order, each
// family section titled in its ink.

function eq(id: string, type: EquipmentType, over: Partial<EquipmentWithDetails> = {}) {
  return {
    id,
    name: id,
    zoneId: "z-1",
    type,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [],
    orderBindings: [],
    ...over,
  } as EquipmentWithDetails;
}

function renderView(equipments: EquipmentWithDetails[]) {
  return render(
    <MemoryRouter>
      <ZoneEquipmentsView zoneName="Bureau" equipments={equipments} onExecuteOrder={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("ZoneEquipmentsView (spec 208)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("fr");
  });

  it("shows one section per family or neutral section, in order", () => {
    renderView([
      eq("Bouton", "button"),
      eq("PIR", "sensor"),
      eq("Radiateur prise", "switch", { family: "climate" }),
      eq("Portail", "gate"),
      eq("Volet", "shutter"),
      eq("Spots", "light_onoff"),
    ]);
    const titles = screen
      .getAllByText(/^(Éclairages|Ouvrants|Climat|Capteurs|Commandes|Prises|Autres)$/)
      .map((el) => el.textContent);
    expect(titles).toEqual(["Éclairages", "Ouvrants", "Climat", "Capteurs", "Commandes"]);
  });

  it("titles a family section in its ink and a neutral one in text colour", () => {
    renderView([eq("Volet", "shutter"), eq("Bouton", "button")]);
    expect(screen.getByText("Ouvrants").className).toContain("text-fam-openings-ink");
    expect(screen.getByText("Commandes").className).toContain("text-text");
  });

  it("puts a switch without a family with the plugs", () => {
    renderView([eq("Routeur", "switch")]);
    expect(screen.getByText("Prises")).toBeTruthy();
  });
});
