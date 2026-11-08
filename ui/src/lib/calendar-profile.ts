import type { CalendarProfile } from "../types";

/**
 * The built-in week profiles seeded by migration 001, by id, with the name the
 * seed gave them (#1151). Their identity is the id; the seeded name is French,
 * so the UI shows them in the viewer's language instead.
 */
const BUILT_IN_PROFILES: Record<string, { seededName: string; key: string }> = {
  travail: { seededName: "Travail", key: "calendar.builtInProfile.travail" },
  vacances: { seededName: "Vacances", key: "calendar.builtInProfile.vacances" },
};

/**
 * A week profile's name in the viewer's language. Only a built-in profile that
 * still carries its seeded name is translated: a name someone set themselves
 * (there is no rename API, but the database can be edited) is theirs to keep.
 */
export function calendarProfileLabel(
  profile: Pick<CalendarProfile, "id" | "name" | "builtIn">,
  t: (key: string) => string,
): string {
  const builtIn = profile.builtIn ? BUILT_IN_PROFILES[profile.id] : undefined;
  if (builtIn && profile.name === builtIn.seededName) return t(builtIn.key);
  return profile.name;
}
