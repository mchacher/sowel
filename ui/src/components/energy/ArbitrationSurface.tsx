import { useEffect } from "react";
import type { ArbiterLoadInfo, ArbiterLoadState } from "../../types";
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
 *
 * #807 — the roster stopped stretching to the full card width (a row was read
 * across a thousand pixels of nothing); the freed width carries the context
 * panel, and the columns drop by tier so a phone never scrolls sideways.
 */

/**
 * Thousands get a thin no-break space: `1850 W` reads slower than `1 850 W`.
 * The table stays in watts even above a kilowatt (#807) — the differences that
 * decide anything here are a few hundred watts, which kW rounding would erase.
 */
function fmtW(v: number | null): string {
  if (v === null) return "—";
  return `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} W`;
}

/**
 * #807 — a load tolerating more grid import than it draws has a NEGATIVE need:
 * it starts with no surplus at all. The engine keeps that figure truthful (the
 * grant pass does not floor it either); the column renders it as 0 W, and the
 * Tolerates cell beside it explains why.
 */
function fmtNeed(v: number | null): string {
  return v === null ? "—" : fmtW(Math.max(0, v));
}

/** `pendingReason` codes that are NOT about surplus, mapped to their word. */
const GAP_REASON_KEY: Record<string, string> = {
  "min-off-cooldown": "cooldown",
  unresponsive: "unresponsive",
  "override-active": "override",
};

/**
 * Spec 165 — the state pill. Its label and colour come from the same two
 * sources the ribbon uses (`arbiter.loadState.*`, `loadStateColor`), so a state
 * cannot look one way here and another way three centimetres below.
 */
function StatePill({ state }: { state: ArbiterLoadState }) {
  const { t } = useTranslation();
  const color = loadStateColor(state);
  const label = t(`arbiter.loadState.${state}`);
  // #807 — "Granted (not consuming)" is 150 px on its own and breaks the row on
  // a phone. Below 640 px the dimmed dot carries the distinction, which is
  // exactly what `arbiterColors` dims it for.
  // Every other state is short enough to render once, which keeps its label
  // unique in the DOM for anything reading the row.
  const shortLabel = state === "granted-idle" ? t("arbiter.loadState.granted") : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: color }} />
      {shortLabel === null ? (
        label
      ) : (
        <>
          <span className="sm:hidden">{shortLabel}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      )}
    </span>
  );
}

/**
 * #807 — the gap column: what a load still waits for. A figure only while a
 * claim is genuinely short of surplus; every other state gets a word, never a
 * dash, because "nothing is missing" and "no data" are not the same statement.
 */
