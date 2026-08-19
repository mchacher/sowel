import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Scale, Moon } from "lucide-react";
import { ArbiterTimeline } from "./ArbiterTimeline";
import { surplusStickerColor, isArbiterDormant } from "./arbiterColors";
import { useArbiter } from "../../store/useArbiter";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { ROOT_ZONE_ID } from "../../lib/constants";

/**
 * Spec 140 / FR-10 — the arbitration surface on Energy → Live. Two stacked
 * pieces: a roster table giving the live state of every declared flexible load
 * (#561 — at-rest loads included, previously invisible), then the redesigned
 * timeline (signed surplus/deficit curve + per-load ribbons + decision journal).
 * Renders nothing when the arbiter is disabled — a no-PV home never sees dead
 * arbitration UI.
 */

/**
 * One roster row, flattened from the four state arrays of the read model into a
 * single list ordered by configured priority (#616), matching the timeline. The
 * `stateKey` pill carries each load's state; figures irrelevant to a state are
 * `null` and render as a dash.
 */
interface RosterRow {
  equipmentId: string;
  equipmentName: string;
  /** Drives the state pill's label + colour token. */
  stateKey: "granted" | "waiting" | "running" | "suspended" | "unmanaged" | "idle";
  needW: number | null;
  loadW: number | null;
  toleratedW: number | null;
}

const STATE_COLOR: Record<RosterRow["stateKey"], string> = {
  granted: "var(--color-solar-auto)",
  waiting: "var(--color-warning)", // jaune a-500 — same token as the timeline "pending" cell
  running: "var(--color-slate)",
  suspended: "var(--color-text-tertiary)",
  unmanaged: "var(--color-slate)",
  idle: "var(--color-text-tertiary)",
};

/** Grid import is only worth a column value when the load actually accepts some. */
function tolerated(w: number): number | null {
  return w > 0 ? w : null;
}

function fmtW(v: number | null): string {
  return v === null ? "—" : `${v} W`;
}

function StatePill({ stateKey }: { stateKey: RosterRow["stateKey"] }) {
  const { t } = useTranslation();
  const color = STATE_COLOR[stateKey];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: color }} />
      {t(`arbiter.rosterState.${stateKey}`)}
    </span>
  );
}

