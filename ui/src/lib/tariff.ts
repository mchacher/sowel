import type { TariffConfig, TariffSeason } from "../types";

/**
 * Whether a tariff is actually persisted, as opposed to the proposal the form
 * shows before anything is saved (issue #384).
 *
 * `GET /api/v1/settings/energy/tariff` returns an **empty** `schedules` array
 * when `energy.tariff` is absent from settings — that empty array is the "never
 * saved" sentinel. The tariff form pre-fills the standard HP/HC hours as a
 * convenience, so a non-empty local form is not evidence of a saved tariff; the
 * server response is. This helper is the single place that reads that signal, so
 * "displayed" and "saved" can never drift into looking the same again.
 */
export function isTariffSaved(config: TariffConfig): boolean {
  return config.schedules.length > 0;
}

/** Spec 204 — the Enedis summer, used when a summer is first ticked. */
export const SUMMER_DEFAULT: Pick<TariffSeason, "from" | "to"> = { from: "04-01", to: "10-31" };

type SeasonDates = Pick<TariffSeason, "from" | "to">;

function monthDay(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Whether a local date falls in the stored summer, both ends inclusive. The
 * same test as the backend's `isSummer` (`MM-DD` strings compare as strings).
 */
export function isSummerOn(season: SeasonDates, date: Date): boolean {
  const md = monthDay(date);
  return season.from <= md && md <= season.to;
}

/** The `MM-DD` one day after (`+1`) or before (`-1`) another, in a leap year. */
function shiftMonthDay(md: string, days: 1 | -1): string {
  const [m, d] = md.split("-").map(Number);
  return monthDay(new Date(2000, m - 1, d + days));
}

/**
 * The first and last day of a season, `MM-DD`: summer is stored, winter is
 * the rest of the year (the day after summer ends to the day before it starts).
 */
export function seasonRange(season: SeasonDates, which: "summer" | "winter"): SeasonDates {
  if (which === "summer") return { from: season.from, to: season.to };
  return { from: shiftMonthDay(season.to, 1), to: shiftMonthDay(season.from, -1) };
}

/** A `MM-DD` written for people: « 1er novembre », « 31 mars », "November 1". */
export function formatMonthDay(md: string, language: string): string {
  const [m, d] = md.split("-").map(Number);
  const date = new Date(2000, m - 1, d);
  if (language.startsWith("fr")) {
    const month = new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(date);
    return `${d === 1 ? "1er" : d} ${month}`;
  }
  return new Intl.DateTimeFormat(language, { month: "long", day: "numeric" }).format(date);
}

/**
 * The first and last day of a season, written for its date line. Derived from
 * the stored season, so the label never disagrees with what classifies.
 */
export function seasonLabel(
  season: SeasonDates,
  which: "summer" | "winter",
  language: string,
): { from: string; to: string } {
  const range = seasonRange(season, which);
  return { from: formatMonthDay(range.from, language), to: formatMonthDay(range.to, language) };
}
