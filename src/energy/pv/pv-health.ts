/**
 * Is the array still performing? (spec 162)
 *
 * Spec 160 taught Sowel what a household's panels should produce in any given
 * hour. This notices when they stop producing it. A failed panel or a dead
 * micro-inverter channel is invisible on a production meter — output is lower,
 * but output is lower on a cloudy day too.
 *
 * Pure: no clock, no database, no events. Every rule here is a function from
 * numbers to a verdict, and the constants below are measured rather than
 * chosen, so they can be checked against the data that produced them.
 */

/** Local hours the ratio is measured on. Outside this band the noise doubles. */
export const MIDDAY_FROM = 10;
export const MIDDAY_TO = 16;

/**
 * Share of irradiance arriving as beam rather than scattered, above which an
 * hour is clear enough to judge on.
 *
 * The knee of a measured curve, not a round number. On the reference
 * installation's constant-capacity window, day-to-day noise against the number
 * of usable days:
 *
 * | criterion            | days | noise  | step detectable over 3 days |
 * | -------------------- | ---- | ------ | --------------------------- |
 * | midday, any weather  |  47  | 9.5 %  | 16.5 %                      |
 * | fraction > 0.65      |  43  | 5.9 %  | 10.3 %                      |
 * | **fraction > 0.75**  |  39  | 4.3 %  |  7.5 %                      |
 * | fraction > 0.80      |  32  | 3.6 %  |  6.2 %                      |
 *
 * Tightening to 0.80 buys 0.7 points of noise and costs seven days of the
 * thirty-nine, which slows the detector more than the precision speeds it.
 */
export const MIN_DIRECT_FRACTION = 0.75;

/** Below this many qualifying hours a day is an opinion, not a measurement. */
export const MIN_QUALIFYING_HOURS = 4;

/** Trailing qualifying days behind the normal. */
export const NORMAL_DAYS = 20;

/** Below this many, there is no normal and nothing is asserted. */
export const MIN_NORMAL_DAYS = 8;

/**
 * How far below the normal counts as a deficit.
 *
 * Deliberately not the noise floor. At 3σ over three days that floor is 7.5 %,
 * and alerting there would fire on the tail of ordinary variation several times
 * a season. Ten percent is still below one lost panel of eight (12.5 %), which
 * is the smallest fault worth waking someone for.
 */
export const ALERT_MARGIN = 0.1;

/** Consecutive qualifying days below the margin before anything is raised. */
export const ALERT_DAYS = 3;

export interface HealthHour {
  /** Local hour, 0 to 23. */
  hourLocal: number;
  /** Plane-of-array irradiance for the hour, W/m2. */
  poa: number;
  /** Measured production for the hour, W. */
  watts: number;
  /** Beam share of the irradiance, 0 to 1. Null on rows written before spec 162. */
  directFraction: number | null;
}

export interface DayRatio {
  /** Local date, YYYY-MM-DD. */
  day: string;
  ratio: number;
  hours: number;
  measuredWh: number;
  modelledWh: number;
}

/**
 * Is this hour clear enough, and central enough, to judge the array on?
 *
 * A null fraction is never clear. Rows written before migration 027 have none,
 * and treating "unknown" as "clear" would quietly admit every overcast hour in
 * the existing 45-day window the first time this ran.
 */
export function qualifies(hour: HealthHour): boolean {
  if (!Number.isInteger(hour.hourLocal)) return false;
  if (hour.hourLocal < MIDDAY_FROM || hour.hourLocal > MIDDAY_TO) return false;
  if (hour.directFraction === null || !Number.isFinite(hour.directFraction)) return false;
  if (hour.directFraction < MIN_DIRECT_FRACTION) return false;
  return (
    Number.isFinite(hour.poa) && hour.poa > 0 && Number.isFinite(hour.watts) && hour.watts >= 0
  );
}

/**
 * One day's performance ratio, or null when the day cannot support one.
 *
 * The denominator is the plane-of-array irradiance, **not** the model's own
 * prediction. That matters: POA depends only on geometry and weather, so the
 * nightly refit cannot move it. Were the model on both sides of the division, a
 * refit would shift the ratio on its own and the detector would jump at its own
 * shadow.
 *
 * The quotient therefore carries a unit (Wh per Wh/m2, an effective aperture)
 * and is not centred on 1. It is only ever compared with its own recent normal,
 * where the scale cancels.
 *
 * Null, never a low ratio, when the day is short of qualifying hours: too few
 * clear hours is missing information, not bad performance, and storing it as the
 * latter is how a monitoring feature learns to cry wolf every December.
 */
