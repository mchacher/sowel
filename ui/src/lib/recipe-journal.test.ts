import { describe, expect, it } from "vitest";
import { journalItems } from "./recipe-journal";
import type { RecipeLogEntry } from "../types";

// Spec 198 — the recipe journal's entries, ready for the period groups.

const entry = (id: number, timestamp: string, level: RecipeLogEntry["level"] = "info") => ({
  id,
  instanceId: "ri-1",
  timestamp,
  message: `m${id}`,
  level,
});

describe("journalItems", () => {
  it("reads SQLite timestamps (no zone suffix) as UTC", () => {
    const [item] = journalItems([entry(1, "2026-10-26 05:14:04")]);
    expect(item.timestamp).toBe(Date.UTC(2026, 9, 26, 5, 14, 4));
  });

  it("keeps an explicit zone as given", () => {
    const [item] = journalItems([entry(1, "2026-10-26T05:14:04Z")]);
    expect(item.timestamp).toBe(Date.UTC(2026, 9, 26, 5, 14, 4));
  });

  it("lists the newest first and keeps the level", () => {
    const items = journalItems([
      entry(1, "2026-10-21 18:11:09"),
      entry(2, "2026-11-08 19:40:25"),
      entry(3, "2026-10-26 05:14:04", "error"),
    ]);
    expect(items.map((i) => i.id)).toEqual([2, 3, 1]);
    expect(items[1].level).toBe("error");
  });

  it("keeps the write order of entries of the same second", () => {
    const items = journalItems([entry(7, "2026-11-08 19:40:25"), entry(8, "2026-11-08 19:40:25")]);
    expect(items.map((i) => i.id)).toEqual([8, 7]);
  });

  it("drops an entry whose time does not parse", () => {
    expect(journalItems([entry(1, "not a date"), entry(2, "2026-11-08 19:40:25")])).toHaveLength(1);
  });
});
