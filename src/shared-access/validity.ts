import type {
  SharedAccessRefusal,
  SharedAccessStatus,
  SharedAccessTimeWindow,
} from "../shared/types.js";

// ============================================================
// Spec 181 — validity (R3.10) and the decision (R4.12)
//
// Everything here reads the house's wall clock. Spec 061 sets `process.env.TZ`
// from the home's coordinates before the first Date is built, so the local
// getters ARE the house's clock and nothing needs converting.
// ============================================================

export class SharedAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "SharedAccessError";
  }
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `08:30` → 510. Null when it is not a time of day. */
export function parseHm(value: string): number | null {
  const m = HM.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

/**
 * The days a window applies on. Absent is every day (every window written before
 * days existed). Anything else that is not a list of days — a restored backup, a
 * hand-edited row — opens on no day at all: a gate fails shut.
 */
function daysOf(w: SharedAccessTimeWindow): number[] {
  if (w.days === undefined) return EVERY_DAY;
  return Array.isArray(w.days) ? w.days : [];
}

/** ISO weekday of an instant on the house's clock: 1 = Monday … 7 = Sunday. */
function weekdayOf(ts: number): number {
  return new Date(ts).getDay() || 7;
}

/**
 * The time windows as the owner or a profile wrote them: each `HH:MM`, not
 * crossing midnight, and not overlapping **on a day they share** (Tuesday
 * morning and Friday evening may overlap in hours). `days` is optional; when
 * written it names at least one real ISO weekday. Returned sorted by start,
 * days sorted and unique, and « all seven » written as no days at all so an
 * unrestricted window looks as it always did. Throws otherwise.
 */
export function validateTimeWindows(input: unknown): SharedAccessTimeWindow[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input))
    throw new SharedAccessError("invalid_hours", "timeWindows must be a list");
  const parsed = input.map((w: unknown) => {
    const win = w as { from?: unknown; to?: unknown; days?: unknown };
    const from = typeof win?.from === "string" ? parseHm(win.from) : null;
    const to = typeof win?.to === "string" ? parseHm(win.to) : null;
    if (from === null || to === null) {
      throw new SharedAccessError("invalid_hours", "A time window is written HH:MM–HH:MM");
    }
    if (to <= from) {
      throw new SharedAccessError(
        "window_crosses_midnight",
        `${String(win.from)}–${String(win.to)} crosses midnight or is empty`,
      );
    }
    let days: number[] = EVERY_DAY;
    if (win.days !== undefined) {
      // An empty list is refused rather than read as « every day », which is
      // the opposite of what an owner who unticked every day meant.
      const real =
        Array.isArray(win.days) &&
        win.days.length > 0 &&
        win.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
      if (!real) {
        throw new SharedAccessError(
          "invalid_days",
          "A time window names at least one day, from 1 (Monday) to 7 (Sunday)",
        );
      }
      days = [...new Set(win.days as number[])].sort((x, y) => x - y);
    }
    return { from: win.from as string, to: win.to as string, a: from, b: to, days };
  });
  parsed.sort((x, y) => x.a - y.a);
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      // Sorted by start: once one starts after this one ends, so do the rest.
      if (parsed[j].a >= parsed[i].b) break;
      const shareADay = parsed[i].days.some((d) => parsed[j].days.includes(d));
      if (shareADay && parsed[j].a < parsed[i].b) {
        throw new SharedAccessError("windows_overlap", "Two time windows overlap");
      }
    }
  }
  return parsed.map(({ from, to, days }) =>
    days.length === 7 ? { from, to } : { from, to, days },
  );
}

/** A date given as ISO or as the house's `YYYY-MM-DDTHH:MM`, to epoch ms. */
export function parseInstant(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  let ms: number;
  if (typeof value === "number") {
    ms = value;
  } else if (typeof value === "string") {
    // A date-time without an offset is read by Date as local time — the
    // house's. A date alone would be read as UTC midnight: it is the house's
    // midnight that is meant.
    ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value);
  } else {
    throw new SharedAccessError("invalid_date", `${field} is not a date`);
  }
  // Beyond ±8.64e15 ms a Date cannot be written back, and one such row would
  // break every page that lists it.
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) {
    throw new SharedAccessError("invalid_date", `${field} is not a date`);
  }
  return ms;
}

