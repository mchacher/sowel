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

/**
 * A local `YYYY-MM-DD` day key as a Date, at local noon.
 *
 * `Date.parse("2026-08-24")` is UTC midnight, which renders as the 23rd
 * anywhere west of Greenwich. Noon keeps the instant inside the intended day in
 * every timezone, which is the idiom the energy charts already use.
 */
export function localDayToDate(day: string): Date {
  return new Date(`${day}T12:00:00`);
}