function GapCell({ row }: { row: ArbiterLoadInfo }) {
  const { t } = useTranslation();
  const word = (key: string) => <span className="text-[11.5px]">{t(`arbiter.gap.${key}`)}</span>;
  switch (row.state) {
    case "granted":
    case "granted-idle":
      return word("covered");
    case "unmanaged":
      return word("unmanaged");
    case "suspended":
      return <span>—</span>;
    case "pending":
      if ((row.shortfallW ?? 0) > 0) {
        return <span className="text-warning font-semibold">{fmtW(row.shortfallW)}</span>;
      }
      // Covered, yet still not granted: the engage hold has not matured, or
      // something other than surplus holds it back. `reasonWaiting` knows which.
      return word(GAP_REASON_KEY[row.reasonWaiting?.split(":")[0] ?? ""] ?? "holding");
    default:
      return word("notRequested");
  }
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

  // #807 — the load the arbiter is working on next: the first waiting row, in
  // the priority order the roster is listed in. That is a good guess, not a
  // promise — the engine serves whichever covered claim matures first, and a
  // claim declaring no slack jumps ahead of one that does — so the panel says
  // what the load needs, never that it is guaranteed to be served first.
  // A claim whose surplus is already covered is included on purpose: it is
  // the closest thing to "about to happen" the roster has.
  const nextUp = rows.find((r) => r.state === "pending");
  const showAside = !dormant && (available !== null || nextUp !== undefined);

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
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-6">
          <div className="flex-1 min-w-0 lg:max-w-[660px]">
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
                      {t("arbiter.roster.gap")}
                    </th>
                    <th className="hidden lg:table-cell text-right font-semibold pb-2 px-3 border-b border-border whitespace-nowrap">
                      {t("arbiter.roster.load")}
                    </th>
                    <th className="hidden lg:table-cell text-right font-semibold pb-2 px-3 border-b border-border whitespace-nowrap">
                      {t("arbiter.roster.tolerates")}
                    </th>
                    <th className="hidden sm:table-cell text-right font-semibold pb-2 pl-3 border-b border-border whitespace-nowrap">
                      {t("arbiter.roster.need")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const atRest = r.state === "idle" || r.state === "suspended";
                    return (
                      <tr
                        key={r.equipmentId}
                        className="border-b border-border-light last:border-b-0 hover:bg-border-light/40 transition-colors duration-150"
                      >
                        <td className="text-left py-2.5 pr-3">
                          <div
                            className={`font-semibold ${atRest ? "text-text-secondary" : "text-text"}`}
                          >
                            {/* #807 — the roster has been priority-ordered since
                                #616 and nothing said so. On a phone, where the
                                numeric columns are gone, it is the only clue left. */}
                            <span className="inline-block w-[15px] font-mono text-[10.5px] font-medium text-text-tertiary">
                              {i + 1}
                            </span>
                            {r.equipmentName}
                          </div>
                          {r.state === "pending" && (r.shortfallW ?? 0) > 0 && (
                            <div className="pl-[15px] text-[11px] font-normal text-text-tertiary">
                              {t("arbiter.waitingForSurplus")}
                            </div>
                          )}
                        </td>
                        <td className="text-left py-2.5 px-3">
                          <StatePill state={r.state} />
                        </td>
                        {/* No `whitespace-nowrap` here, unlike the figure
                            columns: the longest words ("outside arbitration")
                            would push a 375 px card into a sideways scroll,
                            and wrapping them costs nothing. */}
                        <td className="text-right py-2.5 px-3 font-mono text-text-tertiary">
                          <GapCell row={r} />
                        </td>
                        <td className="hidden lg:table-cell text-right py-2.5 px-3 font-mono text-text-secondary whitespace-nowrap">
                          {fmtW(r.state === "suspended" ? null : r.watts)}
                        </td>
                        <td className="hidden lg:table-cell text-right py-2.5 px-3 font-mono text-text-secondary whitespace-nowrap">
                          {fmtW(r.state === "suspended" ? null : r.toleratedImportW)}
                        </td>
                        <td className="hidden sm:table-cell text-right py-2.5 pl-3 font-mono text-text-secondary whitespace-nowrap">
                          {fmtNeed(r.state === "suspended" ? null : r.needW)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* The margin appears in no other place in the UI, and without it the
                three figures on a row look unrelated. Shown only where all three
                columns are (≥ 1024 px). */}
            <p className="hidden lg:block mt-3 text-[11px] font-mono text-text-tertiary">
              {t("arbiter.needFormula", { margin: state.engageMarginW })}
            </p>
          </div>

          {showAside && (
            <aside
              className={`${
                // Its only content below 640 px is the next-up block: without
                // one, the panel would be a rule over an empty strip there.
                nextUp ? "flex" : "hidden sm:flex"
              } flex-row lg:flex-col gap-6 lg:gap-4 flex-wrap lg:flex-nowrap lg:flex-none lg:w-[208px] border-t lg:border-t-0 lg:border-l border-border-light pt-3 lg:pt-0 lg:pl-5`}
            >
              {available !== null && (
                // Below 640 px this repeats the header sticker, which is enough
                // on a phone; from there up it is the figure the need column is
                // compared against, so it belongs next to the table.
                <div className="hidden sm:block">
                  <div className="text-[10.5px] uppercase tracking-wide font-semibold text-text-tertiary">
                    {t("arbiter.aside.available")}
                  </div>
                  <div
                    className="font-mono text-[22px] leading-tight mt-0.5"
                    style={{ color: surplusStickerColor(available) }}
                  >
                    {(available / 1000).toFixed(1)} kW
                  </div>
                  <div className="text-[11.5px] text-text-tertiary mt-1">
                    {t("arbiter.aside.availableHint")}
                  </div>
                </div>
              )}
              {nextUp && (
                <div>
                  <div className="hidden sm:block text-[10.5px] uppercase tracking-wide font-semibold text-text-tertiary">
                    {t("arbiter.aside.next")}
                  </div>
                  <div className="font-mono text-[12px] sm:text-[15px] leading-tight sm:mt-0.5 text-text">
                    {nextUp.equipmentName}
                  </div>
                  <div className="text-[11.5px] text-text-tertiary mt-1">
                    {(nextUp.shortfallW ?? 0) > 0
                      ? t("arbiter.aside.nextHint", {
                          need: fmtNeed(nextUp.needW),
                          gap: fmtW(nextUp.shortfallW),
                        })
                      : t("arbiter.aside.nextCovered", { need: fmtNeed(nextUp.needW) })}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {/* Spec 148 (Phase B) — redesigned timeline: signed surplus/deficit curve
          + per-load quarter ribbons (6h window, 48h depth) + linked journal. */}
      <ArbiterTimeline />
    </div>
  );
}
