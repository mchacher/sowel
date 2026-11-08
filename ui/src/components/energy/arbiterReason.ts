// Issue #518 — the arbiter decision journal renders `kind · reason`. The kind
// is translated (arbiter.kind.*), but the reason is a raw backend literal,
// always English, so it showed as English on a French UI. Map every reason the
// arbiter can emit (src/energy/capacity-arbiter.ts) to an arbiter.reason.* key,
// and fall back to the raw string so an unknown or legacy reason still shows,
// just untranslated.

import { formatPower } from "../../lib/format";
import type { ArbiterDecision, ArbiterQuarterState } from "../../types";

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
  // resumed — automatic hand-back when the suspension TTL lapses (#535)
  "override-expired": "override-expired",
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
  "engine restart", // kind reset (#604) — the kind label already says it
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
  if (m) return t("arbiter.reason.watts-divergence", { power: formatPower(Number(m[1])) });
  return reason; // unknown / legacy → raw passthrough
}

/**
 * Spec 197 — what a `released` entry gave up. The engine journals `released`
 * for a granted claim (the load held the surplus and hands it back) and for a
 * pending one (it stops waiting), with nothing on the entry to tell them
 * apart. The state before it does: the closest older entry of the same load
 * that sets a claim state, else the lane's quarter before the release.
 * `null` when neither says, and the label falls back to a neutral wording.
 */
export type ReleaseFrom = "granted" | "pending" | null;

const HELD_KINDS = new Set<ArbiterDecision["kind"]>([
  "granted",
  "draw-started",
  "draw-stopped",
  "budget-changed",
]);
/** Kinds after which no live claim state is known from the journal alone. */
const UNKNOWN_KINDS = new Set<ArbiterDecision["kind"]>([
  "revoked",
  "revoke-not-honored",
  "released",
  "reset",
  "suspended",
  "resumed",
  "unclaimed-run",
  "unclaimed-run-ended",
]);

export function releasedFrom(
  journal: ArbiterDecision[], // newest first, as the timeline serves it
  index: number,
  lane: { quarters: ArbiterQuarterState[] } | undefined,
  windowStart: number,
  stepMs: number,
): ReleaseFrom {
  const entry = journal[index];
  for (let i = index + 1; i < journal.length; i += 1) {
    const e = journal[i];
    if (e.equipmentId !== entry.equipmentId) continue;
    if (HELD_KINDS.has(e.kind)) return "granted";
    if (e.kind === "waiting") return "pending";
    if (UNKNOWN_KINDS.has(e.kind)) break;
  }
  const q = Math.floor((Date.parse(entry.atIso) - windowStart) / stepMs) - 1;
  const before = q >= 0 ? lane?.quarters[q] : undefined;
  if (before === "granted" || before === "granted-idle") return "granted";
  if (before === "pending") return "pending";
  return null;
}

/** The journal label of a decision kind, with `released` read in context. */
export function journalKindLabel(
  kind: ArbiterDecision["kind"],
  from: ReleaseFrom,
  t: Translate,
): string {
  if (kind === "released" && from) return t(`arbiter.kind.released-${from}`);
  return t(`arbiter.kind.${kind}`);
}
