import type { ArbiterDecision, ArbiterQuarterState } from "../../types";

/**
 * "En attente" cells reuse the muted 15% warning tint of the roster table's
 * waiting pill (ArbitrationSurface StatePill) rather than the solid orange,
 * which read as too aggressive on the timeline ribbon (#617).
 */
export const PENDING_FILL = "color-mix(in srgb, var(--color-warning) 15%, transparent)";

/** Spec 148 — map an arbiter timeline quarter state to its ribbon-cell fill. */
export function cellColor(s: ArbiterQuarterState): string {
  switch (s) {
    case "granted":
      return "var(--color-solar-auto)"; // accordé (auto-conso)
    case "pending":
      return PENDING_FILL; // en attente de surplus (#561, muted per #617)
    case "revoked":
      return "var(--color-error)"; // surplus retiré
    case "unmanaged":
      return "var(--color-slate)"; // On (hors arbitrage)
    default:
      return "color-mix(in srgb, var(--color-text-tertiary) 15%, transparent)"; // idle
  }
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
    case "granted":
    case "resumed":
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

/**
 * Spec 148 (issue #577) — the arbiter is *dormant* when the sun is down and
 * there is no surplus to distribute. At night there is structurally no PV
 * production, so the "active but importing" deficit view (red sticker + loads
 * "waiting" for a surplus that cannot come before sunrise) is misleading; the
 * surface should read as calmly at rest instead.
 *
 * `isDaylight === false` comes from the root zone's aggregated data (the same
 * source the header SunlightBanner uses) — a home with no coordinates has
 * `isDaylight === null` and never goes dormant, falling back to the deficit
 * view. The `availableSurplusW <= 0` guard keeps the battery case correct for
 * free: a home battery exporting at night keeps `availableSurplusW > 0`, which
 * is a real surplus to arbitrate and must stay in the normal active mode.
 */
export function isArbiterDormant(
  runState: string,
  isDaylight: boolean | null,
  availableSurplusW: number | null,
): boolean {
  return (
    runState === "active" &&
    isDaylight === false &&
    (availableSurplusW === null || availableSurplusW <= 0)
  );
}
