import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Scale, Check, Zap, Clock, ChevronDown } from "lucide-react";
import { journalDotColor } from "./arbiterColors";
import { useArbiter } from "../../store/useArbiter";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import type { ArbiterDecision, ArbiterPublicState } from "../../types";
import {
  buildLanes,
  isToday,
  minuteOfDay,
  type Lane,
  type LaneSegment,
} from "../../lib/arbitration-lanes";
import {
  equipmentLabelMap,
  flattenZonesWithPath,
  zoneChainMap,
} from "../../lib/zone-path";

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
const SURPLUS_COLOR = "var(--color-solar-injection)"; // available-surplus curve
const GRANTED_TEXT = "#123f1c"; // dark-green label on the light granted green (readable both themes)
const SLATE = "var(--color-slate)"; // On (hors pilotage): manual override + unclaimed run
const REVOKE_COLOR = "var(--color-error)"; // surplus retiré

/** Translate a timeline marker's raw backend reason code for its tooltip. */
function markerTitle(m: Lane["markers"][number], t: (k: string) => string): string {
  const key = `arbiter.revokeReason.${m.label}`;
  const tr = t(key);
  return tr === key ? t("arbiter.kind.revoked") : tr;
}

/** How each span reads on the lane, and which legend entry names it. */
const SEGMENT_STYLE: Record<
  LaneSegment["kind"],
  { fill: string; stroke: string; labelKey: string }
> = {
  granted: { fill: GRANTED_COLOR, stroke: "none", labelKey: "grantedShort" },
  // Spec 148 — "manual" (override) and "unclaimed" (running unclaimed) merge into
  // one solid "On (hors pilotage)" state; the journal keeps the precise cause.
  manual: { fill: SLATE, stroke: "none", labelKey: "unmanaged" },
  unclaimed: { fill: SLATE, stroke: "none", labelKey: "unmanaged" },
};

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "Granted · 13:50 → ongoing" — the span's nature and its extent. */
function segmentTitle(seg: LaneSegment, t: (k: string) => string): string {
  const what = t(`arbiter.legend.${SEGMENT_STYLE[seg.kind].labelKey}`);
  const end = seg.open ? t("arbiter.ongoing") : hhmm(seg.endMin);
  return `${what} · ${hhmm(seg.startMin)} → ${end}`;
}

function Timeline({ state, lanes, nowMin }: { state: ArbiterPublicState; lanes: Lane[]; nowMin: number }) {
  const { t } = useTranslation();
  const W = 840;
  const LEFT = 110;
  const RIGHT = 12;
  const TOP = 10;
  const CURVE_H = 60;
  const LANE_H = 34;
  const SEG_H = 14;
  const plotW = W - LEFT - RIGHT;
  const H = TOP + CURVE_H + 16 + lanes.length * LANE_H + 28;
  const x = (min: number) => LEFT + (Math.min(1440, Math.max(0, min)) / 1440) * plotW;

  const samples = state.surplusSeries.filter((s) => isToday(s.atIso));
  const maxW = Math.max(1000, ...samples.map((s) => s.availableW));
  const yk = (w: number) => TOP + CURVE_H - (Math.max(0, Math.min(w, maxW)) / maxW) * CURVE_H;
  const curve =
    samples.length > 1
      ? samples.map((s, i) => `${i === 0 ? "M" : "L"} ${x(minuteOfDay(s.atIso))} ${yk(s.availableW)}`).join(" ")
      : null;

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} role="img" aria-label={t("arbiter.timelineLabel")}>
        {[0, 6, 12, 18, 24].map((h) => (
          <g key={h}>
            <line x1={x(h * 60)} y1={TOP} x2={x(h * 60)} y2={H - 24} stroke="currentColor" strokeOpacity="0.08" />
            <text x={x(h * 60)} y={H - 8} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity="0.45" className="font-mono">
              {String(h).padStart(2, "0")}h
            </text>
          </g>
        ))}
        {curve && (
          <>
            <path d={`${curve} L ${x(nowMin)} ${yk(0)} L ${x(minuteOfDay(samples[0].atIso))} ${yk(0)} Z`} fill={SURPLUS_COLOR} fillOpacity="0.14" />
            <path d={curve} fill="none" stroke={SURPLUS_COLOR} strokeOpacity="0.7" strokeWidth="1.5" />
          </>
        )}
        {lanes.map((lane, i) => {
          const yTop = TOP + CURVE_H + 16 + i * LANE_H;
          const yMid = yTop + SEG_H / 2;
          return (
            <g key={lane.equipmentId}>
              <text x={LEFT - 8} y={yMid + 4} fontSize="12" fontWeight="600" textAnchor="end" fill="currentColor">
                {lane.name}
              </text>
              <line x1={LEFT} y1={yMid} x2={x(1440)} y2={yMid} stroke="currentColor" strokeOpacity="0.08" />
              {lane.segments.map((seg, k) => {
                const w = Math.max(2, x(seg.endMin) - x(seg.startMin));
                const style = SEGMENT_STYLE[seg.kind];
                return (
                  <g key={k}>
                    <rect
                      x={x(seg.startMin)}
                      y={yTop}
                      width={w}
                      height={SEG_H}
                      rx={4}
                      fill={style.fill}
                      stroke={style.stroke}
                      strokeWidth={style.stroke === "none" ? 0 : 1}
                    >
                      {/* Every span says what it was and when. Reading a bar off
                          the axis by eye is guesswork at 1 px per 1.7 min. */}
                      <title>{segmentTitle(seg, t)}</title>
                    </rect>
                    {w > 46 && (
                      <text
                        x={x(seg.startMin) + 7}
                        y={yTop + SEG_H / 2 + 3.5}
                        fontSize="10"
                        fontWeight="600"
                        fill={seg.kind === "granted" ? GRANTED_TEXT : "currentColor"}
                        fillOpacity={seg.kind === "granted" ? 1 : 0.75}
                        pointerEvents="none"
                      >
                        {t(`arbiter.legend.${style.labelKey}`)}
                      </text>
                    )}
                  </g>
                );
              })}
              {lane.pendingFromMin !== null && (
                <rect
                  x={x(lane.pendingFromMin)}
                  y={yTop}
                  width={Math.max(2, x(nowMin) - x(lane.pendingFromMin))}
                  height={SEG_H}
                  rx={4}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.4"
                  strokeWidth={1.2}
                  strokeDasharray="3 3"
                >
                  <title>{`${t("arbiter.legend.pending")} · ${hhmm(lane.pendingFromMin)} → ${t("arbiter.ongoing")}`}</title>
                </rect>
              )}
              {lane.markers.map((m, k) => (
                <path
                  key={`m${k}`}
                  d={`M ${x(m.min) - 4.5} ${yTop - 7} L ${x(m.min) + 4.5} ${yTop - 7} L ${x(m.min)} ${yTop - 1} Z`}
                  fill={REVOKE_COLOR}
                >
                  <title>{`${markerTitle(m, t)} · ${hhmm(m.min)}`}</title>
                </path>
              ))}
            </g>
          );
        })}
        <line x1={x(nowMin)} y1={TOP} x2={x(nowMin)} y2={H - 24} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="4 3" />
      </svg>
    </div>
  );
}

