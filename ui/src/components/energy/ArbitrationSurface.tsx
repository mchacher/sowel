import { useEffect } from "react";
import type { ArbiterLoadInfo, ArbiterLoadState } from "../../types";
import { useTranslation } from "react-i18next";
import { Moon } from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { ArbiterTimeline } from "./ArbiterTimeline";
import {
  surplusStickerColor,
  surplusFigureInk,
  STICKER_INK,
  DEFICIT_HUE,
  isDeficit,
  loadStateColor,
  loadStateInk,
  loadStatePillBg,
  displayState,
} from "./arbiterColors";
import { useArbiter } from "../../store/useArbiter";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { ROOT_ZONE_ID } from "../../lib/constants";
import { formatPower } from "../../lib/format";

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
 * The table stays in watts even above a kilowatt (#807) — the differences that
 * decide anything here are a few hundred watts, which kW rounding would erase.
 * Thousands are grouped by `lib/format`: `1850 W` reads slower than `1 850 W`.
 */
function fmtW(v: number | null): string {
  return formatPower(v, { unit: "W" });
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
      className="inline-flex items-center gap-1.5 text-micro font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: loadStateInk(state), background: loadStatePillBg(state) }}
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
 *
 * Spec 197 (FR-E2.4) — while the house imports, every waiting row is short by
 * the whole deficit plus its own need: five orange figures said the same
 * thing five times, in the attention colour. The word « déficit » says it
 * once per row, calmly; the watts come back as soon as there is a surplus.
 */
function GapCell({ row, deficit }: { row: ArbiterLoadInfo; deficit: boolean }) {
  const { t } = useTranslation();
  const word = (key: string) => <span className="text-caption">{t(`arbiter.gap.${key}`)}</span>;
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
        if (deficit) return word("deficit");
        return <span className="text-warning-ink font-semibold">{fmtW(row.shortfallW)}</span>;
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
  // Spec 197 (FR-E2.2) — an active reading says what it is, « Déficit 4,8 kW »
  // or « Surplus 1,2 kW », where « Actif −4,8 kW » named the normal state and
  // left the sign to say the rest. Inactive and degraded stickers unchanged.
  const signedSticker = state.state === "active" && available !== null;

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
  // Spec 197 (FR-E2.3) — the figure is said once in the sticker and once in
  // the aside, so this line carries no figure; from 640 px the aside says the
  // same words beside the table, and the line is left to the phone.
  const deficit = !dormant && state.state === "active" && isDeficit(available);

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
    <div className="card p-4 sm:p-6 mt-4">
      <SectionHeader
        title={t("arbiter.surfaceTitle")}
        hint={t("arbiter.surfaceHint")}
        aside={
          <span
            className="ml-auto flex items-center gap-1 text-micro font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
            style={{
              color: STICKER_INK,
              background: `color-mix(in srgb, ${stickerColor} 12%, transparent)`,
            }}
            title={state.state === "degraded" ? t("arbiter.degradedReason") : undefined}
          >
            {dormant ? (
              <>
                <Moon size={11} strokeWidth={2} />
                {t("arbiter.state.dormant")}
              </>
            ) : signedSticker ? (
              <>
                {t(isDeficit(available) ? "arbiter.sticker.deficit" : "arbiter.sticker.surplus")}
                <span className="tabular-nums">{formatPower(Math.abs(available))}</span>
              </>
            ) : (
              <>
                {t(`arbiter.state.${state.state}`)}
                {available !== null && (
                  <span className="tabular-nums">{formatPower(available)}</span>
                )}
              </>
            )}
          </span>
        }
      />
      {state.state === "degraded" && (
        <p className="text-caption text-warning-ink mb-2">{t("arbiter.degradedReason")}</p>
      )}
      {dormant && (
        <p className="text-caption text-slate mb-2 flex items-center gap-1.5">
          <Moon size={13} strokeWidth={1.5} className="flex-none" />
          <span>
            {t("arbiter.nightContext")}
            {rootAgg?.sunrise && <span className="tabular-nums"> ({rootAgg.sunrise})</span>}
          </span>
        </p>
      )}
      {deficit && (
        <p className={`text-caption text-text-tertiary mb-2 ${rows.length > 0 ? "sm:hidden" : ""}`}>
          {t("arbiter.deficitContext")}
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-6">
          <div className="flex-1 min-w-0 lg:max-w-[660px]">
            {/* Spec 197 (FR-E2.5) — the 1 to 5 before each name is the rank;
                only a code comment said so. */}
            <p className="text-caption text-text-tertiary mb-2">{t("arbiter.priorityCaption")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-caption border-collapse">
                <thead>
                  <tr className="text-caption uppercase tracking-[0.04em] text-text-tertiary">
                    <th
                      className="text-left font-semibold pb-2 pr-3 border-b border-border"
                      title={t("arbiter.rosterHint.equipment")}
                    >
                      {t("arbiter.roster.equipment")}
                    </th>
                    <th
                      className="text-left font-semibold pb-2 px-3 border-b border-border"
                      title={t("arbiter.rosterHint.state")}
                    >
                      {t("arbiter.roster.state")}
                    </th>
                    <th
                      className="text-right font-semibold pb-2 px-3 border-b border-border whitespace-nowrap"
                      title={t("arbiter.rosterHint.gap")}
                    >
                      {t("arbiter.roster.gap")}
                    </th>
                    <th
                      className="hidden lg:table-cell text-right font-semibold pb-2 px-3 border-b border-border whitespace-nowrap"
                      title={t("arbiter.rosterHint.load")}
                    >
                      {t("arbiter.roster.load")}
                    </th>
                    <th
                      className="hidden lg:table-cell text-right font-semibold pb-2 px-3 border-b border-border whitespace-nowrap"
                      title={t("arbiter.rosterHint.tolerates")}
                    >
                      {t("arbiter.roster.tolerates")}
                    </th>
                    <th
                      className="hidden sm:table-cell text-right font-semibold pb-2 pl-3 border-b border-border whitespace-nowrap"
                      title={t("arbiter.rosterHint.need")}
                    >
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
                            <span className="inline-block w-[15px] tabular-nums text-micro font-medium text-text-tertiary">
                              {i + 1}
                            </span>
                            {r.equipmentName}
                          </div>
                        </td>
                        <td className="text-left py-2.5 px-3">
                          <StatePill state={r.state} />
                        </td>
                        {/* No `whitespace-nowrap` here, unlike the figure
                            columns: the longest words ("outside arbitration")
                            would push a 375 px card into a sideways scroll,
                            and wrapping them costs nothing. */}
                        <td className="text-right py-2.5 px-3 tabular-nums text-text-tertiary">
                          <GapCell row={r} deficit={deficit} />
                        </td>
                        <td className="hidden lg:table-cell text-right py-2.5 px-3 tabular-nums text-text-secondary whitespace-nowrap">
                          {fmtW(r.state === "suspended" ? null : r.watts)}
                          {/* Spec 185 — a modulating load: the budget the
                              arbiter assigned, out of its maximum. */}
                          {r.modulation && r.budgetW !== undefined && r.state !== "suspended" && (
                            <div className="text-micro text-text-tertiary">
                              {t("arbiter.budget", {
                                budget: fmtW(r.budgetW),
                                max: fmtW(r.modulation.maxW),
                              })}
                            </div>
                          )}
                        </td>
                        <td className="hidden lg:table-cell text-right py-2.5 px-3 tabular-nums text-text-secondary whitespace-nowrap">
                          {fmtW(r.state === "suspended" ? null : r.toleratedImportW)}
                        </td>
                        <td className="hidden sm:table-cell text-right py-2.5 pl-3 tabular-nums text-text-secondary whitespace-nowrap">
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
            <p className="hidden lg:block mt-3 text-caption text-text-tertiary">
              {t("arbiter.needFormula", { margin: formatPower(state.engageMarginW) })}
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
                // Spec 197 (FR-E2.3) — worded by sign: a deficit is an import,
                // never « Surplus disponible −4,8 kW » over « Export réseau
                // instantané » while the house imports.
                <div className="hidden sm:block">
                  <div className="text-caption text-text-tertiary">
                    {t(isDeficit(available) ? "arbiter.aside.import" : "arbiter.aside.available")}
                  </div>
                  <div
                    className="flex items-center gap-1.5 tabular-nums text-title leading-tight mt-0.5"
                    style={{ color: surplusFigureInk(available) }}
                  >
                    {isDeficit(available) && (
                      <span
                        aria-hidden="true"
                        className="w-2 h-2 rounded-full flex-none"
                        style={{ backgroundColor: DEFICIT_HUE }}
                      />
                    )}
                    {formatPower(isDeficit(available) ? Math.abs(available) : available)}
                  </div>
                  <div className="text-caption text-text-tertiary mt-1">
                    {t(
                      isDeficit(available)
                        ? "arbiter.aside.importHint"
                        : "arbiter.aside.availableHint",
                    )}
                  </div>
                </div>
              )}
              {nextUp && (
                <div>
                  {/* Spec 197 (FR-E2.6) — labelled at every width: on a phone
                      the name used to float under the table with no heading. */}
                  <div className="text-caption text-text-tertiary">{t("arbiter.aside.next")}</div>
                  <div className="text-small sm:text-lead leading-tight mt-0.5 text-text">
                    {nextUp.equipmentName}
                  </div>
                  <div className="text-caption text-text-tertiary mt-1">
                    {/* The shortfall stays in the roster: « Démarrera dès 600 W
                        de surplus » is the threshold, not the load's draw. */}
                    {(nextUp.shortfallW ?? 0) > 0
                      ? t("arbiter.aside.nextHint", { need: fmtNeed(nextUp.needW) })
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
