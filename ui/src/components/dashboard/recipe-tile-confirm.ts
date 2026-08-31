import type { RecipeTileDef } from "../../types";

/**
 * Spec 171 — does firing this tile from its card ask for a confirmation first?
 *
 * Two sources, in order:
 *  - the instance's own parameter, when the recipe named one in `confirmParam`
 *    and the user has answered it. This is the recipe's equivalent of the
 *    toggle a gate equipment carries (spec 146): the person who lives with the
 *    automation decides, not the package author;
 *  - failing that, the package's `confirm` declaration.
 *
 * A boolean slot reaches `params` as a real boolean, but a hand-written value
 * or an older instance may carry the string — both are read, and anything else
 * (absent, null, empty) means "the user never said", which falls back.
 *
 * Pure and side-effect free so it can be unit-tested without React, as
 * `gateNeedsConfirm` is.
 */
export function tileNeedsConfirm(
  tile: RecipeTileDef,
  params: Record<string, unknown> | undefined,
): boolean {
  const chosen = tile.confirmParam ? params?.[tile.confirmParam] : undefined;
  if (chosen === true || chosen === "true") return true;
  if (chosen === false || chosen === "false") return false;
  return tile.confirm === true;
}
