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

/**
 * Trailing qualifying days behind the reference.
 *
 * A year, in effect: this installation produces about 230 qualifying days in
 * sixteen months. That length is not comfort, it is the requirement — see
 * {@link REFERENCE_QUANTILE}.
 */
export const NORMAL_DAYS = 180;

/** Below this many, there is no reference and nothing is asserted. */
export const MIN_NORMAL_DAYS = 30;

/**
 * Where in the trailing window the reference sits.
 *
 * **Not the median, and this is the whole design.** A median follows the array
 * down: a fault that fills half the window becomes the reference, and the
 * detector quietly accepts it as the new normal. Validated against a real
 * eight-month single-panel outage on the reference installation, with the repair
 * date known:
 *
 * | reference                  | fault days covered | false-alert days |
 * | -------------------------- | ------------------ | ---------------- |
 * | median over 20 days        | **7 %**            | 2 %              |
 * | median over 60 days        | 12 %               | 2 %              |
 * | **80th centile, 180 days** | **91 %**           | **2 %**          |
 * | 90th centile, all history  | 95 %               | 10 %             |
 *
 * A fault occupying up to a fifth of the window cannot move an 80th centile; it
 * moves a median as soon as it occupies half. The higher the centile the better
 * the coverage and the worse the false alarms, and 0.8 is where the two curves
 * cross on the measured data.
 */
export const REFERENCE_QUANTILE = 0.8;

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

/**
 * Calendar days over which "how many clear days have we had" is observed.
 *
 * Its own constant, chosen for the observation window on its own merits. It was
 * previously derived as `min(NORMAL_DAYS + ALERT_DAYS, WINDOW_DAYS)`, which made
 * sense when the reference window was 20 days and silently became a constant 45
 * when the reference grew to 180 — so in early December the card counted clear
 * days back into October and reported autumn's confidence. A fortnight is short
 * enough that the answer describes the weather the household is actually in.
 */
export const DETECTION_WINDOW_DAYS = 14;

/**
 * Beam share of an hour's irradiance, or null when there is nothing to share.
 *
 * One implementation for the live path and the backfill: the stored fraction
 * decides whether a past day qualifies, and two drifting copies would make
 * backfilled hours qualify differently from live ones for the same weather.
 */
export function beamFraction(direct: number, diffuse: number): number | null {
  const total = direct + diffuse;
  if (!Number.isFinite(total) || total <= 0) return null;
  return direct / total;
}

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
  /** Measured Wh per Wh/m2 of irradiation. Meaningful only against its normal. */
  ratio: number;
  hours: number;
  measuredWh: number;
  /**
   * Irradiation on the plane of the array, Wh/m2 — **not** an energy.
   *
   * Named for what it is rather than "modelled Wh": the quotient above carries a
   * unit, and calling the denominator watt-hours would invite the first person to
   * read the column in a year to compare it with the numerator.
   */
  irradiationWhM2: number;
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
  const irradiationWhM2 = usable.reduce((sum, h) => sum + h.poa, 0);
  if (!(irradiationWhM2 > 0)) return null;

  return {
    day,
    ratio: measuredWh / irradiationWhM2,
    hours: usable.length,
    measuredWh,
    irradiationWhM2,
  };
}

/**
 * What the array is capable of, from its own recent history.
 *
 * A high centile of the trailing window rather than its middle. The difference
 * is not a refinement: measured against a real eight-month outage, a 20-day
 * median caught 7 % of it and this catches 91 %. See {@link REFERENCE_QUANTILE}.
 *
 * "Capable of" rather than "typically does" is the right question here. A dirty
 * fortnight should not become the standard the array is held to, and a faulty
 * month certainly should not.
 */
export function rollingNormal(days: readonly DayRatio[]): number | null {
  const ratios = days
    .map((d) => d.ratio)
    .filter((r) => Number.isFinite(r) && r > 0)
    .slice(-NORMAL_DAYS)
    .sort((a, b) => a - b);

  if (ratios.length < MIN_NORMAL_DAYS) return null;

  return ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * REFERENCE_QUANTILE))];
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

  // Every day before the ones under assessment. No gap is needed: a high centile
  // cannot be dragged down by the handful of days being judged, which is exactly
  // what a median could not promise.
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

