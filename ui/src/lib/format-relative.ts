import { parseReadingTime } from "../../../src/shared/reading-freshness";

/**
 * "how long ago", compactly: `45s`, `12 min`, `3 h`, `2 j`.
 *
 * One implementation for what were four byte-identical copies, in
 * LiveSubmeterBreakdown, LiveEnergyPage, EquipmentStatusBadge and
 * EnergyDataPanel (#832 review). Each carried its own copy of the timestamp
 * parser too, the same one shared/ now owns, which is what made this worth
 * lifting rather than leaving: the module arguing for one implementation of
 * the freshness rule was sitting beside four copies of its own parser.
 *
 * The `j` suffix is French in every copy and is kept verbatim so the rendered
 * text does not change. It predates this and belongs to an i18n pass, not here.
 */
export function formatRelative(iso: string | null): string {
  const ms = parseReadingTime(iso);
  if (ms === null) return "";
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}
