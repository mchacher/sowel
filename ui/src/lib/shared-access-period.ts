// ============================================================
// Spec 181 — the period picker's logic (R7.29) and the validity groups (R3.10).
//
// Everything is on the HOUSE's wall clock: a `Wall` is a day and a time of day
// with no zone attached, which is what the server reads from `YYYY-MM-DDTHH:MM`.
// Arithmetic goes through Date.UTC so that no browser zone and no DST jump can
// shift a value: the wall clock is just a calendar here.
// ============================================================

import type { SharedAccessTimeWindow } from "../types";

export interface Wall {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM` */
  time: string;
}

/** What a picker may accept. `min` is exclusive when `minStrict` (an end after its start). */
export interface Bounds {
  min?: Wall | null;
  minStrict?: boolean;
  max?: Wall | null;
}

export const MINUTE_STEP = 5;
export const HOURS = Array.from({ length: 24 }, (_, h) => h);
export const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes since the epoch of the wall clock — a calendar count, zone-free. */
export function wallToMinutes(w: Wall): number {
  const [y, mo, d] = w.date.split("-").map(Number);
  const [h, mi] = w.time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60_000;
}

export function minutesToWall(total: number): Wall {
  const d = new Date(total * 60_000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

export function compareWall(a: Wall, b: Wall): number {
  return wallToMinutes(a) - wallToMinutes(b);
}

export function addMinutes(w: Wall, n: number): Wall {
  return minutesToWall(wallToMinutes(w) + n);
}

export function wallToString(w: Wall): string {
  return `${w.date}T${w.time}`;
}

export function makeWall(date: string, hour: number, minute: number): Wall {
  return { date, time: `${pad(hour)}:${pad(minute)}` };
}

export function wallHour(w: Wall): number {
  return Number(w.time.slice(0, 2));
}

export function wallMinute(w: Wall): number {
  return Number(w.time.slice(3, 5));
}

/** The next step of five minutes at or after `w`. */
export function roundUpToStep(w: Wall): Wall {
  const m = wallToMinutes(w);
  return minutesToWall(Math.ceil(m / MINUTE_STEP) * MINUTE_STEP);
}

export function isAllowed(w: Wall, b: Bounds): boolean {
  if (b.min) {
    const c = compareWall(w, b.min);
    if (b.minStrict ? c <= 0 : c < 0) return false;
  }
  if (b.max && compareWall(w, b.max) > 0) return false;
  return true;
}

/** A day is refused when it lies wholly before the start or after the bound (struck in the calendar). */
export function isDayAllowed(date: string, b: Bounds): boolean {
  return HOURS.some((h) => hourAllowed(date, h, b));
}

function hourAllowed(date: string, hour: number, b: Bounds): boolean {
  return MINUTES.some((m) => isAllowed(makeWall(date, hour, m), b));
}

export interface Option {
  value: number;
  disabled: boolean;
}

/** R7.29 — the hours list: on the start's day, the hours before it are disabled. */
export function hourOptions(date: string, b: Bounds): Option[] {
  return HOURS.map((h) => ({ value: h, disabled: !hourAllowed(date, h, b) }));
}

/**
 * R7.29 — the minutes list, in steps of five, the ones before the bound
 * disabled on its day and hour. A minute already chosen off the grid (a value
 * the server holds, e.g. from a plugin) is kept as an extra option so the
 * select never silently changes it.
 */
export function minuteOptions(date: string, hour: number, b: Bounds, current?: number): Option[] {
  const values = [...MINUTES];
  if (current !== undefined && !values.includes(current)) {
    values.push(current);
    values.sort((x, y) => x - y);
  }
  return values.map((m) => ({ value: m, disabled: !isAllowed(makeWall(date, hour, m), b) }));
}

/** The first slot of the grid that the bounds accept on that day, or null. */
export function firstAllowedOnDay(date: string, b: Bounds): Wall | null {
  for (const h of HOURS) {
    for (const m of MINUTES) {
      const w = makeWall(date, h, m);
      if (isAllowed(w, b)) return w;
    }
  }
  return null;
}

/** The last slot of the grid that the bounds accept on that day, or null. */
function lastAllowedOnDay(date: string, b: Bounds): Wall | null {
  for (let hi = HOURS.length - 1; hi >= 0; hi--) {
    for (let mi = MINUTES.length - 1; mi >= 0; mi--) {
      const w = makeWall(date, HOURS[hi], MINUTES[mi]);
      if (isAllowed(w, b)) return w;
    }
  }
  return null;
}

/**
 * A value a picker is about to take, brought inside its bounds: a day before
 * the start becomes the start's day, and a time before the start on that day
 * becomes the first slot after it. Returns the value unchanged when it fits.
 */
export function snapInto(w: Wall, b: Bounds): Wall {
  if (isAllowed(w, b)) return w;
  if (b.min && w.date <= b.min.date) {
    // Nothing left on the start's day (a start at 23:55, strict): the next day.
    const next = addMinutes(makeWall(b.min.date, 0, 0), 24 * 60).date;
    return firstAllowedOnDay(b.min.date, b) ?? firstAllowedOnDay(next, b) ?? w;
  }
  if (b.max && w.date >= b.max.date) {
    return lastAllowedOnDay(b.max.date, b) ?? b.max;
  }
  return firstAllowedOnDay(w.date, b) ?? w;
}

/**
 * R7.29 — moving the start past the end carries the end along, keeping the
 * length the period had. A start that stays before the end leaves it alone.
 */
export function moveStart(oldStart: Wall, newStart: Wall, end: Wall): Wall {
  if (compareWall(newStart, end) < 0) return end;
  const length = Math.max(compareWall(end, oldStart), MINUTE_STEP);
  return addMinutes(newStart, length);
}

// ── The two validity groups (R3.10) ─────────────────────────────

export interface ValidityDraft {
  /** Dates: false = « Tout le temps », true = « Du … au … ». */
  period: boolean;
  from: Wall;
  until: Wall;
  /** Heures: false = « Toute la journée », true = « Par plages ». */
  ranges: boolean;
  windows: SharedAccessTimeWindow[];
}

/** A fresh period: from the next five-minute step, for a day. */
export function defaultPeriod(now: Wall): { from: Wall; until: Wall } {
  const from = roundUpToStep(now);
  return { from, until: addMinutes(from, 24 * 60) };
}

export function emptyValidity(now: Wall): ValidityDraft {
  const { from, until } = defaultPeriod(now);
  return { period: false, from, until, ranges: false, windows: [] };
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHm(value: string): number | null {
  const m = HM.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export type ValidityProblem =
  | { code: "end_before_start"; group: "dates" }
  | { code: "invalid_hours"; group: "hours"; window: SharedAccessTimeWindow }
  | { code: "window_crosses_midnight"; group: "hours"; window: SharedAccessTimeWindow }
  | {
      code: "windows_overlap";
      group: "hours";
      window: SharedAccessTimeWindow;
      other: SharedAccessTimeWindow;
    };

/** The same refusals the server gives (validity.ts), checked before sending. */
export function checkValidity(v: ValidityDraft): ValidityProblem | null {
  if (v.period && compareWall(v.until, v.from) <= 0) {
    return { code: "end_before_start", group: "dates" };
  }
  if (v.ranges) {
    const parsed = v.windows.map((w) => ({ w, a: parseHm(w.from), b: parseHm(w.to) }));
    const bad = parsed.find((p) => p.a === null || p.b === null);
    if (bad) return { code: "invalid_hours", group: "hours", window: bad.w };
    const cross = parsed.find((p) => (p.b as number) <= (p.a as number));
    if (cross) return { code: "window_crosses_midnight", group: "hours", window: cross.w };
    const sorted = [...parsed].sort((x, y) => (x.a as number) - (y.a as number));
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i].a as number) < (sorted[i - 1].b as number)) {
        return {
          code: "windows_overlap",
          group: "hours",
          window: sorted[i - 1].w,
          other: sorted[i].w,
        };
      }
    }
  }
  return null;
}

/** The body fields the two groups produce: null dates and no windows when « tout le temps / toute la journée ». */
export function validityBody(v: ValidityDraft): {
  validFrom: string | null;
  validUntil: string | null;
  timeWindows: SharedAccessTimeWindow[];
} {
  return {
    validFrom: v.period ? wallToString(v.from) : null,
    validUntil: v.period ? wallToString(v.until) : null,
    timeWindows: v.ranges ? v.windows.map((w) => ({ from: w.from.trim(), to: w.to.trim() })) : [],
  };
}

// ── The house's clock ───────────────────────────────────────────

/** An instant, as the house's wall clock reads it (`tz` = `home.timezone`). */
export function isoToWall(iso: string, tz: string): Wall {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function nowWall(tz: string): Wall {
  return isoToWall(new Date().toISOString(), tz);
}

/** The validity groups of an access or a profile as the server holds them. */
export function validityFromView(
  view: { validFrom: string | null; validUntil: string | null; timeWindows: SharedAccessTimeWindow[] },
  tz: string,
): ValidityDraft {
  const base = emptyValidity(nowWall(tz));
  const period = view.validFrom !== null || view.validUntil !== null;
  const from = view.validFrom ? isoToWall(view.validFrom, tz) : base.from;
  const until = view.validUntil ? isoToWall(view.validUntil, tz) : addMinutes(from, 24 * 60);
  return {
    period,
    from,
    until,
    ranges: view.timeWindows.length > 0,
    windows: view.timeWindows.map((w) => ({ ...w })),
  };
}
