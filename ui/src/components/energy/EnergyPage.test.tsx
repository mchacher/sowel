import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { EnergyPage } from "./EnergyPage";
import { useEnergy } from "../../store/useEnergy";
import { useUiState } from "../../store/useUiState";
import { localDateStr } from "../../lib/local-date";
import * as api from "../../api";
import type { EnergyHistoryResponse } from "../../types";

// Spec 197 (FR-E6.1) — the Consumption card opens on its total, in Wh or in €.

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getEquipments: vi.fn(),
  getEnergyByUsage: vi.fn(),
}));

function setup(unit: "wh" | "eur"): void {
  useEnergy.setState({
    history: {
      period: "day",
      from: "",
      to: "",
      resolution: "1h",
      points: [],
      totals: {
        total_consumption: 9050,
        total_hp: 7080,
        total_hc: 1970,
        total_production: 60,
        total_autoconso: 60,
        total_injection: 0,
        cost_hp: 1.47,
        cost_hc: 0.31,
        cost_total: 1.78,
      },
    } satisfies EnergyHistoryResponse,
    period: "day",
    date: localDateStr(),
    loading: false,
    hasProduction: true,
    tariffConfigured: true,
    fetchHistory: async () => {},
    checkAvailability: async () => {},
  });
  useUiState.setState({ energyUnit: unit });
}

async function renderPage() {
  render(
    <MemoryRouter initialEntries={["/energy/consumption"]}>
      <EnergyPage />
    </MemoryRouter>,
  );
  await new Promise((r) => setTimeout(r, 0));
}

/** Text with the narrow and normal no-break spaces folded to plain spaces. */
const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u00a0\u202f]/g, " ");

describe("EnergyPage headline (spec 197)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(api.getEquipments).mockResolvedValue([]);
    await i18n.changeLanguage("fr");
  });

  it("opens on the Wh total with the tariff split and the solar share", async () => {
    setup("wh");
    await renderPage();
    // Grid 9,05 kWh + 0,06 kWh from the sun.
    expect(screen.getByText((_, el) => norm(el?.textContent) === "9,11 kWh")).toBeTruthy();
    expect(screen.getByText("aujourd'hui")).toBeTruthy();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" &&
          norm(el.textContent) ===
            "7,08 kWh en heures pleines · 1,97 kWh en heures creuses · 1 % autoconsommé",
      ),
    ).toBeTruthy();
  });

  it("opens on the bill in €, self-consumption left out of it", async () => {
    setup("eur");
    await renderPage();
    expect(screen.getByText((_, el) => norm(el?.textContent) === "1,78 €")).toBeTruthy();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" &&
          norm(el.textContent) ===
            "1,47 € en heures pleines · 0,31 € en heures creuses · 1 % autoconsommé",
      ),
    ).toBeTruthy();
  });

  it("keeps the legend to swatches and names", async () => {
    setup("wh");
    await renderPage();
    expect(screen.getByText("H. pleines")).toBeTruthy();
    expect(screen.getByText("H. creuses")).toBeTruthy();
    expect(screen.getByText("Autoconsommation")).toBeTruthy();
    expect(screen.queryByText(/Total\s*:/)).toBeNull();
  });

  it("draws Wh / € with the shared segmented control", async () => {
    setup("wh");
    await renderPage();
    expect(screen.getByRole("button", { name: "Wh" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Jour" }).getAttribute("aria-pressed")).toBe("true");
  });
});
