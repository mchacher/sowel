/**
 * Local calendar date as `YYYY-MM-DD`, using the server timezone
 * (`process.env.TZ`, Europe/Paris by default — see the energy routes).
 *
 * Deliberately NOT `new Date().toISOString().slice(0, 10)`: `toISOString()` is
 * UTC, so between local midnight and UTC midnight it yields the *previous* day
 * in any timezone ahead of UTC. That makes a default "today" (energy history,
 * backup filenames) point at yesterday for the first hours after local midnight.
 * The local `getFullYear`/`getMonth`/`getDate` accessors respect `process.env.TZ`.
 *
 * Keep `toISOString()` where a genuine UTC instant is intended.
 */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
