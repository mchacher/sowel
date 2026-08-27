import type { ArbiterDecision, ArbiterLoadState, ArbiterQuarterState } from "../../types";

/**
 * "En attente" cells reuse the muted 15% warning tint of the roster table's
 * waiting pill (ArbitrationSurface StatePill) rather than the solid orange,
 * which read as too aggressive on the timeline ribbon (#617).
 */
export const PENDING_FILL = "color-mix(in srgb, var(--color-warning) 15%, transparent)";

/**
 * Spec 164 — the surplus was granted, and the load's own meter says nothing
 * consumed it. Same green as a grant, at 35 %: it must still read as "accordé"
 * (the allocation did happen), while sitting clearly below the solid cell. The
 * 15 % of the waiting tint would read as an empty cell here.
 */
export const GRANTED_IDLE_FILL = "color-mix(in srgb, var(--color-solar-auto) 35%, transparent)";

/** Spec 165 — "au repos", and the tint the suspended pill uses. */
export const IDLE_FILL = "color-mix(in srgb, var(--color-text-tertiary) 15%, transparent)";

/**
 * Spec 165 — the single colour source for a load state, used by the roster pill
 * AND the ribbon cell. Before, `STATE_COLOR` (roster) and `cellColor` (ribbon)
 * agreed by convention only, which is how spec 164's muted green came to land
 * on one surface and not the other.
 *
 * Opacity stays a per-surface concern (a ribbon cell is a fill, a pill is a
 * tint); the hue is decided here, once.
 */
export function loadStateColor(s: ArbiterQuarterState): string {
  switch (s) {
    case "granted":
      return "var(--color-solar-auto)"; // accordé (auto-conso)
    case "granted-idle":
      return GRANTED_IDLE_FILL; // accordé, mais rien ne le consomme (spec 164)
    case "pending":
      return PENDING_FILL; // en attente de surplus (#561, muted per #617)
    case "revoked":
      return "var(--color-error)"; // surplus retiré
    case "unmanaged":
      return "var(--color-slate)"; // marche (hors arbitrage)
    case "suspended":
      return "var(--color-text-tertiary)"; // suspendu — roster only, see spec 165
    default:
      return IDLE_FILL; // au repos
  }
}

/** Spec 148 — the ribbon-cell fill for a quarter state. */
export function cellColor(s: ArbiterQuarterState): string {
  return loadStateColor(s);
}

/**
 * Spec 165 (#577) — dormant (sun down, nothing to share) reads a waiting claim
 * as at rest. Applied by the roster pill and by the ribbon's current cell
 * through this one helper, so the two halves cannot disagree at night. Past
 * cells are history and are never rewritten (see `buildLoadTimelines`).
 */
export function displayState(s: ArbiterLoadState, dormant: boolean): ArbiterLoadState {
  return dormant && s === "pending" ? "idle" : s;
}

/**
 * Spec 148 — map an arbiter decision kind to its journal-dot color token.
 *
 * The "manual" (override / suspended) and "unclaimed-run" kinds merge into a
 * single "On (hors arbitrage)" state, rendered with the slate token; the journal
 * row text still spells out the precise cause. All colors are CSS variables so
 * they follow the theme (dark-mode correct), unlike the previous hardcoded hex.
 */
export function journalDotColor(kind: ArbiterDecision["kind"]): string {
  switch (kind) {
    // Spec 164 — both draw kinds happen INSIDE a grant, so they stay in the
    // grant's colour family; the row text says which way the load went.
    case "granted":
    case "resumed":
    case "draw-started":
    case "draw-stopped":
      return "var(--color-solar-auto)"; // accordé (auto-conso)
    case "revoked":
    case "revoke-not-honored":
      return "var(--color-error)"; // surplus retiré
    case "suspended":
    case "unclaimed-run":
    case "watts-divergence":
      return "var(--color-slate)"; // On (hors arbitrage)
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
