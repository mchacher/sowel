import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { RecipeJournal } from "./RecipeJournal";
import { useRecipes } from "../../store/useRecipes";
import type { RecipeLogEntry } from "../../types";

// Spec 198 — the journal reads like the Activity panel: period labels, HH:MM,
// how far back it reaches, an error in red.

/** A local time `daysAgo` days back, as SQLite writes it (UTC, no suffix). */
function sqliteAt(daysAgo: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

function entry(
  id: number,
  timestamp: string,
  message: string,
  level: RecipeLogEntry["level"] = "info",
) {
  return { id, instanceId: "ri-1", timestamp, message, level };
}

describe("RecipeJournal", () => {
  it("groups the entries by part of the day, newest first, with the time as HH:MM", async () => {
    useRecipes.setState({
      getLog: vi
        .fn()
        .mockResolvedValue([
          entry(1, sqliteAt(1, 20, 40), "Current: stoveState=standby"),
          entry(2, sqliteAt(1, 9, 5), "ALARM: stoveState=error_A01", "error"),
        ]),
    });
    render(<RecipeJournal instanceId="ri-1" action={<button type="button">Settings</button>} />);

    const evening = await screen.findByRole("heading", { name: "Yesterday evening" });
    const morning = screen.getByRole("heading", { name: "Yesterday morning" });
    expect(
      evening.compareDocumentPosition(morning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("20:40")).toBeTruthy();
    expect(screen.getByText(/since yesterday 09:05/)).toBeTruthy();
    // The error line is red, the info line is not.
    expect(screen.getByText("ALARM: stoveState=error_A01").closest("li")?.className).toContain(
      "text-error",
    );
    expect(screen.getByText("Current: stoveState=standby").closest("li")?.className).not.toContain(
      "text-error",
    );
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("says the journal is unavailable when its first load fails, not that it is empty", async () => {
    useRecipes.setState({ getLog: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<RecipeJournal instanceId="ri-1" />);
    expect(await screen.findByText("The log is unavailable right now")).toBeTruthy();
    expect(screen.queryByText("No logs")).toBeNull();
  });

  it("says so when the journal is empty", async () => {
    useRecipes.setState({ getLog: vi.fn().mockResolvedValue([]) });
    render(<RecipeJournal instanceId="ri-1" />);
    expect(await screen.findByText("No logs")).toBeTruthy();
  });
});
