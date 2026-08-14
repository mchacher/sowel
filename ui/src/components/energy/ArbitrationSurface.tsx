import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Scale, Check, Zap, Clock } from "lucide-react";
import { ArbiterTimeline } from "./ArbiterTimeline";
import { useArbiter } from "../../store/useArbiter";
import { useEquipments } from "../../store/useEquipments";

/**
 * Spec 140 / FR-10 — the arbitration surface on Energy → Live. Normative
 * design: specs/140-energy-capacity-arbiter/mockups/arbitration-live.html.
 * Three stacked pieces: instant allocation bar + waiting queue, the day
 * timeline (available-surplus curve over one lane per profiled load), and
 * the decision journal. Renders nothing when the arbiter is disabled — a
 * no-PV home never sees dead arbitration UI.
 */

// Spec 148 — energy palette tokens (dark-mode correct, shared with the
// production graph). Accordé = auto-consumption green; the surplus curve =
// injection (darker green); "On (hors pilotage)" = a solid slate.
const HOUSE_COLOR = "var(--color-energy-hp)"; // household / consumption (blue)
const GRANTED_COLOR = "var(--color-solar-auto)"; // accordé (auto-conso)
const GRANTED_TEXT = "#123f1c"; // dark-green label on the light granted green (readable both themes)

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
  const equipments = useEquipments((s) => s.equipments);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  if (!state || !state.enabled) return null;

  // Instantaneous production for the allocation bar: a production meter if
  // there is one, else the sum of solar-panel readings (net-metered installs
  // that expose panels but no dedicated production meter). When neither yields
  // a reading the bar is hidden rather than shown with a missing household
  // segment — the timeline and journal below carry the substance.
  const sumPowerOf = (type: string): number =>
    equipments
      .filter((e) => e.type === type)
      .reduce((sum, e) => {
        const b = e.dataBindings?.find((x) => x.category === "power") as
          | { value?: unknown }
          | undefined;
        return sum + (typeof b?.value === "number" ? b.value : 0);
      }, 0);
  const productionW = sumPowerOf("energy_production_meter") || sumPowerOf("solar_panel");
  const available = state.availableSurplusW;
  const reserved = state.grants.reduce((s, g) => s + g.watts, 0);
  const free = available !== null ? Math.max(0, available - reserved) : 0;
  const house = Math.max(0, productionW - reserved - free);
  const showBar = productionW > 50;

  return (
    <div className="bg-surface border border-border rounded-[10px] p-4 mt-4">
      <div className="flex items-start gap-2 mb-4">
        <Scale size={18} strokeWidth={1.5} className="text-text-secondary mt-0.5" />
        <div>
          <h2 className="text-[15px] font-semibold text-text">{t("arbiter.surfaceTitle")}</h2>
          <p className="text-[12px] text-text-secondary">{t("arbiter.surfaceHint")}</p>
        </div>
        <span
          className={`ml-auto flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full border ${
            state.state === "active"
              ? "text-success border-success/40"
              : "text-warning border-warning/40"
          }`}
          title={state.state === "degraded" ? t("arbiter.degradedReason") : undefined}
        >
          {t(`arbiter.state.${state.state}`)}
          {available !== null && (
            <span className="font-mono">{(available / 1000).toFixed(1)} kW</span>
          )}
        </span>
      </div>
      {state.state === "degraded" && (
        <p className="text-[12px] text-warning mb-2">
          {t("arbiter.degradedReason")}
        </p>
      )}

      {/* Allocation bar */}
      {showBar && (
        <>
          <div className="flex gap-0.5 h-7 rounded-md overflow-hidden mb-1.5">
            {house > 0 && (
              <div
                className="flex items-center justify-center text-[11px] font-semibold text-white min-w-0"
                style={{ flex: house, backgroundColor: HOUSE_COLOR }}
                title={t("arbiter.household")}
              >
                <span className="truncate px-1">{t("arbiter.household")}</span>
              </div>
            )}
            {state.grants.map((g) => (
              <div
                key={g.equipmentId}
                className="flex items-center justify-center gap-1 text-[11px] font-semibold min-w-0"
                style={{ flex: g.watts, backgroundColor: GRANTED_COLOR, color: GRANTED_TEXT }}
                title={`${g.equipmentName} · ${g.watts} W`}
              >
                <span className="truncate px-1 flex items-center gap-1">
                  <Check size={12} strokeWidth={2.5} className="flex-none" />
                  {g.equipmentName}
                </span>
              </div>
            ))}
            {free > 0 && (
              <div
                className="flex items-center justify-center text-[11px] text-text-secondary border border-dashed border-border rounded-r-md min-w-0"
                style={{ flex: free }}
                title={t("arbiter.free")}
              >
                <span className="font-mono">{(free / 1000).toFixed(1)} kW</span>
              </div>
            )}
          </div>
        </>
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
