// Issue #518 — the arbiter decision journal renders `kind · reason`. The kind
// is translated (arbiter.kind.*), but the reason is a raw backend literal,
// always English, so it showed as English on a French UI. Map every reason the
// arbiter can emit (src/energy/capacity-arbiter.ts) to an arbiter.reason.* key,
// and fall back to the raw string so an unknown or legacy reason still shows,
// just untranslated.

type Translate = (key: string, opts?: Record<string, unknown>) => string;

// Backend reason string → i18n slug. Kebab codes (CapacityRevokeReason /
// CapacityDenyReason / suspend `why`) map to themselves; the free-text
// sentences map to the slug of the kind they belong to.
export const REASON_SLUG: Record<string, string> = {
  // CapacityRevokeReason
  "surplus-deficit": "surplus-deficit",
  "priority-preempted": "priority-preempted",
  "manual-override": "manual-override",
  "meter-stale": "meter-stale",
  disabled: "disabled",
  // CapacityDenyReason
  "not-profiled": "not-profiled",
  "equipment-already-claimed": "equipment-already-claimed",
  "arbiter-disabled": "arbiter-disabled",
  "override-active": "override-active",
  // suspend `why`
  "user-order": "user-order",
  "wall-switch-off": "wall-switch-off",
  "wall-switch-on": "wall-switch-on",
  // free-text sentences
  "recipe switched a comfort load off on revocation": "comfort-off-after-revoke",
  "recipe-driven run outside arbitration": "unclaimed-run",
  "run outside arbitration finished": "unclaimed-run-ended",
  "resume control": "resume-control",
  "export did not recover (a cloud can mask this)": "export-not-recovered",
};

/** The one reason that carries dynamic data: `declared <N> W` (watts-divergence). */
const DECLARED_W = /^declared (\d+) W$/;

/** Localise a journal decision reason. Returns null when there is no reason. */
export function journalReasonLabel(reason: string | undefined, t: Translate): string | null {
  if (!reason) return null;
  const slug = REASON_SLUG[reason];
  if (slug) return t(`arbiter.reason.${slug}`);
  const m = DECLARED_W.exec(reason);
  if (m) return t("arbiter.reason.watts-divergence", { watts: m[1] });
  return reason; // unknown / legacy → raw passthrough
}
