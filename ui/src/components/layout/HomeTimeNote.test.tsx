import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { useTimezone } from "../../store/useTimezone";
import { HomeTimeNote } from "./HomeTimeNote";

// Spec 196, decision pr6-horloge — no clock in the top bar while the browser
// is in the home's time zone; the home time (with its zone) when it is not.

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const otherTz = browserTz === "Pacific/Kiritimati" ? "America/Anchorage" : "Pacific/Kiritimati";

describe("HomeTimeNote", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
  });
  afterEach(() => {
    useTimezone.setState({ tz: "UTC", loaded: false });
  });

  it("renders nothing when the browser is in the home's time zone", () => {
    useTimezone.setState({ tz: browserTz, loaded: true });
    const { container } = render(<HomeTimeNote />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing until the home time zone is known", () => {
    useTimezone.setState({ tz: otherTz, loaded: false });
    const { container } = render(<HomeTimeNote />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for another spelling of the browser's zone", () => {
    // Intl takes zone names in any case and resolves them to the canonical one.
    useTimezone.setState({ tz: browserTz.toLowerCase(), loaded: true });
    const { container } = render(<HomeTimeNote />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the home zone's time as soon as it is known, never the UTC placeholder's", () => {
    useTimezone.setState({ tz: "UTC", loaded: false });
    const { container } = render(<HomeTimeNote />);
    expect(container.firstChild).toBeNull();
    // Every text the note ever showed, intermediate renders included.
    const observer = new MutationObserver(() => {});
    observer.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
    });
    act(() => useTimezone.setState({ tz: otherTz, loaded: true }));
    const shown = observer
      .takeRecords()
      .flatMap((r) => (r.type === "characterData" ? [r.oldValue ?? ""] : []))
      .filter((v) => v.startsWith("Heure maison"));
    observer.disconnect();
    const expected = new Intl.DateTimeFormat("fr-FR", {
      timeZone: otherTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(new Date());
    expect(screen.getByText(/^Heure maison/).textContent).toBe(`Heure maison ${expected}`);
    expect(shown).toEqual([]);
  });

  it("shows the home time, minutes only, when the zones differ", () => {
    useTimezone.setState({ tz: otherTz, loaded: true });
    render(<HomeTimeNote />);
    const note = screen.getByText(/^Heure maison \d{2}:\d{2}\b/);
    // No seconds: HH:MM followed by the zone name, never HH:MM:SS.
    expect(note.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(note.parentElement?.getAttribute("title")).toContain(otherTz);
  });
});
