// Issue #518 — the arbiter decision journal renders `kind · reason`. The kind
// is translated (arbiter.kind.*), but the reason is a raw backend literal,
// always English, so it showed as English on a French UI. Map every reason the
// arbiter can emit (src/energy/capacity-arbiter.ts) to an arbiter.reason.* key,
// and fall back to the raw string so an unknown or legacy reason still shows,
// just untranslated.

type Translate = (key: string, opts?: Record<string, unknown>) => string;

// Backend reason string → i18n slug, for reasons that ADD information the kind
// does not carry. Kebab codes (CapacityRevokeReason / CapacityDenyReason /
// suspend `why`) map to themselves; the one informative free-text sentence
// (revoke-not-honored) maps to its own slug.
export const REASON_SLUG: Record<string, string> = {
  // CapacityRevokeReason — why the surplus was withdrawn
  "surplus-deficit": "surplus-deficit",
  "priority-preempted": "priority-preempted",
  "manual-override": "manual-override",
  "meter-stale": "meter-stale",
  disabled: "disabled",
  // CapacityDenyReason — why the claim was refused
  "not-profiled": "not-profiled",
  "equipment-already-claimed": "equipment-already-claimed",
  "arbiter-disabled": "arbiter-disabled",
  "override-active": "override-active",
  // suspend `why` — how the manual override happened
  "user-order": "user-order",
  "wall-switch-off": "wall-switch-off",
  "wall-switch-on": "wall-switch-on",
  // informative free-text
  "export did not recover (a cloud can mask this)": "export-not-recovered",
};

// Reasons whose kind (arbiter.kind.*) already says everything: appending the
// reason would just repeat it (e.g. "fin de marche hors arbitrage · marche hors
// arbitrage terminée"). Suppress the reason and show only the kind (#518).
const REDUNDANT_WITH_KIND = new Set([
  "recipe switched a comfort load off on revocation", // kind comfort-off-after-revoke
  "recipe-driven run outside arbitration", // kind unclaimed-run
  "run outside arbitration finished", // kind unclaimed-run-ended
  "resume control", // kind resumed
]);

/** The one reason that carries dynamic data: `declared <N> W` (watts-divergence). */
const DECLARED_W = /^declared (\d+) W$/;

/**
 * Localise a journal decision reason for display after the kind. Returns null
 * when there is no reason, or when the reason only repeats its kind.
 */
export function journalReasonLabel(reason: string | undefined, t: Translate): string | null {
  if (!reason || REDUNDANT_WITH_KIND.has(reason)) return null;
  const slug = REASON_SLUG[reason];
  if (slug) return t(`arbiter.reason.${slug}`);
  const m = DECLARED_W.exec(reason);
  if (m) return t("arbiter.reason.watts-divergence", { watts: m[1] });
  return reason; // unknown / legacy → raw passthrough
}
