/**
 * Fitting the PV model from history that already exists (spec 161).
 *
 * Spec 160 learns an array from production it watches arrive, which takes about
 * twelve days. The household has usually been producing for months, and Sowel
 * already holds that history — this pairs it with the irradiance of the same
 * hours and hands the result to the same `fitModel`.
 *
 * Pure on purpose. Every defect spec 160's reviews found in this area sat in
 * code that needed a database and a clock to run; the window and the pairing
 * need neither, so they live here and are tested directly.
 */

import type { SolarPlane, SolarProfile } from "../../shared/types.js";
import { planeOfArray, solarPosition, toDni } from "./solar-geometry.js";
import type { PvSample } from "./pv-model.js";

/** One hour of the published history. Same shape as the forward series. */
export interface HistoryHour {
  /** UTC instant the hour starts. */
  t: string;
  direct: number | null;
  diffuse: number | null;
  temp: number | null;
}

/** Why the window ended up where it did, so the panel can say so. */
export type WindowBound = "window" | "declaration";

export interface BackfillWindow {
  fromMs: number;
  toMs: number;
  boundedBy: WindowBound;
}

/**
 * The window a backfill may reach over.
 *
 * Two bounds, shorter wins. The rolling window because the hourly shape moves
 * with the season — six weeks of drift cost 149 W against 101 W on the reference
 * installation, so older history is not free. The declared date because fitting
 * across a capacity change produces a gain that describes neither array: 325 W
 * against 186 W on a real +1 kWc addition.
 *
 * `since` only ever shortens. A date older than the window, in the future, or
 * unparseable is discarded rather than trusted — it can only come from a text
 * field, and the safe reading of a bad one is "no extra information".
 */
export function resolveWindow(
  since: string | undefined,
  windowDays: number,
  now: number,
): BackfillWindow {
  const floor = now - windowDays * 86_400_000;
  const declared = since ? Date.parse(since) : Number.NaN;

  if (!Number.isFinite(declared) || declared <= floor || declared >= now) {
    return { fromMs: floor, toMs: now, boundedBy: "window" };
  }
  return { fromMs: declared, toMs: now, boundedBy: "declaration" };
}

/** Start of the hour an instant falls in. */
function hourStart(ms: number): number {
  return ms - (ms % 3_600_000);
}

export interface PairedSample extends PvSample {
  /** UTC ISO of the hour start, the key rows are upserted on. */
  at: string;
}

/**
 * Pair recorded production with the irradiance of the same hour.
 *
 * Deliberately the same arithmetic as the live `collectSample`: hour start in
 * UTC, sun position taken at mid-hour so the geometry represents the hour rather
 * than its edge, `hour_local` from the hour start. A backfilled row that
 * disagreed with a live one would make the model depend on how the row happened
 * to be produced.
 *
 * An hour is dropped, never zeroed, when either side is missing. A meter that
 * was offline did not produce zero; it produced something nobody recorded, and
 * feeding zero to the fit would teach the array to expect nothing.
 */
export function pairHistory(params: {
  /** Hour start (ms, UTC) -> mean watts recorded for that hour. */
  production: ReadonlyMap<number, number>;
  hours: readonly HistoryHour[];
  planes: readonly SolarPlane[];
  latitude: number;
  longitude: number;
  window: BackfillWindow;
  /** Declared total, for the impossible-reading ceiling. Zero disables it. */
  peakWc: number;
}): PairedSample[] {
  const { production, hours, planes, latitude, longitude, window, peakWc } = params;
  if (planes.length === 0) return [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

  const irradiance = new Map<number, HistoryHour>();
  for (const hour of hours) {
    const ms = Date.parse(hour.t);
    if (!Number.isFinite(ms)) continue;
    irradiance.set(hourStart(ms), hour);
  }

  const ceiling = peakWc > 0 ? peakWc * 1.3 : Number.POSITIVE_INFINITY;
  const out: PairedSample[] = [];

  for (const [rawMs, watts] of production) {
    const ms = hourStart(rawMs);
    if (ms < window.fromMs || ms >= window.toMs) continue;
    if (!Number.isFinite(watts) || watts < 0) continue;
    // The reference installation's history carries 31 kW readings on a 4 kWc
    // array, always both channels of one micro-inverter at once. The live path
    // drops these before they are stored; so does this one.
    if (watts > ceiling) continue;

    const hour = irradiance.get(ms);
    if (!hour || hour.direct === null || hour.diffuse === null) continue;

    const sun = solarPosition(new Date(ms + 1_800_000), latitude, longitude);
    const poa = planeOfArray(planes, toDni(hour.direct, sun.elevationRad), hour.diffuse, sun);
    // Night, or a plane the sun never reached this hour. `closeHour` applies the
    // same test before it writes.
    if (poa <= 0) continue;

    out.push({
      at: new Date(ms).toISOString(),
      hourLocal: new Date(ms).getHours(),
      poa,
      tempC: hour.temp ?? 25,
      watts,
    });
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/** Total declared peak power of a profile, tolerating a malformed one. */
export function profilePeakWc(profile: SolarProfile | null | undefined): number {
  return (profile?.planes ?? []).reduce(
    (sum, p) => sum + (Number.isFinite(p.peakWc) ? p.peakWc : 0),
    0,
  );
}
