import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../test-utils";
import i18n from "../i18n";
import { PeriodSelector, type PeriodSelectorProps } from "./PeriodSelector";

// Issue #730 — the Energy page had its own untranslated copy of this component.

function props(over: Partial<PeriodSelectorProps> = {}): PeriodSelectorProps {
  return {
    period: "day",
    date: "2026-03-09",
    canGoForward: true,
    isToday: false,
    onPeriodChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
    ...over,
  };
}

describe("PeriodSelector (#730)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("labels the tabs and the reset in English", async () => {
    await i18n.changeLanguage("en");
    render(<PeriodSelector {...props()} />);

    for (const label of ["Day", "Week", "Month", "Year", "Today"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // The whole point of the issue: no French left anywhere on the control.
    expect(screen.queryByText("Jour")).toBeNull();
    expect(screen.queryByText("Aujourd'hui")).toBeNull();
  });

  it("labels the tabs and the reset in French", async () => {
    await i18n.changeLanguage("fr");
    render(<PeriodSelector {...props()} />);

    for (const label of ["Jour", "Sem", "Mois", "Année", "Aujourd'hui"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("formats the date in the active language", async () => {
    await i18n.changeLanguage("en");
    const { unmount } = render(<PeriodSelector {...props()} />);
    expect(screen.getByText("March 9, 2026")).toBeTruthy();
    unmount();

    await i18n.changeLanguage("fr");
    render(<PeriodSelector {...props()} />);
    expect(screen.getByText("9 mars 2026")).toBeTruthy();
  });

  it("keeps the region out of the equation, so a bare 'fr' still reads French", async () => {
    // dateLocale() exists because i18next strips the region from the language.
    await i18n.changeLanguage("fr");
    render(<PeriodSelector {...props({ period: "month" })} />);
    expect(screen.getByText("mars 2026")).toBeTruthy();
  });

  it("wires every control", async () => {
    await i18n.changeLanguage("en");
    const p = props();
    render(<PeriodSelector {...p} />);

    await userEvent.click(screen.getByRole("button", { name: "Month" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous period" }));
    await userEvent.click(screen.getByRole("button", { name: "Next period" }));
    await userEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(p.onPeriodChange).toHaveBeenCalledWith("month");
    expect(p.onPrevious).toHaveBeenCalledTimes(1);
    expect(p.onNext).toHaveBeenCalledTimes(1);
    expect(p.onToday).toHaveBeenCalledTimes(1);
  });

  it("blocks navigation into the future and the redundant reset", async () => {
    await i18n.changeLanguage("en");
    render(<PeriodSelector {...props({ canGoForward: false, isToday: true })} />);

    expect((screen.getByRole("button", { name: "Next period" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Today" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
