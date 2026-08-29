/**
 * The label shown between the period navigator's arrows (issue #730).
 *
 * Lives apart from the component so both the Energy and Analyse selectors get
 * the same wording, and so it can be tested without rendering. It takes the
 * locale rather than reading i18n itself: the energy copy of this used to pin
 * `"fr-FR"`, which is exactly the bug.
 */

export type SelectorPeriod = "day" | "week" | "month" | "year";

export function formatDateLabel(
  dateStr: string,
  period: SelectorPeriod,
  locale: string,
): string {
  const d = new Date(dateStr + "T12:00:00");
  switch (period) {
    case "day":
      return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
    case "week": {
      const start = new Date(d);
      const dayOfWeek = start.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start.setDate(start.getDate() + mondayOffset);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const startLabel = start.toLocaleDateString(locale, { day: "numeric", month: "short" });
      const endLabel = end.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      return `${startLabel} - ${endLabel}`;
    }
    case "month":
      return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
    case "year":
      return d.getFullYear().toString();
  }
}