/**
 * Human-language reason for a journal row. Revoke reasons and suspend reasons
 * are stable codes the backend emits, so they translate cleanly; the audit
 * kinds (watts-divergence, unclaimed-run, comfort-off) already say everything
 * in their translated `kind`, so their raw English `reason` is not shown.
 */
function journalReason(entry: ArbiterDecision, t: (k: string) => string): string | null {
  if (!entry.reason) return null;
  if (entry.kind === "revoked") {
    const key = `arbiter.revokeReason.${entry.reason}`;
    const translated = t(key);
    return translated === key ? null : translated;
  }
  if (entry.kind === "suspended") {
    const key = `arbiter.suspendReason.${entry.reason}`;
    const translated = t(key);
    return translated === key ? null : translated;
  }
  return null;
}

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

function JournalRow({ entry }: { entry: ArbiterDecision }) {
  const { t } = useTranslation();
  const dot = journalDotColor(entry.kind); // spec 148 — merge + tokenized
  const time = new Date(entry.atIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const reason = journalReason(entry, t);
  return (
    <li className="flex items-baseline gap-2.5 py-1.5 border-t border-border-light first:border-t-0 text-[13px]">
      <span className="font-mono text-[12px] text-text-tertiary w-11 flex-none">{time}</span>
      <span className="w-2 h-2 rounded-full flex-none self-center" style={{ backgroundColor: dot }} />
      <span className="font-semibold text-text">{entry.equipmentName ?? ""}</span>
      <span className="text-text-secondary truncate">
        {t(`arbiter.kind.${entry.kind}`)}
        {reason ? ` · ${reason}` : ""}
      </span>
      {entry.watts !== undefined && (
        <span className="ml-auto font-mono text-[12px] text-text-tertiary whitespace-nowrap">
          {entry.watts} W
        </span>
      )}
    </li>
  );
}

export function ArbitrationSurface() {
  const { t } = useTranslation();
  const state = useArbiter((s) => s.state);
  const fetch = useArbiter((s) => s.fetch);
  const equipments = useEquipments((s) => s.equipments);
  const zoneTree = useZones((s) => s.tree);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  // Homonym profiled loads get a `name — zone` lane label (spec 139).
  const profiled = useMemo(() => {
    const list = equipments.filter((e) => e.energyProfile);
    const labels = equipmentLabelMap(list, zoneChainMap(flattenZonesWithPath(zoneTree)));
    return list.map((e) => ({ id: e.id, name: labels.get(e.id) ?? e.name }));
  }, [equipments, zoneTree]);

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const lanes = useMemo(
    () => (state ? buildLanes(state, profiled, nowMin) : []),
    [state, profiled, nowMin],
  );

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

      {/* Day timeline */}
      {lanes.length > 0 && (
        <div className="mt-4">
          <Timeline state={state} lanes={lanes} nowMin={nowMin} />
          <div className="flex flex-wrap gap-4 text-[12px] text-text-secondary mt-1">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-2.5 rounded-sm" style={{ backgroundColor: GRANTED_COLOR }} />
              {t("arbiter.legend.granted")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-2.5 rounded-sm" style={{ backgroundColor: SLATE }} />
              {t("arbiter.legend.unmanaged")}
            </span>
            <span className="flex items-center gap-1.5">
              <ChevronDown size={13} strokeWidth={2.5} style={{ color: REVOKE_COLOR }} />
              {t("arbiter.legend.revoked")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-2.5 rounded-sm border border-dashed border-text-tertiary" />
              {t("arbiter.legend.pending")}
            </span>
          </div>
        </div>
      )}

      {/* Decision journal */}
      {state.journal.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[13px] font-medium text-text mb-1">{t("arbiter.journalTitle")}</h3>
          <ul>
            {state.journal.slice(0, 8).map((entry, i) => (
              <JournalRow key={i} entry={entry} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
