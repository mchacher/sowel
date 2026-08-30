/**
 * Live submeter breakdown — donut + legend rendered below the existing
 * Maison/Réseau/Solaire flow diagram on the Live energy page (spec 117).
 *
 * Reactive: pulls equipments straight from the Zustand store, which is
 * already updated by the WebSocket `equipment.data.changed` events the
 * parent page subscribes to.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import {
  buildSubmeterRows,
  computeOther,
  displayedPower,
  sharePercent,
  type SubmeterRow,
} from "./submeter-helpers";
import { isSubmeterEquipment } from "../../lib/metering";
import {
  equipmentLabelMap,
  flattenZonesWithPath,
  zoneChainMap,
} from "../../lib/zone-path";
import { formatRelative } from "../../lib/format-relative";

const HOUSE_COLOR = "#4F7BE8"; // matches HP_COLOR in LiveEnergyPage
const OTHER_COLOR = "#A1A1AA"; // var(--n-300), neutral grey

const RADIUS = 72;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Below this house power, the donut would be all rounding noise. */
const IDLE_THRESHOLD_W = 5;
/** Show the overshoot footnote only when Σ exceeds house by > 5%. */
const OVERSHOOT_RATIO = 0.05;
/**
 * How often the card re-checks reading ages against the wall clock (#744).
 *
 * Without it a row only ages out when some unrelated equipment event happens
 * to re-render the page. In a home whose only sources poll every 300 s the
 * recompute would land at the poll, with the reading 0 s old, so the rule
 * would silently never apply; in a home with a 1 Hz main meter it would apply
 * continuously. Same code, opposite behaviour, decided by unrelated hardware.
 */
const STALENESS_TICK_MS = 30_000;

interface Props {
  /** House consumption in W (grid + solar). Null when both are unknown. */
  house: number | null;
  /** True when a `main_energy_meter` exists. Controls "Autre" rendering. */
  hasMainMeter: boolean;
}

function formatPower(value: number): { num: string; unit: "W" | "kW" } {
  // One rounding, shared with sharePercent's denominator, so the figures on
  // screen cannot contradict each other (#744).
  const shown = displayedPower(value);
  if (value < 1000) {
    return { num: String(shown), unit: "W" };
  }
  return { num: (shown / 1000).toFixed(1), unit: "kW" };
}


export function LiveSubmeterBreakdown({ house, hasMainMeter }: Props) {
  const { t } = useTranslation();
  const equipments = useEquipments((s) => s.equipments);
  const zoneTree = useZones((s) => s.tree);

  // Homonym submeters get a `name — zone` label (spec 139); the qualifier
  // only appears when two submeters actually share a name.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), STALENESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const labels = equipmentLabelMap(
      equipments.filter((eq) => isSubmeterEquipment(eq)),
      zoneChainMap(flattenZonesWithPath(zoneTree)),
    );
    return buildSubmeterRows(equipments, labels, clock);
  }, [equipments, zoneTree, clock]);
  if (rows.length === 0) return null;

  const submeterSum = rows.reduce((acc, r) => acc + (r.power ?? 0), 0);
  // Without a main meter, the donut represents the sum of all submeters
  // (no residual segment, consistent with spec 091 acceptance criterion).
  const total = hasMainMeter ? Math.max(0, house ?? 0) : submeterSum;
  const other = hasMainMeter ? computeOther(total, rows) : 0;
  const overshoot =
    hasMainMeter && submeterSum > total * (1 + OVERSHOOT_RATIO);
  const hasStale = rows.some((r) => r.unknown === "stale");

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
                {sharePercent(other, total) !== null ? `${sharePercent(other, total)}%` : "—"}
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

      {/* A load with no recent reading contributes nothing, so its watts are
          still in the house total and land in the residual. Both facts are
          true and nothing on screen connected them, which reads as an
          unmetered load appearing from nowhere (#744). */}
      {hasStale && (
        <p className="mt-3 text-[12px] text-text-tertiary italic">
          {t("energy.live.breakdown.staleNote")}
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
  // The parts are held to one circle. Before #744 the fractions were drawn
  // unclamped, so a part larger than the whole produced arcs that wrapped over
  // themselves: two plausible-looking wedges bearing no relation to the numbers
  // beneath them. A ring that stops at full is at least readable as "we cannot
  // account for this", which is what the footnote then says.
  const segments: DonutSegment[] = [];
  let remaining = 1;
  const push = (id: string, color: string, value: number) => {
    if (remaining <= 0) return;
    const fraction = Math.min(value / total, remaining);
    if (fraction <= 0) return;
    segments.push({ id, color, fraction });
    remaining -= fraction;
  };
  for (const r of rows) {
    if (r.power === null || r.power <= 0) continue;
    push(r.id, r.color, r.power);
  }
  if (other > 0) push("__other__", OTHER_COLOR, other);
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
  const isStale = row.unknown === "stale";
  const pct = row.power !== null ? sharePercent(row.power, total) : null;
  const power = row.power !== null ? formatPower(row.power) : null;

  return (
    <div
      className={`grid grid-cols-[10px_1fr_auto_auto] gap-x-3 items-center text-[13px] ${
        isOffline || isStale ? "opacity-60" : ""
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
        {/* Not "0 W": the row says the reading is old rather than presenting a
            number the household has no reason to doubt (#744). */}
        {!isOffline && isStale && (
          <span className="text-[11px] text-text-tertiary">
            {t("energy.live.breakdown.stale")}
            {row.staleSince && ` · ${formatRelative(row.staleSince)}`}
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
    if (r.power === null) {
      // A screen reader gets the same answer the sighted reader does: this row
      // has no current measurement, rather than a silently omitted one (#744).
      const why =
        r.status === "offline"
          ? t("energy.live.breakdown.offline")
          : r.unknown === "stale"
            ? t("energy.live.breakdown.stale")
            : null;
      if (why) parts.push(`${r.name} ${why}`);
      continue;
    }
    parts.push(`${r.name} ${sharePercent(r.power, total) ?? 0}%`);
  }
  if (hasMainMeter && other > 0) {
    const pct = sharePercent(other, total);
    if (pct !== null) parts.push(`${t("energy.live.breakdown.other")} ${pct}%`);
  }
  return parts.join(", ");
}
