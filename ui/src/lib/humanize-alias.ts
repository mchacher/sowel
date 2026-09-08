/**
 * Spec 177 — the fallback label for a binding alias no dictionary entry
 * covers. Presentation only: the alias itself is never changed.
 */
/** `airSwingUD` → "Air swing UD", `fanLevel` → "Fan level", `pellet_sensor` → "Pellet sensor". */
export function humanizeAlias(alias: string): string {
  const words = alias
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    // An all-caps token is an acronym and keeps its case; anything else is a
    // plain word.
    .map((w) => (w === w.toUpperCase() && w.length > 1 ? w : w.toLowerCase()));
  const first = words[0] ?? "";
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}
