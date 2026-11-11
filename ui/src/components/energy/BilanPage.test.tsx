import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../i18n";
import { render, screen } from "../../test-utils";
import { BilanPage } from "./BilanPage";
import { useEnergy } from "../../store/useEnergy";
import * as api from "../../api";
import type { EnergyBilanResponse } from "../../types";

// Spec 205 — the fixed fee block of the bill card, shown only with a fee.

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getEnergyBilan: vi.fn(),
}));

// Recharts draws nothing in jsdom; the navigation has its own tests.
vi.mock("./BilanChart", () => ({ BilanChart: () => null }));
vi.mock("./EnergyMobileNav", () => ({ EnergyMobileNav: () => null }));
vi.mock("./PeriodSelector", () => ({ PeriodSelector: () => null }));

const mockedBilan = vi.mocked(api.getEnergyBilan);

function response(over: Partial<EnergyBilanResponse> = {}): EnergyBilanResponse {
  return {
    period: "month",
    from: "2026-09-30T22:00:00.000Z",
    to: "2026-10-31T23:00:00.000Z",
    resolution: "1d",
    tariffConfigured: true,
    prices: { hp: 0.2142, hc: 0.1589 },
    hasProduction: false,
    bill: { total: 136.86, hp: 95.57, hc: 41.29 },
    avoided: 0,
    selfConsumedWh: 0,
    points: [],
    comparison: {
      kind: "month",
      projectedBill: null,
      previousYearBill: 199.83,
      projectedGridWh: null,
      previousYearGridWh: 1_036_000,
    },
    usage: [],
    arbiter: { enabled: false, since: null, measured: "none", solarWh: 0, avoided: 0, loads: [] },
    fee: null,
    priceSpans: [
      {
        from: "2026-10-01",
        to: "2026-10-31",
        hp: 0.2142,
        hc: 0.1589,
        fixedFeeYear: 239.84,
        kva: 9,
      },
    ],
    energy: { gridHpWh: 446_000, gridHcWh: 260_000, consumedWh: 706_000 },
    ...over,
  };
}

/** Normalise the narrow spaces Intl puts in French numbers. */
const n = (s: string | null) => (s ?? "").replace(/[\u202f\u00a0]/g, " ");

async function renderPage(data: EnergyBilanResponse) {
  mockedBilan.mockResolvedValue(data);
  render(
    <MemoryRouter initialEntries={["/energy/bilan"]}>
      <BilanPage />
    </MemoryRouter>,
  );
  await screen.findByText(/Facture/);
}

describe("BilanPage fee block (spec 205)", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("fr");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useEnergy.setState({ period: "month", date: "2026-10-15" });
  });

  it("shows no fee block and no total without a fee", async () => {
    await renderPage(response());
    expect(screen.queryByTestId("bilan-fee")).toBeNull();
    expect(screen.queryByText("Total avec l'abonnement")).toBeNull();
    expect(screen.queryByText("Comparaison sur la consommation seule.")).toBeNull();
  });

  it("shows the fee, the total and the comparison caption with a fee", async () => {
    await renderPage(response({ fee: { total: 20.3836, days: 31, daysWithoutFee: 0, kva: 9 } }));
    expect(screen.getByTestId("bilan-fee")).toBeTruthy();
    expect(screen.getByText("Abonnement 9 kVA")).toBeTruthy();
    expect(screen.getByText("Total avec l'abonnement")).toBeTruthy();
    expect(screen.getByText("Comparaison sur la consommation seule.")).toBeTruthy();
    // The headline stays the consumption cost.
    expect(screen.getAllByText(/136,86/).length).toBeGreaterThan(0);
    expect(screen.getByText(/157,24/)).toBeTruthy();
  });
});

describe("BilanPage kWh column (spec 207)", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("fr");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useEnergy.setState({ period: "month", date: "2026-10-15" });
  });

  const solar = {
    hasProduction: true,
    avoided: 41.76,
    selfConsumedWh: 214_000,
    energy: { gridHpWh: 446_000, gridHcWh: 260_000, consumedWh: 920_000 },
  };

  it("shows a two-part bar and no solar wording without production", async () => {
    await renderPage(response());
    const column = screen.getByTestId("bilan-energy");
    expect(column.textContent).toContain("Électricité consommée en octobre");
    expect(screen.getByTestId("bilan-energy-hp")).toBeTruthy();
    expect(screen.getByTestId("bilan-energy-hc")).toBeTruthy();
    expect(screen.queryByTestId("bilan-energy-solar")).toBeNull();
    expect(n(column.textContent)).toContain("706 kWh achetés au réseau.");
    expect(column.textContent).not.toMatch(/solaire|sur place/i);
    expect(screen.queryByText(/Sans panneaux/)).toBeNull();
  });

  it("shows the three parts, the sentence, the kWh comparison and the average price", async () => {
    await renderPage(
      response({ ...solar, fee: { total: 20.37, days: 31, daysWithoutFee: 0, kva: 9 } }),
    );
    const column = n(screen.getByTestId("bilan-energy").textContent);
    expect(screen.getByTestId("bilan-energy-solar")).toBeTruthy();
    expect(column).toContain("920 kWh");
    expect(column).toContain(
      "706 kWh achetés au réseau, 214 kWh produits et consommés sur place (23 %).",
    );
    expect(column).toContain("Octobre 2025 : 1 036 kWh achetés (−32 %).");
    expect(column).toContain("Prix moyen payé : 0,194 €/kWh, 0,223 €/kWh avec l'abonnement.");
    // The euro column is unchanged: no kWh in it.
    expect(screen.getByText(/Octobre 2025 : 199,83/)).toBeTruthy();
  });

  it("puts the bill without panels in the solar tile", async () => {
    await renderPage(response(solar));
    expect(n(screen.getByText(/Sans panneaux, la facture/).textContent)).toBe(
      "Sans panneaux, la facture aurait été de 178,62 €.",
    );
    expect(screen.queryByText(/produits et consommés sur place$/)).toBeNull();
  });
});
