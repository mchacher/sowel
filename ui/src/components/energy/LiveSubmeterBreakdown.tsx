/**
 * Live submeter breakdown — donut + legend rendered below the existing
 * Maison/Réseau/Solaire flow diagram on the Live energy page (spec 117).
 *
 * Reactive: pulls equipments straight from the Zustand store, which is
 * already updated by the WebSocket `equipment.data.changed` events the
 * parent page subscribes to.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEquipments } from "../../store/useEquipments";
import {
  buildSubmeterRows,
  computeOther,
  type SubmeterRow,
} from "./submeter-helpers";

const HOUSE_COLOR = "#4F7BE8"; // matches HP_COLOR in LiveEnergyPage
const OTHER_COLOR = "#A1A1AA"; // var(--n-300), neutral grey

const RADIUS = 72;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Below this house power, the donut would be all rounding noise. */
const IDLE_THRESHOLD_W = 5;
/** Show the overshoot footnote only when Σ exceeds house by > 5%. */
const OVERSHOOT_RATIO = 0.05;

interface Props {
  /** House consumption in W (grid + solar). Null when both are unknown. */
  house: number | null;
  /** True when a `main_energy_meter` exists. Controls "Autre" rendering. */
  hasMainMeter: boolean;
}

function formatPower(value: number): { num: string; unit: "W" | "kW" } {
  if (value < 1000) {
    return { num: String(Math.round(value / 5) * 5), unit: "W" };
  }
  return { num: (value / 1000).toFixed(1), unit: "kW" };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const normalized = iso.includes("T")
    ? iso
    : iso.replace(" ", "T").replace("Z", "") + "Z";
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return "";
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

export function LiveSubmeterBreakdown({ house, hasMainMeter }: Props) {
  const { t } = useTranslation();
  const equipments = useEquipments((s) => s.equipments);

  const rows = useMemo(() => buildSubmeterRows(equipments), [equipments]);
  if (rows.length === 0) return null;

  const submeterSum = rows.reduce((acc, r) => acc + (r.power ?? 0), 0);
  // Without a main meter, the donut represents the sum of all submeters
  // (no residual segment, consistent with spec 091 acceptance criterion).
  const total = hasMainMeter ? Math.max(0, house ?? 0) : submeterSum;
  const other = hasMainMeter ? computeOther(total, rows) : 0;
  const overshoot =
    hasMainMeter && submeterSum > total * (1 + OVERSHOOT_RATIO);

  const isIdle = total < IDLE_THRESHOLD_W;
  const segments = isIdle
    ? []
    : buildSegments(rows, other, total);

  const t_total = formatPower(total);

  return (
    <div className="bg-surface border border-border rounded-[10px] p-4 sm:p-6 mt-4">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-[14px] font-semibold text-text">
          {t("energy.live.breakdown.title")}
        </h2>
      </div>

      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 max-w-[600px]">
        <Donut
          segments={segments}
          totalLabel={isIdle ? t("energy.live.breakdown.houseIdle") : t_total.num}
          totalUnit={isIdle ? null : t_total.unit}
          ariaLabel={buildAriaLabel(t, rows, other, total, hasMainMeter)}
          idle={isIdle}
        />

        <div className="flex-1 min-w-0 w-full flex flex-col gap-2">
          {rows.map((row) => (
            <LegendRow key={row.id} row={row} total={total} t={t} />
          ))}
          {hasMainMeter && other > 0 && (
            <div className="grid grid-cols-[10px_1fr_auto_auto] gap-x-3 items-center text-[13px] opacity-80">
              <span
                className="w-[10px] h-[10px] rounded-[2px] border border-border"
                style={{ background: OTHER_COLOR }}
              />
              <span className="text-text-secondary">
                {t("energy.live.breakdown.other")}
              </span>
              <span className="font-mono font-medium text-text-secondary min-w-[64px] text-right">
                {formatPower(other).num} {formatPower(other).unit}
              </span>
              <span className="font-mono font-semibold text-text-tertiary min-w-[40px] text-right">
                {total > 0 ? `${Math.round((other / total) * 100)}%` : "—"}
              </span>
            </div>
          )}
        </div>
      </div>

      {overshoot && (
        <p className="mt-3 text-[12px] text-warning italic">
          {t("energy.live.breakdown.overshoot")}
        </p>
      )}
    </div>
  );
}

interface DonutSegment {
  id: string;
  color: string;
  /** Fraction in [0, 1] of the full circle. */
  fraction: number;
}

function buildSegments(
  rows: SubmeterRow[],
  other: number,
  total: number,
): DonutSegment[] {
  if (total <= 0) return [];
  const segments: DonutSegment[] = [];
  for (const r of rows) {
    if (r.power === null || r.power <= 0) continue;
    segments.push({ id: r.id, color: r.color, fraction: r.power / total });
  }
  if (other > 0) {
    segments.push({ id: "__other__", color: OTHER_COLOR, fraction: other / total });
  }
  return segments;
}

function Donut({
  segments,
  totalLabel,
  totalUnit,
  ariaLabel,
  idle,
}: {
  segments: DonutSegment[];
  totalLabel: string;
  totalUnit: "W" | "kW" | null;
  ariaLabel: string;
  idle: boolean;
}) {
  const offsets: number[] = [];
  let acc = 0;
  for (const s of segments) {
    offsets.push(acc);
    acc += s.fraction;
  }
  return (
    <div className="relative w-[180px] h-[180px] shrink-0" role="img" aria-label={ariaLabel}>
      <svg width="180" height="180" viewBox="0 0 200 200" className="block">
        <g transform="rotate(-90 100 100)">
          <circle
            cx="100"
            cy="100"
            r={RADIUS}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={STROKE}
            opacity={idle ? 1 : 0.35}
          />
          {segments.map((seg, i) => {
            const dasharray = `${seg.fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
            const dashoffset = -offsets[i] * CIRCUMFERENCE;
            return (
              <circle
                key={seg.id}
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                stroke={seg.color}
                strokeWidth={STROKE}
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
                style={{ transition: "stroke-dasharray 300ms ease, stroke-dashoffset 300ms ease" }}
              />
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        {idle ? (
          <span className="text-[13px] font-semibold text-text-tertiary px-3">
            {totalLabel}
          </span>
        ) : (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              {totalUnit ? "" : ""}
            </span>
            <span
              className="font-mono font-bold flex items-baseline gap-1"
              style={{ color: HOUSE_COLOR, fontSize: "26px", lineHeight: 1 }}
            >
              <span>{totalLabel}</span>
              {totalUnit && (
                <span className="text-[12px] text-text-tertiary font-semibold">
                  {totalUnit}
                </span>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function LegendRow({
  row,
  total,
  t,
}: {
  row: SubmeterRow;
  total: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const isOffline = row.status === "offline";
  const noData = row.power === null && !isOffline;
  const pct =
    row.power !== null && total > 0
      ? Math.round((row.power / total) * 100)
      : null;
  const power = row.power !== null ? formatPower(row.power) : null;

  return (
    <div
      className={`grid grid-cols-[10px_1fr_auto_auto] gap-x-3 items-center text-[13px] ${
        isOffline || noData ? "opacity-60" : ""
      }`}
    >
      <span
        className="w-[10px] h-[10px] rounded-[2px]"
        style={{ background: row.color }}
      />
      <div className="flex flex-col min-w-0">
        <span className="font-medium text-text truncate">{row.name}</span>
        {isOffline && (
          <span className="text-[11px] text-text-tertiary">
            {t("energy.live.breakdown.offline")}
            {row.offlineSince && ` · ${formatRelative(row.offlineSince)}`}
          </span>
        )}
        {noData && (
          <span className="text-[11px] text-text-tertiary">
            {t("energy.live.breakdown.noData")}
          </span>
        )}
      </div>
      <span className="font-mono font-medium text-text-secondary min-w-[64px] text-right">
        {power ? `${power.num} ${power.unit}` : "—"}
      </span>
      <span className="font-mono font-semibold text-text-tertiary min-w-[40px] text-right">
        {pct !== null ? `${pct}%` : ""}
      </span>
    </div>
  );
}

function buildAriaLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  rows: SubmeterRow[],
  other: number,
  total: number,
  hasMainMeter: boolean,
): string {
  const p = formatPower(total);
  const parts = [`${p.num} ${p.unit}`];
  for (const r of rows) {
    if (r.power === null) continue;
    const pct = total > 0 ? Math.round((r.power / total) * 100) : 0;
    parts.push(`${r.name} ${pct}%`);
  }
  if (hasMainMeter && other > 0 && total > 0) {
    parts.push(`${t("energy.live.breakdown.other")} ${Math.round((other / total) * 100)}%`);
  }
  return parts.join(", ");
}
