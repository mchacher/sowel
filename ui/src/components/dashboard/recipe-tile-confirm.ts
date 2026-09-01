import type { EquipmentWithDetails, RecipeTileDef } from "../../types";

/**
 * Spec 171 — does firing this tile from its card ask for a confirmation first?
 *
 * Three sources, and the order is the whole point. "Ask before acting" was
 * being decided in three places for one physical gate, and two of them could
 * disagree: a user could turn "Confirmation before action" on for the Portail
 * equipment (spec 146) and still get a tile that fired on a tap.
 *
 *  1. **The equipment itself**, when the recipe named the slot that reaches it
 *     in `tile.confirmFrom` and that slot resolves to an equipment we know.
 *     Its `requireConfirmation` then decides on its own — `confirm` and
 *     `confirmParam` are not consulted at all. That is what makes the answer
 *     given ONCE, on the equipment, for every surface that actuates it.
 *  2. The instance's own parameter, when the recipe named one in
 *     `confirmParam` and the user has answered it.
 *  3. Failing both, the package's `confirm` declaration.
 *
 * Steps 2 and 3 are not dead weight: a recipe whose action touches several
 * equipments, or none directly, or does more than an equipment's own order,
 * cannot derive anything — and it is the only one that knows, which is why
 * `confirmFrom` is a declaration rather than something the core infers.
 *
 * The derivation deliberately reads `requireConfirmation` raw rather than
 * calling `gateNeedsConfirm`: that helper's multi-action carve-out exists
 * because a multi-action gate WIDGET opens a detail sheet instead of firing on
 * one tap. A recipe tile fires on one tap whatever the gate's command looks
 * like — spec 171 renders a card action only when there is exactly one control
 * — so the accidental-tap vector the guard exists for is present either way.
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
  findEquipment?: (id: string) => EquipmentWithDetails | undefined,
): boolean {
  const target = tile.confirmFrom ? params?.[tile.confirmFrom] : undefined;
  const equipment =
    typeof target === "string" && target !== "" ? findEquipment?.(target) : undefined;
  // An equipment that no longer exists, or a store that has not loaded yet, is
  // NOT an answer of "no": it falls through to what the recipe declared.
  if (equipment) return equipment.requireConfirmation === true;

  const chosen = tile.confirmParam ? params?.[tile.confirmParam] : undefined;
  if (chosen === true || chosen === "true") return true;
  if (chosen === false || chosen === "false") return false;
  return tile.confirm === true;
}