export function dailyRatio(day: string, hours: readonly HealthHour[]): DayRatio | null {
  const usable = hours.filter(qualifies);
  if (usable.length < MIN_QUALIFYING_HOURS) return null;

  const measuredWh = usable.reduce((sum, h) => sum + h.watts, 0);
  const modelledWh = usable.reduce((sum, h) => sum + h.poa, 0);
  if (!(modelledWh > 0)) return null;

  return { day, ratio: measuredWh / modelledWh, hours: usable.length, measuredWh, modelledWh };
}

/**
 * The reference the current days are judged against.
 *
 * Median, not mean: one anomalous day must not move the reference it is about to
 * be judged against. Over the trailing window only, and the caller is expected
 * to exclude the days under assessment — otherwise a sustained fault drags its
 * own baseline down and the alert never fires.
 */
export function rollingNormal(days: readonly DayRatio[]): number | null {
  const ratios = days
    .map((d) => d.ratio)
    .filter((r) => Number.isFinite(r) && r > 0)
    .slice(-NORMAL_DAYS)
    .sort((a, b) => a - b);

  if (ratios.length < MIN_NORMAL_DAYS) return null;

  const mid = Math.floor(ratios.length / 2);
  return ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];
}

export interface HealthVerdict {
  /** Null while there is no normal, or too little history to say anything. */
  normal: number | null;
  /** The most recent qualifying day, if there is one. */
  latest: DayRatio | null;
  /** True when the recent days sit below the normal by more than the margin. */
  alerting: boolean;
  /** How far below, as a fraction, on the assessed days. Null when not alerting. */
  deficit: number | null;
  /** The day the deficit started, when alerting. */
  since: string | null;
}

/**
 * Judge the recent days against the normal.
 *
 * Requires `ALERT_DAYS` **consecutive qualifying days** below the margin. Not
 * "3 of the last 5": a genuine fault is present every clear day, so demanding a
 * run costs nothing against a real failure and rejects the isolated bad day that
 * a single passing cloud bank at noon can produce.
 *
 * Days are expected oldest first.
 */
export function assess(days: readonly DayRatio[]): HealthVerdict {
  const latest = days.length > 0 ? days[days.length - 1] : null;

  // The normal excludes the days being judged, so a sustained fault cannot drag
  // down the very reference that would reveal it.
  const baseline = days.slice(0, Math.max(0, days.length - ALERT_DAYS));
  const normal = rollingNormal(baseline);
  if (normal === null) return { normal: null, latest, alerting: false, deficit: null, since: null };

  const assessed = days.slice(-ALERT_DAYS);
  if (assessed.length < ALERT_DAYS) {
    return { normal, latest, alerting: false, deficit: null, since: null };
  }

  const threshold = normal * (1 - ALERT_MARGIN);
  if (!assessed.every((d) => d.ratio < threshold)) {
    return { normal, latest, alerting: false, deficit: null, since: null };
  }

  const mean = assessed.reduce((sum, d) => sum + d.ratio, 0) / assessed.length;
  return {
    normal,
    latest,
    alerting: true,
    deficit: 1 - mean / normal,
    since: assessed[0].day,
  };
}

export interface DetectionSpeed {
  /** Clear days needed to confirm the loss of one panel of `panels`. */
  onePanelDays: number;
  /** Clear days needed to confirm the loss of a micro-inverter, two channels. */
  oneInverterDays: number;
  /** Qualifying days seen over the observed window. */
  qualifyingDays: number;
  /** Calendar days that window covered. */
  windowDays: number;
}

/**
 * How quickly a fault would show, **at the rate this installation is actually
 * getting clear days** — not at the summer rate.
 *
 * A health feature that reports the same confidence in December as in July is
 * lying. Fewer clear midday hours means fewer qualifying days means a slower
 * detector, and the household should be told that rather than left to assume the
 * silence means all is well.
 *
 * Returns null when no qualifying day has been seen at all: the honest answer is
 * "cannot say yet", never an infinity dressed up as a number.
 */
export function detectionSpeed(
  qualifyingDays: number,
  windowDays: number,
  panels: number,
): DetectionSpeed | null {
  if (qualifyingDays <= 0 || windowDays <= 0 || panels <= 0) return null;

  const clearDaysNeeded = (lossFraction: number): number => {
    // Below the margin nothing is ever raised, however long one waits.
    if (lossFraction <= ALERT_MARGIN) return Number.POSITIVE_INFINITY;
    return ALERT_DAYS;
  };

  const perQualifyingDay = windowDays / qualifyingDays;
  const toCalendar = (clear: number): number =>
    Number.isFinite(clear) ? Math.ceil(clear * perQualifyingDay) : Number.POSITIVE_INFINITY;

  return {
    onePanelDays: toCalendar(clearDaysNeeded(1 / panels)),
    oneInverterDays: toCalendar(clearDaysNeeded(2 / panels)),
    qualifyingDays,
    windowDays,
  };
}
