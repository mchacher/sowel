/**
 * Validation of the declared array (spec 160, FR9).
 *
 * Shared between the API route and the UI form so a rejection reads the same in
 * both places, and so a profile can never reach the model through one door that
 * the other would have refused.
 */

import type { SolarPlane, SolarProfile } from "../../shared/types.js";

export interface SolarProfileError {
  /** Index in `planes`, or -1 for a whole-profile problem. */
  plane: number;
  field: "tiltDeg" | "azimuthDeg" | "peakWc" | "planes";
  message: string;
}

export const MAX_TILT_DEG = 90;
export const MAX_PEAK_WC = 1_000_000;

function validatePlane(plane: SolarPlane, index: number): SolarProfileError[] {
  const errors: SolarProfileError[] = [];

  if (!Number.isFinite(plane.tiltDeg) || plane.tiltDeg < 0 || plane.tiltDeg > MAX_TILT_DEG) {
    errors.push({
      plane: index,
      field: "tiltDeg",
      message: `Tilt must be between 0 and ${MAX_TILT_DEG} degrees`,
    });
  }

  // 360 is refused rather than folded to 0: a household that typed it meant
  // north and should see that confirmed, not silently reinterpreted.
  if (!Number.isFinite(plane.azimuthDeg) || plane.azimuthDeg < 0 || plane.azimuthDeg >= 360) {
    errors.push({
      plane: index,
      field: "azimuthDeg",
      message: "Orientation must be between 0 and 359 degrees, where 180 is due south",
    });
  }

  if (!Number.isFinite(plane.peakWc) || plane.peakWc <= 0 || plane.peakWc > MAX_PEAK_WC) {
    errors.push({
      plane: index,
      field: "peakWc",
      message: "Peak power must be a positive number of watts",
    });
  }

  return errors;
}

/**
 * Validate a profile.
 *
 * An **empty plane list is not an error**: it is how a household turns the
 * feature off, and the caller treats it as an absent profile. Only a plane that
 * is present and wrong is refused, so a half-filled form never silently
 * disables a working forecast.
 */
export function validateSolarProfile(profile: SolarProfile): SolarProfileError[] {
  if (!Array.isArray(profile.planes)) {
    return [{ plane: -1, field: "planes", message: "Planes must be a list" }];
  }
  return profile.planes.flatMap(validatePlane);
}

/** True when the profile carries at least one plane and no error. */
export function isActiveSolarProfile(profile: SolarProfile | undefined): profile is SolarProfile {
  if (!profile || !Array.isArray(profile.planes) || profile.planes.length === 0) return false;
  return validateSolarProfile(profile).length === 0;
}

/** The eight cardinals the form offers, as compass bearings. */
export const CARDINAL_AZIMUTHS: Record<string, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};