/**
 * Should a standing alert be cleared?
 *
 * Judged against the normal **as it was when the alert was raised**, never a
 * freshly computed one. A rolling median absorbs a sustained fault: once the bad
 * days fill the window it becomes the degraded level, the deficit vanishes on
 * paper, and the household is told the panels recovered while they are still
 * dead. Measured on the real rule, that took fourteen clear days.
 *
 * Two states that both look like "not alerting" are kept apart here, because
 * only one of them is good news:
 *
 * - a qualifying day came back above the threshold — recovered, clear it;
 * - there is no recent qualifying day at all — the detector has gone blind, from
 *   a fortnight of overcast or a meter that stopped reporting. Losing the ability
 *   to measure is not recovery, and announcing it as such is worse than silence.
 */
export function shouldResolve(frozenNormal: number, days: readonly DayRatio[]): boolean {
  if (!Number.isFinite(frozenNormal) || frozenNormal <= 0) return false;

  // Symmetric with the raise: it took ALERT_DAYS consecutive qualifying days to
  // say "faulty", and it takes as many to say "recovered". One day was enough
  // before, and for a fault sitting near the margin — one degraded optimizer,
  // an 11 % deficit against a 10 % threshold on a 4.3 % noise floor — a single
  // lucky day resolved the alert, three unlucky ones re-raised it, and the
  // household got a fresh raise/recovery pair every few clear days all season.
  // A real repair clears this easily: it jumps the ratio by the size of the
  // fault, far above the threshold, on every following clear day.
  const recent = days.slice(-ALERT_DAYS);
  if (recent.length < ALERT_DAYS) return false;
  const threshold = frozenNormal * (1 - ALERT_MARGIN);
  return recent.every((d) => d.ratio >= threshold);
}

/** How far below the frozen normal the recent days sit, for the standing alert. */
export function deficitAgainst(frozenNormal: number, days: readonly DayRatio[]): number {
  const assessed = days.slice(-ALERT_DAYS);
  if (assessed.length === 0 || !(frozenNormal > 0)) return 0;
  const mean = assessed.reduce((sum, d) => sum + d.ratio, 0) / assessed.length;
  return Math.max(0, 1 - mean / frozenNormal);
}

export interface DetectionSpeed {
  /**
   * Smallest loss this rule can confirm at all, as a fraction.
   *
   * Anything shallower sits inside `ALERT_MARGIN` and is never raised, however
   * long one waits. Saying so is the honest form of "how sensitive is this".
   */
  minDetectableLoss: number;
  /** The rule's `ALERT_DAYS` clear days, translated to calendar days at the observed rate. */
  calendarDays: number;
  /** Qualifying days seen over the observed window. */
  qualifyingDays: number;
  /** Calendar days that window covered. */
  windowDays: number;
}

/**
 * How sensitive the detector is, and how long it would take, **at the rate this
 * installation is actually getting clear days** — not at the summer rate.
 *
 * A health feature that reports the same confidence in December as in July is
 * lying. Fewer clear midday hours means fewer qualifying days means a slower
 * detector, and the household should be told that rather than left to assume the
 * silence means all is well.
 *
 * Deliberately expressed as "a loss of more than X shows in Y days", not as
 * per-panel figures. Naming a number of days for one lost panel would need the
 * panel count, which is nowhere declared — deriving it by dividing the peak
 * power by an assumed 500 Wc per panel produced a confident fiction, and on a
 * 5 kWc array it made a single panel fall under the margin so the card printed a
 * dash where a duration belonged.
 *
 * Returns null when no qualifying day has been seen at all: the honest answer is
 * "cannot say yet", never an infinity dressed up as a number.
 */
export function detectionSpeed(qualifyingDays: number, windowDays: number): DetectionSpeed | null {
  if (qualifyingDays <= 0 || windowDays <= 0) return null;

  const perQualifyingDay = windowDays / qualifyingDays;
  return {
    minDetectableLoss: ALERT_MARGIN,
    calendarDays: Math.ceil(ALERT_DAYS * perQualifyingDay),
    qualifyingDays,
    windowDays,
  };
}
