/**
 * UPS status enum (spec 156) — mirrors `src/shared/constants.ts`.
 *
 * The UI cannot import from the backend, so the closed set is redeclared here.
 * The array order IS the severity order, ascending.
 */
export const UPS_STATUS_VALUES = [
  "online",
  "on_battery",
  "bypass",
  "overload",
  "low_battery",
  "offline",
] as const;

export type UpsStatus = (typeof UPS_STATUS_VALUES)[number];
