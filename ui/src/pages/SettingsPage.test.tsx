/**
 * Spec 206 — « Énergie » holds the grid side (the tariff card alone), « Solaire »
 * the solar side: the installation, then the arbiter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "../i18n";
import { render, screen, within } from "../test-utils";
import { SettingsPage } from "./SettingsPage";
import { useAuth } from "../store/useAuth";
import type { User } from "../types";

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  getSystemVersion: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../components/settings/TariffSettings", () => ({
  TariffSettings: () => <section data-testid="card">tariff</section>,
}));
vi.mock("../components/settings/ArbiterSettings", () => ({
  ArbiterSettings: () => <section data-testid="card">arbiter</section>,
}));
vi.mock("../components/settings/SolarInstallationSettings", () => ({
  SolarInstallationSettings: () => <section data-testid="card">solar-installation</section>,
}));

function renderAt(tab: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

function cards(): string[] {
  return screen.getAllByTestId("card").map((el) => el.textContent ?? "");
}

describe("SettingsPage tabs (spec 206)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    useAuth.setState({
      user: { id: "u1", username: "a", role: "admin", preferences: {} } as unknown as User,
    });
  });

  it("puts the solar tab between Energy and Administration", () => {
    renderAt("energy");
    const labels = within(screen.getByRole("tablist"))
      .getAllByRole("tab")
      .map((el) => el.textContent);
    expect(labels).toEqual(["General", "Account", "Energy", "Solar", "Administration"]);
  });

  it("shows the tariff card alone on Energy", () => {
    renderAt("energy");
    expect(screen.getByRole("tab", { name: "Energy" }).getAttribute("aria-selected")).toBe("true");
    expect(cards()).toEqual(["tariff"]);
  });

  it("shows the installation then the arbiter on Solar", () => {
    renderAt("solar");
    expect(screen.getByRole("tab", { name: "Solar" }).getAttribute("aria-selected")).toBe("true");
    expect(cards()).toEqual(["solar-installation", "arbiter"]);
  });
});
