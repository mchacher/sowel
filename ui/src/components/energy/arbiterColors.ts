import type { ArbiterDecision } from "../../types";

/**
 * Spec 148 — map an arbiter decision kind to its journal-dot color token.
 *
 * The "manual" (override / suspended) and "unclaimed-run" kinds merge into a
 * single "On (hors pilotage)" state, rendered with the slate token; the journal
 * row text still spells out the precise cause. All colors are CSS variables so
 * they follow the theme (dark-mode correct), unlike the previous hardcoded hex.
 */
export function journalDotColor(kind: ArbiterDecision["kind"]): string {
  switch (kind) {
    case "granted":
    case "resumed":
      return "var(--color-solar-auto)"; // accordé (auto-conso)
    case "revoked":
    case "revoke-not-honored":
      return "var(--color-error)"; // surplus retiré
    case "suspended":
    case "unclaimed-run":
    case "watts-divergence":
      return "var(--color-slate)"; // On (hors pilotage)
    default:
      return "var(--color-text-tertiary)";
  }
}

/**
 * Colour token for the arbiter state sticker, matching the timeline curve:
 * the surplus green when there is surplus to give, red on a deficit, and a
 * neutral tint while the reading is degraded/stale (`availableSurplusW` null).
 */
export function surplusStickerColor(availableSurplusW: number | null): string {
  if (availableSurplusW === null) return "var(--color-text-tertiary)";
  return availableSurplusW > 0 ? "var(--color-solar-auto)" : "var(--color-error)";
}
