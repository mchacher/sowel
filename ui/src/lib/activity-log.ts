/**
 * The Maison activity panel as one continuous log (spec 196, slice 7c).
 *
 * Events are listed newest first, one row each. Instead of one card per hour,
 * the log only marks where it crosses into another part of the day, with a
 * small label: « Ce matin », « Hier soir », « Lundi après-midi »…
 *
 * Parts of the day, in local time: night 0–6 h, morning 6–12 h, afternoon
 * 12–18 h, evening 18–24 h. The group of the current part of today carries no
 * label: it is what « dernières 24 h » already reads as "now".
 */

import type { ActivityItem } from "../types";

export type DayPart = "night" | "morning" | "afternoon" | "evening";

export function dayPart(hour: number): DayPart {
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export interface LogPeriod {
  /** Calendar days before today (0 = today, 1 = yesterday…), in local time. */
  daysAgo: number;
  part: DayPart;
  /** Any instant of that day, to name it when it is older than yesterday. */
  day: Date;
}

export interface LogGroup {
  key: string;
  period: LogPeriod;
  /** False for the current part of today: no separator above it. */
  labelled: boolean;
  items: ActivityItem[];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysBetween(earlier: Date, later: Date): number {
  // Rounded: a day across a DST change is 23 or 25 hours long.
  return Math.round((startOfDay(later) - startOfDay(earlier)) / 86_400_000);
}

/**
 * Splits activity items into parts of the day, newest first. Consecutive items
 * of the same part share a group; the items keep their order inside it.
 */
export function groupActivityLog(items: readonly ActivityItem[], now: Date): LogGroup[] {
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);
  // The clock is re-read once a minute: an event that arrives just after it
  // crossed into a new part of the day is still "now", not "this afternoon".
  const ref = sorted.length > 0 && sorted[0].timestamp > now.getTime() ? new Date(sorted[0].timestamp) : now;
  const currentKey = `0-${dayPart(ref.getHours())}`;
  const groups: LogGroup[] = [];
  for (const item of sorted) {
    const d = new Date(item.timestamp);
    const daysAgo = Math.max(0, daysBetween(d, ref));
    const part = dayPart(d.getHours());
    const key = `${daysAgo}-${part}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    groups.push({ key, period: { daysAgo, part, day: d }, labelled: key !== currentKey, items: [item] });
  }
  return groups;
}

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The separator label of a period: « Cet après-midi », « Hier soir »,
 * « Lundi matin », « 2 novembre, dans la nuit »…
 */
export function logPeriodLabel(period: LogPeriod, t: Translate, locale: string): string {
  if (period.daysAgo === 0) return t(`activity.period.today.${period.part}`);
  if (period.daysAgo === 1) return t(`activity.period.yesterday.${period.part}`);
  // A weekday names the past six days unambiguously; beyond, the date does.
  const fmt: Intl.DateTimeFormatOptions =
    period.daysAgo < 7 ? { weekday: "long" } : { day: "numeric", month: "long" };
  const name = new Intl.DateTimeFormat(locale, fmt).format(period.day);
  const day = name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  return t(`activity.period.other.${period.part}`, { day });
}
