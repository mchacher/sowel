/**
 * The PV production model (spec 160).
 *
 * Deliberately unremarkable: a scalar gain and one coefficient per local hour,
 * refit on a rolling window. Measured against three alternatives on 92 days of
 * production data, it beat a physical model of the array (158 W of hourly error
 * against 310 W) and a non-negative fit over a dictionary of candidate planes
 * (323 W). Pure arithmetic, no ML runtime, in keeping with the arbiter
 * roadmap's guardrails.
 */

/** Temperature coefficient of crystalline silicon, per degree above 25 C. */
export const GAMMA_PER_C = -0.004;

/** Reference cell temperature the coefficient is quoted against. */
export const REFERENCE_TEMP_C = 25;

/** Below this many usable daylight samples, no model is produced at all. */
export const MIN_SAMPLES = 120;

/** Below this many samples for a given local hour, that hour falls back to 1. */
export const MIN_SAMPLES_PER_HOUR = 5;

/**
 * A sample above the declared peak power by more than this factor is physically
 * impossible and excluded from the fit.
 *
 * The margin is not slack for a generous inverter: panels genuinely exceed
 * nameplate on a cold bright day. It is there to catch the other thing, the
 * 12 kW to 31 kW readings the reference installation's history contains on
 * panels rated 500 Wc, always both channels of one micro-inverter at once.
 */
export const IMPOSSIBLE_FACTOR = 1.3;

export interface PvSample {
  /** Local hour, 0 to 23. The shape is indexed on it. */
  hourLocal: number;
  /** Plane-of-array irradiance, W/m2. */
  poa: number;
  /** Air temperature, °C. */
  tempC: number;
  /** Measured production, W. */
  watts: number;
}

export interface PvPoint {
  hourLocal: number;
  poa: number;
  tempC: number;
}

export interface PvModel {
  /** Watts per W/m2 of plane-of-array irradiance, at the reference temperature. */
  gain: number;
  /** Local hour -> efficiency relative to the array's own best hour. */
  shape: Record<number, number>;
  fittedAt: string;
  samples: number;
}

/** Irradiance corrected for cell temperature. */
function effectiveIrradiance(poa: number, tempC: number): number {
  if (!Number.isFinite(poa) || poa <= 0) return 0;
  const temp = Number.isFinite(tempC) ? tempC : REFERENCE_TEMP_C;
  return poa * (1 + GAMMA_PER_C * (temp - REFERENCE_TEMP_C));
}

function usable(samples: readonly PvSample[], peakWc: number): PvSample[] {
  const ceiling = peakWc > 0 ? peakWc * IMPOSSIBLE_FACTOR : Number.POSITIVE_INFINITY;
  return samples.filter(
    (s) =>
      Number.isFinite(s.watts) &&
      s.watts >= 0 &&
      s.watts <= ceiling &&
      effectiveIrradiance(s.poa, s.tempC) > 0 &&
      Number.isInteger(s.hourLocal) &&
      s.hourLocal >= 0 &&
      s.hourLocal <= 23,
  );
}

/** Ratio of produced watts to effective irradiance, per local hour. */
function ratiosByHour(samples: readonly PvSample[]): Map<number, number> {
  const num = new Map<number, number>();
  const den = new Map<number, number>();
  const count = new Map<number, number>();

  for (const s of samples) {
    const eff = effectiveIrradiance(s.poa, s.tempC);
    num.set(s.hourLocal, (num.get(s.hourLocal) ?? 0) + s.watts);
    den.set(s.hourLocal, (den.get(s.hourLocal) ?? 0) + eff);
    count.set(s.hourLocal, (count.get(s.hourLocal) ?? 0) + 1);
  }

  const ratios = new Map<number, number>();
  for (const [hour, d] of den) {
    if (d <= 0) continue;
    if ((count.get(hour) ?? 0) < MIN_SAMPLES_PER_HOUR) continue;
    ratios.set(hour, (num.get(hour) ?? 0) / d);
  }
  return ratios;
}