export function ArbitrationSurface() {
  const { t } = useTranslation();
  const state = useArbiter((s) => s.state);
  const fetch = useArbiter((s) => s.fetch);
  // Same sun source as the header SunlightBanner (root zone aggregation).
  const rootAgg = useZoneAggregation((s) => s.data[ROOT_ZONE_ID]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  if (!state || !state.enabled) return null;

  const available = state.availableSurplusW;

  // Issue #577 — at night there is structurally no surplus to arbitrate. Show a
  // calm "dormant" state instead of the active/importing deficit view.
  const dormant = isArbiterDormant(state.state, rootAgg?.isDaylight ?? null, available);
  const stickerColor = dormant ? "var(--color-slate)" : surplusStickerColor(available);

  // Flatten the read model into one roster. Each source array is state-specific
  // (grants / pending / suspensions / idle); the state pill carries the state,
  // so the rows themselves are ordered by configured priority (#616) to match
  // the timeline — not grouped by state.
  const rows: RosterRow[] = [
    ...state.grants.map<RosterRow>((g) => ({
      equipmentId: g.equipmentId,
      equipmentName: g.equipmentName,
      stateKey: "granted",
      needW: null,
      loadW: g.watts,
      toleratedW: null,
    })),
    ...state.pending.map<RosterRow>((p) => ({
      equipmentId: p.equipmentId,
      equipmentName: p.equipmentName,
      // A pending claim whose load a recipe is already running as a must-run
      // fallback is drawing power, not idle (#491) — read it "no surplus".
      // While dormant (night, no surplus), a non-running claim is at rest, not
      // "waiting" for a surplus that cannot come before sunrise (#577).
      stateKey: p.running ? "running" : dormant ? "idle" : "waiting",
      // At rest (running fallback, or dormant night) has no pending "need" to
      // show — a Need figure next to an "at rest" label reads as a contradiction.
      needW: p.running || dormant ? null : p.needW,
      loadW: p.watts,
      toleratedW: tolerated(p.toleratedImportW),
    })),
    ...state.suspensions.map<RosterRow>((s) => ({
      equipmentId: s.equipmentId,
      equipmentName: s.equipmentName,
      stateKey: "suspended",
      needW: null,
      loadW: null,
      toleratedW: null,
    })),
    ...state.idle.map<RosterRow>((i) => ({
      equipmentId: i.equipmentId,
      equipmentName: i.equipmentName,
      stateKey: i.runningUnmanaged ? "unmanaged" : "idle",
      needW: null,
      loadW: i.watts,
      toleratedW: tolerated(i.toleratedImportW),
    })),
  ];

  // #616 — order by the arbiter's configured priority (highest first), matching
  // the timeline. A load absent from the list (should not happen) sorts last but
  // keeps a stable relative order.
  const rank = (id: string) => {
    const i = state.priority.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  rows.sort((a, b) => rank(a.equipmentId) - rank(b.equipmentId));

  // Deficit context (FR-10a): when the meter is importing, no waiting load can
  // start — spell it out so an empty "need" column does not read as inaction.
  // Suppressed while dormant, which shows its own calm night line instead (#577).
  const showDeficit =
    !dormant && state.state === "active" && available !== null && available < 0;

  return (
    <div className="bg-surface border border-border rounded-[10px] p-4 mt-4">
      <div className="flex items-start gap-2 mb-4">
        <Scale size={18} strokeWidth={1.5} className="text-text-secondary mt-0.5" />
        <div>
          <h2 className="text-[15px] font-semibold text-text">{t("arbiter.surfaceTitle")}</h2>
          <p className="text-[12px] text-text-secondary">{t("arbiter.surfaceHint")}</p>
        </div>
        <span
          className="ml-auto flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
          style={{
            color: stickerColor,
            background: `color-mix(in srgb, ${stickerColor} 12%, transparent)`,
          }}
          title={state.state === "degraded" ? t("arbiter.degradedReason") : undefined}
        >
          {dormant ? (
            <>
              <Moon size={11} strokeWidth={2} />
              {t("arbiter.state.dormant")}
            </>
          ) : (
            <>
              {t(`arbiter.state.${state.state}`)}
              {available !== null && (
                <span className="font-mono">{(available / 1000).toFixed(1)} kW</span>
              )}
            </>
          )}
        </span>
      </div>
      {state.state === "degraded" && (
        <p className="text-[12px] text-warning mb-2">{t("arbiter.degradedReason")}</p>
      )}
      {dormant && (
        <p className="text-[12px] text-slate mb-2 flex items-center gap-1.5">
          <Moon size={13} strokeWidth={1.5} className="flex-none" />
          <span>
            {t("arbiter.nightContext")}
            {rootAgg?.sunrise && <span className="font-mono"> ({rootAgg.sunrise})</span>}
          </span>
        </p>
      )}
      {showDeficit && (
        <p className="text-[12px] text-text-tertiary mb-2">
          {t("arbiter.deficitContext", { kw: (Math.abs(available) / 1000).toFixed(1) })}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
                <th className="text-left font-semibold pb-2 pr-3 border-b border-border">
                  {t("arbiter.roster.equipment")}
                </th>
                <th className="text-left font-semibold pb-2 px-3 border-b border-border">
                  {t("arbiter.roster.state")}
                </th>
                <th className="text-right font-semibold pb-2 px-3 border-b border-border whitespace-nowrap">
                  {t("arbiter.roster.need")}
                </th>
                <th className="text-right font-semibold pb-2 px-3 border-b border-border whitespace-nowrap">
                  {t("arbiter.roster.load")}
                </th>
                <th className="text-right font-semibold pb-2 pl-3 border-b border-border whitespace-nowrap">
                  {t("arbiter.roster.tolerates")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const atRest = r.stateKey === "idle" || r.stateKey === "suspended";
                return (
                  <tr key={r.equipmentId} className="border-b border-border-light last:border-b-0">
                    <td
                      className={`text-left py-2.5 pr-3 font-semibold ${atRest ? "text-text-secondary" : "text-text"}`}
                    >
                      {r.equipmentName}
                    </td>
                    <td className="text-left py-2.5 px-3">
                      <StatePill stateKey={r.stateKey} />
                    </td>
                    <td className="text-right py-2.5 px-3 font-mono text-text-secondary whitespace-nowrap">
                      {fmtW(r.needW)}
                    </td>
                    <td className="text-right py-2.5 px-3 font-mono text-text-secondary whitespace-nowrap">
                      {fmtW(r.loadW)}
                    </td>
                    <td className="text-right py-2.5 pl-3 font-mono text-text-secondary whitespace-nowrap">
                      {fmtW(r.toleratedW)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Spec 148 (Phase B) — redesigned timeline: signed surplus/deficit curve
          + per-load quarter ribbons (6h window, 48h depth) + linked journal. */}
      <ArbiterTimeline />
    </div>
  );
}
