/**
 * Local calendar date as `YYYY-MM-DD`.
 *
 * Deliberately NOT `new Date().toISOString().slice(0, 10)`: `toISOString()` is
 * UTC, so in any timezone ahead of UTC it rolls the day between local midnight
 * and UTC midnight — hiding "today" (and blocking navigation to it) for the first
 * hours after local midnight. This formats the viewer's *local* calendar day.
 *
 * Use this everywhere a "today" / day-key string is needed for the UI. Keep
 * `toISOString()` only where a genuine UTC instant is intended (API `from`/`to`).
 */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
