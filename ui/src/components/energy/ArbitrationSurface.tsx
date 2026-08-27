import { useEffect } from "react";
import type { ArbiterLoadState } from "../../types";
import { useTranslation } from "react-i18next";
import { Scale, Moon } from "lucide-react";
import { ArbiterTimeline } from "./ArbiterTimeline";
import { surplusStickerColor, loadStateColor, displayState } from "./arbiterColors";
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

/** Grid import is only worth a column value when the load actually accepts some. */
function tolerated(w: number | null): number | null {
  return w !== null && w > 0 ? w : null;
}

function fmtW(v: number | null): string {
  return v === null ? "—" : `${v} W`;
}

/**
 * Spec 165 — the state pill. Its label and colour come from the same two
 * sources the ribbon uses (`arbiter.loadState.*`, `loadStateColor`), so a state
 * cannot look one way here and another way three centimetres below.
 */
function StatePill({ state }: { state: ArbiterLoadState }) {
  const { t } = useTranslation();
  const color = loadStateColor(state);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: color }} />
      {t(`arbiter.loadState.${state}`)}
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

  // Issue #577 — at night there is structurally no surplus to arbitrate. The
  // engine now decides this (spec 165) so the ribbon reads it the same way.
  const dormant = state.dormant;
  const stickerColor = dormant ? "var(--color-slate)" : surplusStickerColor(available);

  // Spec 165 — the roster is the read model's `loads`, already resolved and
  // already in priority order (#616). The only presentation rule left here is
  // the dormant one, and it goes through the shared helper.
  const rows = state.loads.map((l) => ({
    ...l,
    state: displayState(l.state, dormant),
  }));

  // Deficit context (FR-10a): when the meter is importing, no waiting load can
  // start — spell it out so an empty "need" column does not read as inaction.
  // Suppressed while dormant, which shows its own calm night line instead (#577).
  const showDeficit = !dormant && state.state === "active" && available !== null && available < 0;

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
                const atRest = r.state === "idle" || r.state === "suspended";
                return (
                  <tr key={r.equipmentId} className="border-b border-border-light last:border-b-0">
                    <td
                      className={`text-left py-2.5 pr-3 font-semibold ${atRest ? "text-text-secondary" : "text-text"}`}
                    >
                      {r.equipmentName}
                    </td>
                    <td className="text-left py-2.5 px-3">
                      <StatePill state={r.state} />
                    </td>
                    <td className="text-right py-2.5 px-3 font-mono text-text-secondary whitespace-nowrap">
                      {fmtW(r.state === "pending" ? r.needW : null)}
                    </td>
                    <td className="text-right py-2.5 px-3 font-mono text-text-secondary whitespace-nowrap">
                      {fmtW(r.state === "suspended" ? null : r.watts)}
                    </td>
                    <td className="text-right py-2.5 pl-3 font-mono text-text-secondary whitespace-nowrap">
                      {fmtW(r.state === "suspended" ? null : tolerated(r.toleratedImportW))}
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
