import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Scale, Zap, Clock } from "lucide-react";
import { ArbiterTimeline } from "./ArbiterTimeline";
import { surplusStickerColor } from "./arbiterColors";
import { useArbiter } from "../../store/useArbiter";

/**
 * Spec 140 / FR-10 — the arbitration surface on Energy → Live. Two stacked
 * pieces: the waiting queue (pending claims, why each waits), then the redesigned
 * timeline (signed surplus/deficit curve + per-load ribbons + decision journal).
 * Renders nothing when the arbiter is disabled — a no-PV home never sees dead
 * arbitration UI.
 */

/**
 * Why a pending claim is waiting (FR-10a). `reasonWaiting` is a backend code;
 * `insufficient-surplus:<W>` carries the current free headroom.
 *
 * The figure shown is `needW`, the surplus the arbiter actually tests against,
 * NOT the load's own draw: a claim that tolerates grid engages well below its
 * own power, and quoting `watts` here read as "it will never start" to someone
 * watching a surplus sit just under it.
 */
function waitingReason(
  reasonWaiting: string,
  needW: number,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const watts = Math.max(0, needW);
  if (reasonWaiting.startsWith("insufficient-surplus")) {
    return t("arbiter.waitReason.insufficient", { watts });
  }
  const key = `arbiter.waitReason.${reasonWaiting}`;
  const translated = t(key);
  return translated === key ? t("arbiter.waitReason.insufficient", { watts }) : translated;
}

export function ArbitrationSurface() {
  const { t } = useTranslation();
  const state = useArbiter((s) => s.state);
  const fetch = useArbiter((s) => s.fetch);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  if (!state || !state.enabled) return null;

  const available = state.availableSurplusW;
  const stickerColor = surplusStickerColor(available);

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
          {t(`arbiter.state.${state.state}`)}
          {available !== null && (
            <span className="font-mono">{(available / 1000).toFixed(1)} kW</span>
          )}
        </span>
      </div>
      {state.state === "degraded" && (
        <p className="text-[12px] text-warning mb-2">{t("arbiter.degradedReason")}</p>
      )}

      {state.pending.map((p) => (
        <div
          key={p.equipmentId}
          className="flex items-center gap-2 mb-1 px-3 py-1.5 rounded-md bg-background border border-border-light text-[12.5px] text-text-secondary"
        >
          {/* A pending claim whose load a recipe is already running as a
              must-run fallback is drawing power, not idle — show it as running
              on grid, never "waiting for surplus" (#491). */}
          {p.running ? (
            <Zap size={14} strokeWidth={1.5} className="flex-none text-warning" />
          ) : (
            <Clock size={14} strokeWidth={1.5} className="flex-none text-text-tertiary" />
          )}
          <span>
            <b className="text-text">{p.equipmentName}</b>{" "}
            {p.running ? t("arbiter.runningNoSurplus") : waitingReason(p.reasonWaiting, p.needW, t)}
            {/* The trigger alone leaves "why is it not 2200 W?" unanswered —
                the appliance rating and the grid it accepts to buy are what
                make the lower figure make sense. Secondary on purpose. */}
            <span className="block text-[11.5px] text-text-tertiary">
              {p.running
                ? t("arbiter.runningNoSurplusHint")
                : t("arbiter.waitContext", { watts: p.watts, tolerated: p.toleratedImportW })}
            </span>
          </span>
        </div>
      ))}

      {/* Spec 148 (Phase B) — redesigned timeline: signed surplus/deficit curve
          + per-load quarter ribbons (6h window, 48h depth) + linked journal. */}
      <ArbiterTimeline />
    </div>
  );
}
