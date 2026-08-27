import type { ArbiterDecision, ArbiterLoadState, ArbiterQuarterState } from "../../types";

/**
 * Spec 165 — the hue of a load state, solid. This is what the roster pill uses
 * for its text and dot, and what the ribbon fills are mixed FROM.
 *
 * Opacity is a per-surface concern (a ribbon cell is a filled block, a pill is
 * a coloured word on a tint of itself), so it lives in CELL_FILL below and in
 * the pill's own 15% background. Returning a pre-blended fill here was the
 * spec 165 bug: the pill mixed it a second time and rendered its text at ~15%
 * alpha.
 */
const HUE: Record<ArbiterQuarterState, string> = {
  granted: "var(--color-solar-auto)", // accordé (auto-conso)
  // Spec 164 — same green, visibly dimmed, but SOLID so the pill stays legible.
  // The ribbon dims it further through CELL_FILL.
  "granted-idle": "color-mix(in srgb, var(--color-solar-auto) 55%, var(--color-text-tertiary))",
  pending: "var(--color-warning)", // en attente de surplus
  revoked: "var(--color-error)", // surplus retiré
  unmanaged: "var(--color-slate)", // marche (hors arbitrage)
  suspended: "var(--color-text-tertiary)", // suspendu — roster only
  idle: "var(--color-text-tertiary)", // au repos
};

/**
 * "En attente" cells are a tint rather than the solid orange, which read as too
 * aggressive on the ribbon (#617). Raised from 15% to 20% because the pale
 * version was hard to make out against the ribbon's background.
 */
export const PENDING_FILL = "color-mix(in srgb, var(--color-warning) 20%, transparent)";

/**
 * Spec 164 — the surplus was granted, and the load's own meter says nothing
 * consumed it. Same green as a grant, at 35 %: it must still read as "accordé"
 * (the allocation did happen), while sitting clearly below the solid cell. The
 * 15 % of the waiting tint would read as an empty cell here.
 */
export const GRANTED_IDLE_FILL = "color-mix(in srgb, var(--color-solar-auto) 35%, transparent)";

/** Spec 165 — "au repos": present enough to show the lane exists, no more. */
export const IDLE_FILL = "color-mix(in srgb, var(--color-text-tertiary) 15%, transparent)";

/** Spec 148 — the ribbon-cell fill per state: the hue above, dimmed where the
 *  state is a background one. `suspended` is here for exhaustiveness only; the
 *  ribbon never emits it (spec 165 non-goal). */
const CELL_FILL: Record<ArbiterQuarterState, string> = {
  granted: HUE.granted,
  "granted-idle": GRANTED_IDLE_FILL,
  pending: PENDING_FILL,
  revoked: HUE.revoked,
  unmanaged: HUE.unmanaged,
  suspended: HUE.suspended,
  idle: IDLE_FILL,
};

/**
 * Spec 165 — the single state->colour source for both halves of the surface.
 * Before, `STATE_COLOR` (roster) and `cellColor` (ribbon) agreed by convention
 * only, which is how spec 164's muted green came to land on one surface and
 * not the other.
 */
export function loadStateColor(s: ArbiterQuarterState): string {
  return HUE[s];
}

/** Spec 148 — the ribbon-cell fill for a quarter state. */
export function cellColor(s: ArbiterQuarterState): string {
  return CELL_FILL[s];
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
