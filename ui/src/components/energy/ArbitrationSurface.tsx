import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { useArbiter } from "../../store/useArbiter";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import type { ArbiterDecision, ArbiterPublicState } from "../../types";
import { buildLanes, isToday, minuteOfDay, type Lane } from "../../lib/arbitration-lanes";
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

const HOUSE_COLOR = "#33529E"; // darker blue: white 11px bold on it clears WCAG AA
const GRANTED_COLOR = "#6BCB77";
const GRANTED_TEXT = "#123f1c";
const HC_COLOR = "#BB8232";
const MANUAL_COLOR = "#6E7C88"; // darkened to clear 3:1 on a light surface
const REVOKE_COLOR = "#E5484D";

/** Translate a timeline marker's raw backend reason code for its tooltip. */
function markerTitle(m: Lane["markers"][number], t: (k: string) => string): string {
  if (m.kind === "revoked") {
    const key = `arbiter.revokeReason.${m.label}`;
    const tr = t(key);
    return tr === key ? t("arbiter.kind.revoked") : tr;
  }
  return t("arbiter.kind.unclaimed-run");
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
        <defs>
          <pattern id="arb-hatch-man" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
            <rect width="6" height="6" fill={MANUAL_COLOR} fillOpacity="0.16" />
            <rect width="2.5" height="6" fill={MANUAL_COLOR} fillOpacity="0.7" />
          </pattern>
        </defs>
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
            <path d={`${curve} L ${x(nowMin)} ${yk(0)} L ${x(minuteOfDay(samples[0].atIso))} ${yk(0)} Z`} fill={GRANTED_COLOR} fillOpacity="0.13" />
            <path d={curve} fill="none" stroke={GRANTED_COLOR} strokeOpacity="0.55" strokeWidth="1.5" />
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
              {lane.segments.map((seg, k) => (
                <rect
                  key={k}
                  x={x(seg.startMin)}
                  y={yTop}
                  width={Math.max(2, x(seg.endMin) - x(seg.startMin))}
                  height={SEG_H}
                  rx={4}
                  fill={seg.kind === "granted" ? GRANTED_COLOR : "url(#arb-hatch-man)"}
                  stroke={seg.kind === "manual" ? MANUAL_COLOR : "none"}
                  strokeWidth={seg.kind === "manual" ? 1 : 0}
                />
              ))}
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
                />
              )}
              {lane.markers.map((m, k) => (
                <g key={`m${k}`}>
                  {m.kind === "revoked" ? (
                    <path
                      d={`M ${x(m.min) - 4.5} ${yTop - 7} L ${x(m.min) + 4.5} ${yTop - 7} L ${x(m.min)} ${yTop - 1} Z`}
                      fill={REVOKE_COLOR}
                    >
                      <title>{markerTitle(m, t)}</title>
                    </path>
                  ) : (
                    <rect x={x(m.min) - 3} y={yTop - 8} width={6} height={6} transform={`rotate(45 ${x(m.min)} ${yTop - 5})`} fill={HC_COLOR}>
                      <title>{markerTitle(m, t)}</title>
                    </rect>
                  )}
                </g>
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
 */
function waitingReason(
  reasonWaiting: string,
  watts: number,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (reasonWaiting.startsWith("insufficient-surplus")) {
    return t("arbiter.waitReason.insufficient", { watts });
  }
  const key = `arbiter.waitReason.${reasonWaiting}`;
  const translated = t(key);
  return translated === key ? t("arbiter.waitReason.insufficient", { watts }) : translated;
}

function JournalRow({ entry }: { entry: ArbiterDecision }) {
  const { t } = useTranslation();
  const dot =
    entry.kind === "granted" || entry.kind === "resumed"
      ? GRANTED_COLOR
      : entry.kind === "revoked" || entry.kind === "revoke-not-honored"
        ? REVOKE_COLOR
        : entry.kind === "suspended"
          ? MANUAL_COLOR
          : entry.kind === "unclaimed-run" || entry.kind === "watts-divergence"
            ? HC_COLOR
            : "#9CA3AF";
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
    <div className="bg-surface border border-border rounded-[10px] p-5 mt-4">
      <div className="flex items-start gap-2 mb-4">
        <Scale size={18} strokeWidth={1.5} className="text-text-secondary mt-0.5" />
        <div>
          <h2 className="text-[15px] font-semibold text-text">{t("arbiter.surfaceTitle")}</h2>
          <p className="text-[12px] text-text-secondary">{t("arbiter.surfaceHint")}</p>
        </div>
        <span
          className={`ml-auto flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full border ${
            state.state === "active"
              ? "text-green-700 dark:text-green-400 border-green-600/40"
              : "text-amber-600 dark:text-amber-400 border-amber-500/40"
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
        <p className="text-[12px] text-amber-600 dark:text-amber-400 mb-2">
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
                <span className="truncate px-1">✓ {g.equipmentName}</span>
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
          <span>⏳</span>
          <span>
            <b className="text-text">{p.equipmentName}</b> {waitingReason(p.reasonWaiting, p.watts, t)}
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
              <span
                className="inline-block w-4 h-2.5 rounded-sm border"
                style={{
                  borderColor: MANUAL_COLOR,
                  background: `repeating-linear-gradient(135deg, ${MANUAL_COLOR}, ${MANUAL_COLOR} 2px, transparent 2px, transparent 5px)`,
                }}
              />
              {t("arbiter.legend.manual")}
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{ color: REVOKE_COLOR }} className="font-bold">
                ▼
              </span>
              {t("arbiter.legend.revoked")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rotate-45" style={{ backgroundColor: HC_COLOR }} />
              {t("arbiter.legend.unclaimed")}
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
