import { describe, it, expect, afterEach } from "vitest";
import i18n from "../i18n";
import { calendarProfileLabel } from "./calendar-profile";

// #1151 — migration 001 seeds « Travail » and « Vacances », so an English
// install showed French names. They are translated at display time.
const t = (key: string) => i18n.t(key);

describe("calendarProfileLabel", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows the built-in profiles in the viewer's language", async () => {
    await i18n.changeLanguage("en");
    expect(calendarProfileLabel({ id: "travail", name: "Travail", builtIn: true }, t)).toBe("Work");
    expect(calendarProfileLabel({ id: "vacances", name: "Vacances", builtIn: true }, t)).toBe(
      "Holidays",
    );
    await i18n.changeLanguage("fr");
    expect(calendarProfileLabel({ id: "travail", name: "Travail", builtIn: true }, t)).toBe(
      "Travail",
    );
  });

  it("keeps a name someone set, and any other profile's name", () => {
    expect(calendarProfileLabel({ id: "travail", name: "Bureau", builtIn: true }, t)).toBe(
      "Bureau",
    );
    expect(calendarProfileLabel({ id: "travail", name: "Travail", builtIn: false }, t)).toBe(
      "Travail",
    );
    expect(calendarProfileLabel({ id: "x", name: "Astreinte", builtIn: false }, t)).toBe(
      "Astreinte",
    );
  });
});