/**
 * Fit the gain and the hourly shape.
 *
 * The two are separated on purpose, and the separation is measured: on the
 * reference installation the normalised shape was **identical** before and after
 * a real +1 kW addition, only the scale moved. That is what lets a declared
 * capacity change re-estimate the gain alone (FR7) instead of throwing away six
 * weeks of learning about the site.
 *
 * `shape` is normalised on its best hour, so it reads as an efficiency relative
 * to what this array manages when nothing is in its way. On the reference site
 * it came out at 53 % at 08 h and 61 % at 20 h — the owner's trees — and 85 %
 * between 13 h and 15 h, which is thermal derating at the hottest hours.
 *
 * Returns null below {@link MIN_SAMPLES} rather than a model fitted on noise.
 */
export function fitModel(
  samples: readonly PvSample[],
  peakWc: number,
  now: Date = new Date(),
): PvModel | null {
  const clean = usable(samples, peakWc);
  if (clean.length < MIN_SAMPLES) return null;

  const ratios = ratiosByHour(clean);
  if (ratios.size === 0) return null;

  const best = Math.max(...ratios.values());
  if (!(best > 0)) return null;

  const shape: Record<number, number> = {};
  for (const [hour, ratio] of ratios) shape[hour] = ratio / best;

  return {
    gain: best,
    shape,
    fittedAt: now.toISOString(),
    samples: clean.length,
  };
}

/**
 * Re-estimate the gain, keeping the shape.
 *
 * What a declared capacity change calls. On the measured +1 kW addition this
 * took the hourly error from 523 W to 253 W after three days, where waiting for
 * the rolling window to drift would have taken six weeks.
 *
 * Below the sample floor the old gain is kept: a noisy replacement is worse than
 * a stale one that is about to be refit anyway.
 */
export function refitGainOnly(
  model: PvModel,
  samples: readonly PvSample[],
  peakWc: number,
  now: Date = new Date(),
): PvModel {
  const clean = usable(samples, peakWc);
  if (clean.length < MIN_SAMPLES_PER_HOUR) return model;

  let num = 0;
  let den = 0;
  for (const s of clean) {
    const shape = model.shape[s.hourLocal];
    if (shape === undefined || shape <= 0) continue;
    num += s.watts;
    den += shape * effectiveIrradiance(s.poa, s.tempC);
  }
  if (den <= 0) return model;

  return { ...model, gain: num / den, fittedAt: now.toISOString(), samples: clean.length };
}

/**
 * Expected production in watts.
 *
 * An hour the model never learned falls back to a coefficient of 1 rather than
 * to zero: a winter dawn the summer window never saw should read as "as good as
 * this array gets", not as "the panels are off".
 */
export function predict(model: PvModel, point: PvPoint, peakWc: number): number {
  const eff = effectiveIrradiance(point.poa, point.tempC);
  if (eff <= 0) return 0;

  const shape = model.shape[point.hourLocal] ?? 1;
  const watts = model.gain * shape * eff;
  if (!Number.isFinite(watts) || watts <= 0) return 0;

  return peakWc > 0 ? Math.min(watts, peakWc) : watts;
}

/**
 * Expected production before any model exists, from the declared array alone.
 *
 * Standard test conditions: a panel rated `peakWc` produces that at 1000 W/m2
 * on its plane. No site knowledge at all — no shading, no soiling, no ageing —
 * so it reads high, and the caller must label it as provisional rather than
 * present it as a forecast.
 *
 * It exists because eleven days of an empty panel is indistinguishable from a
 * broken feature, and a household that has just declared its array deserves to
 * see something move.
 */
export function clearSkyEstimate(poa: number, tempC: number, peakWc: number): number {
  const eff = effectiveIrradiance(poa, tempC);
  if (eff <= 0 || peakWc <= 0) return 0;
  return Math.min((eff / 1000) * peakWc, peakWc);
}
