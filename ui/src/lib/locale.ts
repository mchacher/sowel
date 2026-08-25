/**
 * The BCP 47 tag to format dates and numbers with.
 *
 * Not `i18n.language` directly, and not an equality test against `"fr"`. The
 * language detector stores what the browser reports, which is `"fr-FR"`;
 * i18next strips the region when it looks up translations, so a component that
 * compared for equality rendered French text beside English weekdays and an
 * American date. That shipped in three components before anyone noticed.
 */
export function dateLocale(language: string | undefined): string {
  return (language ?? "").toLowerCase().startsWith("fr") ? "fr-FR" : "en-US";
}
