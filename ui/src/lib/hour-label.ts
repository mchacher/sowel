/**
 * Hour labels for the day view of the energy charts (issue #730).
 *
 * These were built as `${hour}h` and `${hour}h00 – ${hour + 1}h00`, French
 * notation that no `"fr-FR"` grep could find because it is a template literal,
 * yet just as French on an English page.
 *
 * Both forms stay on a 24-hour clock: Sowel shows 24-hour time everywhere
 * (`lib/format.ts` pins `en-GB` for the same reason), so only the separator
 * follows the language.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

const isFrench = (locale: string): boolean => locale.toLowerCase().startsWith("fr");

/** The X axis tick for one hour: "08h" in French, "08:00" in English. */
export function formatHourLabel(hour: number, locale: string): string {
  return isFrench(locale) ? `${pad(hour)}h` : `${pad(hour)}:00`;
}

/** The tooltip heading for one hour: "08h00 - 09h00" / "08:00 - 09:00". */
export function formatHourRange(hour: number, locale: string): string {
  const next = (hour + 1) % 24;
  return isFrench(locale)
    ? `${pad(hour)}h00 - ${pad(next)}h00`
    : `${pad(hour)}:00 - ${pad(next)}:00`;
}
