import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { MobileTopbarTitle } from "./AppLayout";

// Spec 196, FR-6 — while the settings load, the compact top bar showed the
// generic « Maison », then switched to the home's name. It shows a placeholder.

function renderAt(path: string, homeName: string | null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileTopbarTitle homeName={homeName} />
    </MemoryRouter>,
  );
}

describe("MobileTopbarTitle", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
  });

  it("shows a placeholder, not « Maison », before the home name loads", () => {
    renderAt("/settings", null);
    expect(screen.getByTestId("home-name-skeleton")).toBeTruthy();
    expect(screen.queryByText("Maison")).toBeNull();
    expect(screen.getByText("Réglages")).toBeTruthy();
  });

  it("shows the home name once loaded", () => {
    renderAt("/settings", "Grange Neuve");
    expect(screen.getByText("Grange Neuve")).toBeTruthy();
    expect(screen.queryByTestId("home-name-skeleton")).toBeNull();
  });

  it("falls back to « Maison » when the home has no name", () => {
    renderAt("/settings", "");
    expect(screen.getByText("Maison")).toBeTruthy();
  });
});
