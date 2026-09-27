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

/**
 * The time windows as the owner or a profile wrote them: each `HH:MM`, not
 * crossing midnight, not overlapping. Returned sorted. Throws otherwise.
 */
export function validateTimeWindows(input: unknown): SharedAccessTimeWindow[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input))
    throw new SharedAccessError("invalid_hours", "timeWindows must be a list");
  const parsed = input.map((w: unknown) => {
    const win = w as { from?: unknown; to?: unknown };
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
    return { from: win.from as string, to: win.to as string, a: from, b: to };
  });
  parsed.sort((x, y) => x.a - y.a);
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].a < parsed[i - 1].b) {
      throw new SharedAccessError("windows_overlap", "Two time windows overlap");
    }
  }
  return parsed.map(({ from, to }) => ({ from, to }));
}

/** A date given as ISO or as the house's `YYYY-MM-DDTHH:MM`, to epoch ms. */
export function parseInstant(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string")
    throw new SharedAccessError("invalid_date", `${field} is not a date`);
  // A date-time without an offset is read by Date as local time — the house's.
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new SharedAccessError("invalid_date", `${field} is not a date`);
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
  return windows.some((w) => {
    const a = parseHm(w.from);
    const b = parseHm(w.to);
    return a !== null && b !== null && m >= a && m < b;
  });
}

/** When the next window opens after `ts`, today or tomorrow. Null without windows. */
export function nextWindowOpening(windows: SharedAccessTimeWindow[], ts: number): number | null {
  if (windows.length === 0) return null;
  const starts = windows
    .map((w) => parseHm(w.from))
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);
  if (starts.length === 0) return null;
  const m = minuteOfDay(ts);
  const today = starts.find((s) => s > m);
  return today !== undefined ? atMinute(ts, today) : atMinute(ts, starts[0], 1);
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
