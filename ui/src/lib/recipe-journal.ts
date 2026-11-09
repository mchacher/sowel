import type { RecipeLogEntry } from "../types";

/** A recipe log entry with its time in milliseconds, ready for the period groups. */
export interface JournalItem {
  id: number;
  timestamp: number;
  message: string;
  level: RecipeLogEntry["level"];
}

/**
 * The recipe journal's entries (spec 198), newest first. SQLite writes the
 * timestamps without a time zone suffix: they are UTC, as `formatTime` reads
 * them. Entries of the same second keep their write order (the id). An entry
 * whose time does not parse is dropped rather than shown at 1970.
 */
export function journalItems(entries: readonly RecipeLogEntry[]): JournalItem[] {
  return entries
    .map((e) => {
      const iso =
        e.timestamp.endsWith("Z") || e.timestamp.includes("+") ? e.timestamp : `${e.timestamp}Z`;
      return {
        id: e.id,
        timestamp: Date.parse(iso.replace(" ", "T")),
        message: e.message,
        level: e.level,
      };
    })
    .filter((e) => Number.isFinite(e.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
}
