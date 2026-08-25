/**
 * Solar geometry for the PV production forecast (spec 160).
 *
 * Pure: no clock, no IO. Everything here is verifiable against hand-computed
 * angles, which matters because a sign error in this file is invisible in the
 * output — it just makes the forecast quietly worse.
 */

import SunCalc from "suncalc";
import type { SolarPlane } from "../../shared/types.js";

/**
 * Below this elevation the direct-to-normal conversion is refused.
 *
 * `sin(elevation)` is the denominator: at 1 degree it is 0.017, so a 10 W/m2
 * horizontal reading would become 570 W/m2 of beam. Refracted sunlight that
 * close to the horizon carries no usable energy anyway.
 */
export const MIN_ELEVATION_RAD = (3 * Math.PI) / 180;

/**
 * Above this elevation the conversion is trusted in full; between the two it is
 * ramped to zero.
 *
 * A hard cut-off would make one sunrise or sunset hour flip between diffuse-only
 * and a large beam term as the season walks its mid-hour elevation across the
 * threshold — a step of several hundred watts in exactly the edge hours the
 * hourly shape reads as shading.
 */
export const FULL_ELEVATION_RAD = (5 * Math.PI) / 180;

export interface SunPosition {
  /** Radians above the horizon. Negative at night. */
  elevationRad: number;
  /** Radians clockwise from north, matching the azimuth a household declares. */
  azimuthRad: number;
}

/**
 * Sun position for an instant and a location.
 *
 * `suncalc` reports azimuth in radians from **south**, growing westward. The
 * whole of the rest of this file, and every azimuth a household types, uses the
 * compass convention where south is 180. Converting here, once, is what keeps
 * that confusion out of the model.
 */
export function solarPosition(when: Date, latitude: number, longitude: number): SunPosition {
  const pos = SunCalc.getPosition(when, latitude, longitude);
  let azimuthRad = pos.azimuth + Math.PI;
  const twoPi = 2 * Math.PI;
  azimuthRad = ((azimuthRad % twoPi) + twoPi) % twoPi;
  return { elevationRad: pos.altitude, azimuthRad };
}

/**
 * Direct radiation from the horizontal plane to normal-to-the-sun.
 *
 * Open-Meteo serves `direct_radiation` on the horizontal plane. Treating it as
 * beam irradiance under-estimates a tilted plane at low sun, and during the
 * spec 160 study it manufactured a fake efficiency peak at 18 h that looked for
 * a while like a real property of the site.
 */
export function toDni(directHorizontal: number, elevationRad: number): number {
  if (!Number.isFinite(directHorizontal) || directHorizontal <= 0) return 0;
  if (elevationRad < MIN_ELEVATION_RAD) return 0;
  const dni = directHorizontal / Math.sin(elevationRad);
  if (elevationRad >= FULL_ELEVATION_RAD) return dni;
  const ramp = (elevationRad - MIN_ELEVATION_RAD) / (FULL_ELEVATION_RAD - MIN_ELEVATION_RAD);
  return dni * ramp;
}

/** Cosine of the angle between the sun and a plane's normal. */
function cosIncidence(plane: SolarPlane, sun: SunPosition): number {
  const tilt = (plane.tiltDeg * Math.PI) / 180;
  const planeAzimuth = (plane.azimuthDeg * Math.PI) / 180;
  return (
    Math.cos(tilt) * Math.sin(sun.elevationRad) +
    Math.sin(tilt) * Math.cos(sun.elevationRad) * Math.cos(sun.azimuthRad - planeAzimuth)
  );
}

/**
 * Plane-of-array irradiance, in W/m2, weighted by each plane's share of the
 * declared peak power.
 *
 * Each plane is clipped on its own with `max(0, cos theta)` before the sum. That
 * clipping is the entire reason a plane list is not equivalent to one averaged
 * plane: summed without it, two opposite planes cancel into something that
 * behaves like a single plane facing nowhere, and an east/west array reads as
 * flat.
 *
 * The diffuse term uses the isotropic sky view factor `(1 + cos tilt) / 2`:
 * a flat plane sees the whole sky, a vertical one half of it.
 */
export function planeOfArray(
  planes: readonly SolarPlane[],
  dni: number,
  diffuse: number,
  sun: SunPosition,
): number {
  const totalWc = planes.reduce((sum, p) => sum + p.peakWc, 0);
  if (totalWc <= 0) return 0;

  const safeDiffuse = Number.isFinite(diffuse) && diffuse > 0 ? diffuse : 0;

  let poa = 0;
  for (const plane of planes) {
    const tilt = (plane.tiltDeg * Math.PI) / 180;
    const beam = dni * Math.max(0, cosIncidence(plane, sun));
    const sky = safeDiffuse * ((1 + Math.cos(tilt)) / 2);
    poa += (plane.peakWc / totalWc) * (beam + sky);
  }
  return poa;
}

/** Total declared peak power. Zero for an empty or malformed profile. */
export function totalPeakWc(planes: readonly SolarPlane[]): number {
  return planes.reduce((sum, p) => sum + (Number.isFinite(p.peakWc) ? p.peakWc : 0), 0);
}