export function checkPeriod(from: number | null, until: number | null): void {
  if (from !== null && until !== null && until <= from) {
    throw new SharedAccessError("end_before_start", "The end is before the start");
  }
}

function minuteOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

function atMinute(ts: number, minute: number, dayOffset = 0): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return d.getTime();
}

export function inTimeWindows(windows: SharedAccessTimeWindow[], ts: number): boolean {
  if (windows.length === 0) return true;
  const m = minuteOfDay(ts);
  const day = weekdayOf(ts);
  return windows.some((w) => {
    const a = parseHm(w.from);
    const b = parseHm(w.to);
    return a !== null && b !== null && daysOf(w).includes(day) && m >= a && m < b;
  });
}

/**
 * When the next window opens after `ts`: later today, then each following day
 * up to the same weekday next week. Null without windows, or when none of them
 * can ever open.
 */
export function nextWindowOpening(windows: SharedAccessTimeWindow[], ts: number): number | null {
  if (windows.length === 0) return null;
  const parsed = windows
    .map((w) => ({ from: parseHm(w.from), days: daysOf(w) }))
    .filter((w): w is { from: number; days: number[] } => w.from !== null);
  const m = minuteOfDay(ts);
  const today = weekdayOf(ts);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = ((today - 1 + ahead) % 7) + 1;
    const starts = parsed
      .filter((w) => w.days.includes(day) && (ahead > 0 || w.from > m))
      .map((w) => w.from)
      .sort((x, y) => x - y);
    if (starts.length > 0) return atMinute(ts, starts[0], ahead);
  }
  return null;
}

/** What the decision needs to know of an access. */
export interface ValidityFacts {
  validFrom: number | null;
  validUntil: number | null;
  timeWindows: SharedAccessTimeWindow[];
  suspendedAt: number | null;
  revokedAt: number | null;
  gateIds: string[];
}

export function hasEnded(a: ValidityFacts, now: number): boolean {
  return a.revokedAt !== null || (a.validUntil !== null && now >= a.validUntil);
}

export function accessStatus(a: ValidityFacts, now: number): SharedAccessStatus {
  if (a.revokedAt !== null) return "revoked";
  if (a.validUntil !== null && now >= a.validUntil) return "ended";
  if (a.suspendedAt !== null) return "suspended";
  if (a.gateIds.length === 0) return "no_gate";
  if (a.validFrom !== null && now < a.validFrom) return "not_yet";
  if (!inTimeWindows(a.timeWindows, now)) return "outside_hours";
  return "live";
}

export type Decision =
  | { ok: true }
  | {
      ok: false;
      reason: SharedAccessRefusal;
      /** R5.22: when a refusal is about time, when it will open. */
      activeAt?: number;
      nextOpeningAt?: number;
    };

/**
 * R4.12, in its order: not revoked → not suspended → inside the dates → inside
 * a time window → a gate the access lists → that gate armed. The ceilings come
 * after, in the manager, because they count presses. The decision comes first:
 * a refused press never reaches the gate.
 */
export function decide(
  a: ValidityFacts,
  gateId: string,
  now: number,
  isArmed: (equipmentId: string) => boolean,
): Decision {
  if (a.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (a.suspendedAt !== null) return { ok: false, reason: "suspended" };
  if (a.validFrom !== null && now < a.validFrom) {
    return { ok: false, reason: "not_yet", activeAt: a.validFrom };
  }
  if (a.validUntil !== null && now >= a.validUntil) return { ok: false, reason: "expired" };
  if (!inTimeWindows(a.timeWindows, now)) {
    const next = nextWindowOpening(a.timeWindows, now);
    const inside = next !== null && (a.validUntil === null || next < a.validUntil);
    return inside
      ? { ok: false, reason: "outside_hours", nextOpeningAt: next }
      : { ok: false, reason: "outside_hours" };
  }
  if (a.gateIds.length === 0) return { ok: false, reason: "no_gate" };
  if (!a.gateIds.includes(gateId)) return { ok: false, reason: "not_this_gate" };
  if (!isArmed(gateId)) return { ok: false, reason: "refused_by_house" };
  return { ok: true };
}
