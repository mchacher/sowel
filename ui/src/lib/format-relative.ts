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
 * The suffixes were French in every copy (`j` for days) and stayed verbatim so
 * the rendered text would not change. That held while the output sat on its own
 * in a French-only corner; #839 puts it inside a translated sentence, where an
 * English tile would read "124 j ago". Passing `t` localises the four suffixes.
 * Called without it the output is byte-identical to before, so no existing
 * surface moves — those are the i18n pass this still defers to.
 */
export function formatRelative(
  iso: string | null,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const ms = parseReadingTime(iso);
  if (ms === null) return "";
  const unit = (key: string, fallback: string, value: number): string =>
    t ? t(`reading.age.${key}`, { count: value }) : fallback;

  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return unit("seconds", `${seconds}s`, seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return unit("minutes", `${minutes} min`, minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit("hours", `${hours} h`, hours);
  const days = Math.floor(hours / 24);
  return unit("days", `${days} j`, days);
}
