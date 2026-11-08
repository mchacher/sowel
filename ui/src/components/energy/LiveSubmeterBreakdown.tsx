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
import { useZones } from "../../store/useZones";
import {
  buildSubmeterRows,
  computeOther,
  sharePercent,
  splitStoppedRows,
  type SubmeterRow,
} from "./submeter-helpers";
import { isSubmeterEquipment } from "../../lib/metering";
import { equipmentLabelMap, flattenZonesWithPath, zoneChainMap } from "../../lib/zone-path";
import { formatRelative } from "../../lib/format-relative";
import { formatPercent, formatPower, formatPowerParts } from "../../lib/format";
import { SectionHeader } from "./SectionHeader";
import { useStalenessClock } from "../../hooks/useStalenessClock";

const OTHER_COLOR = "var(--color-energy-other)"; // neutral grey, one value per theme (tokens.css)

const RADIUS = 72;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/**
 * Spec 197 (FR-E3.3) — the gap between two segments, in viewBox units: about
 * 2 px at both drawn sizes (180 px, 140 px on a phone). Two neighbours of the
 * series palette can sit side by side here at 1.3:1, so the boundary is drawn
 * by the card itself.
 */
const SEGMENT_GAP = 2.5;
/** Below this house power, the donut would be all rounding noise. */
const IDLE_THRESHOLD_W = 5;
/** Show the overshoot footnote only when Σ exceeds house by > 5%. */
const OVERSHOOT_RATIO = 0.05;

interface Props {
  /** House consumption in W (grid + solar). Null when both are unknown. */
  house: number | null;
  /** True when a `main_energy_meter` exists. Controls "Autre" rendering. */
  hasMainMeter: boolean;
  /** Placement classes from the page's grid (spec 197, FR-E3.1). */
  className?: string;
}

/**
 * Watts rounded to 5 below a kilowatt, kW with one decimal above: the one
 * rounding `displayedPower` also uses for the shares, so the figures on screen
 * cannot contradict each other (#744).
 */
const POWER = { step: 5 } as const;

export function LiveSubmeterBreakdown({ house, hasMainMeter, className }: Props) {
  const { t } = useTranslation();
  const equipments = useEquipments((s) => s.equipments);
  const zoneTree = useZones((s) => s.tree);

  const clock = useStalenessClock();

  // Homonym submeters get a `name — zone` label (spec 139); the qualifier
  // only appears when two submeters actually share a name.
  const rows = useMemo(() => {
    const labels = equipmentLabelMap(
      equipments.filter((eq) => isSubmeterEquipment(eq)),
      zoneChainMap(flattenZonesWithPath(zoneTree)),
    );
    return buildSubmeterRows(equipments, labels, clock);
  }, [equipments, zoneTree, clock]);
  if (rows.length === 0) return null;

  // Spec 179 — a meter on a separate supply never enters the donut, the
  // residual or the shares: its watts were not in the house total to begin
  // with. It keeps a group of its own below the reconciled legend.
  const partitionRows = rows.filter((r) => !r.separateSupply);
  const separateRows = rows.filter((r) => r.separateSupply);

  const submeterSum = partitionRows.reduce((acc, r) => acc + (r.power ?? 0), 0);
  // Without a main meter, the donut represents the sum of all submeters
  // (no residual segment, consistent with spec 091 acceptance criterion).
  const total = hasMainMeter ? Math.max(0, house ?? 0) : submeterSum;
  const other = hasMainMeter ? computeOther(total, partitionRows) : 0;
  const overshoot = hasMainMeter && submeterSum > total * (1 + OVERSHOOT_RATIO);
  const hasStale = rows.some((r) => r.unknown === "stale");

  const isIdle = total < IDLE_THRESHOLD_W;
  // Spec 197 (FR-E3.2) — the appliances at 0 W fold into one line; the
  // donut follows the list, so its segments are the active rows then Autre.
  const { active, stopped } = splitStoppedRows(partitionRows);
  const segments = isIdle ? [] : buildSegments(active, other, total);

  const t_total = formatPowerParts(total, POWER);

  return (
    <div className={`card p-4 sm:p-6 flex flex-col ${className ?? ""}`}>
      <SectionHeader title={t("energy.live.breakdown.title")} />

      {/* #1170 — one layout on every width: the donut, its legend under it,
          the block centred. From lg the card is stretched to the flow card's
          height, and a row at its top left an empty band below; on a
          full-width tablet card the cap keeps the legend near its donut. */}
      <div
        className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto"
        data-testid="breakdown-body"
      >
        <div className="flex flex-col items-center gap-6">
          <Donut
            segments={segments}
            totalLabel={isIdle ? t("energy.live.breakdown.houseIdle") : t_total.value}
            totalUnit={isIdle ? null : t_total.unit}
            ariaLabel={buildAriaLabel(t, partitionRows, other, total, hasMainMeter)}
            idle={isIdle}
          />

          <div className="w-full flex flex-col gap-2" data-testid="breakdown-legend">
            {active.map((row) => (
              <LegendRow key={row.id} row={row} total={total} t={t} />
            ))}
            {/* « Autre » is the unmetered part, often the largest: a full row,
              last, saying what it is (spec 197, FR-E3.2). */}
            {hasMainMeter && other > 0 && (
              <div
                className="grid grid-cols-[10px_1fr_auto_auto] gap-x-3 items-center text-small"
                data-testid="breakdown-other"
              >
                <span
                  className="w-[10px] h-[10px] rounded-xs"
                  style={{ background: OTHER_COLOR }}
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-text">{t("energy.live.breakdown.other")}</span>
                  <span className="text-micro text-text-tertiary">
                    {t("energy.live.breakdown.unmetered")}
                  </span>
                </div>
                <span className="tabular-nums font-medium text-text-secondary min-w-[64px] text-right">
                  {formatPower(other, POWER)}
                </span>
                <span className="tabular-nums font-semibold text-text-tertiary min-w-[40px] text-right">
                  {formatPercent(sharePercent(other, total))}
                </span>
              </div>
            )}
            {stopped.length > 0 && (
              <p className="text-caption text-text-tertiary" data-testid="breakdown-stopped">
                {t("energy.live.breakdown.stopped", {
                  names: stopped.map((r) => r.name).join(", "),
                })}
              </p>
            )}

            {/* Spec 179 — meters on their own supply: watts shown, no share of a
              donut whose total never carried them. */}
            {separateRows.length > 0 && (
              <>
                <div className="mt-2 pt-2 border-t border-border text-caption font-medium text-text-tertiary">
                  {t("energy.byUsage.separateSupply")}
                </div>
                {separateRows.map((row) => (
                  <LegendRow key={row.id} row={row} total={null} t={t} />
                ))}
              </>
            )}
          </div>
        </div>

        {overshoot && (
          <p className="mt-3 text-caption text-warning-ink italic">
            {t("energy.live.breakdown.overshoot")}
          </p>
        )}

        {/* A load with no recent reading contributes nothing, so its watts are
          still in the house total and land in the residual. Both facts are
          true and nothing on screen connected them, which reads as an
          unmetered load appearing from nowhere (#744). */}
        {hasStale && (
          <p className="mt-3 text-caption text-text-tertiary italic">
            {t("energy.live.breakdown.staleNote")}
          </p>
        )}
      </div>
    </div>
  );
}

interface DonutSegment {
  id: string;
  color: string;
  /** Fraction in [0, 1] of the full circle. */
  fraction: number;
}

function buildSegments(rows: SubmeterRow[], other: number, total: number): DonutSegment[] {
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
  totalUnit: string | null;
  ariaLabel: string;
  idle: boolean;
}) {
  const offsets: number[] = [];
  let acc = 0;
  for (const s of segments) {
    offsets.push(acc);
    acc += s.fraction;
  }
  // The faint track shows only where no segment is drawn: under a full ring
  // it would fill the gaps, which must show the card (spec 197, FR-E3.3).
  const showTrack = idle || acc < 0.999;
  // A lone segment is the whole ring: no boundary, so no gap.
  const gap = segments.length > 1 ? SEGMENT_GAP : 0;
  return (
    <div
      className="relative w-[140px] h-[140px] sm:w-[180px] sm:h-[180px] shrink-0"
      role="img"
      aria-label={ariaLabel}
    >
      <svg viewBox="0 0 200 200" className="block w-full h-full">
        <g transform="rotate(-90 100 100)">
          {showTrack && (
            <circle
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={STROKE}
              opacity={idle ? 1 : 0.35}
            />
          )}
          {segments.map((seg, i) => {
            // Each arc is shortened by the gap and starts half a gap late, so
            // the card shows between two neighbours. A sliver keeps 1 unit.
            const length = Math.max(1, seg.fraction * CIRCUMFERENCE - gap);
            const dasharray = `${length} ${CIRCUMFERENCE}`;
            const dashoffset = -(offsets[i] * CIRCUMFERENCE + gap / 2);
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
          <span className="text-small font-semibold text-text-tertiary px-3">{totalLabel}</span>
        ) : (
          <>
            <span
              // In ink, like the flow diagram's figures (#1126).
              className="tabular-nums font-semibold text-display leading-none flex items-baseline gap-1 text-text"
            >
              <span>{totalLabel}</span>
              {totalUnit && (
                <span className="text-caption text-text-tertiary font-semibold">{totalUnit}</span>
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
  /** Spec 179 — null for a separate-supply row: no whole, so no share. */
  total: number | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const isOffline = row.status === "offline";
  const isStale = row.unknown === "stale";
  const pct = row.power !== null && total !== null ? sharePercent(row.power, total) : null;

  return (
    <div
      className={`grid grid-cols-[10px_1fr_auto_auto] gap-x-3 items-center text-small ${
        isOffline || isStale ? "opacity-60" : ""
      }`}
    >
      <span className="w-[10px] h-[10px] rounded-xs" style={{ background: row.color }} />
      <div className="flex flex-col min-w-0">
        <span className="font-medium text-text truncate">{row.name}</span>
        {/* Spec 173 — this row is smaller than the meter's own card on purpose:
            say why here, rather than leave the reader to find the difference. */}
        {row.netOfChildren && (
          <span className="text-caption text-text-tertiary">
            {t("energy.byUsage.netOfChildren")}
          </span>
        )}
        {isOffline && (
          <span className="text-micro text-text-tertiary">
            {t("energy.live.breakdown.offline")}
            {row.offlineSince && ` · ${formatRelative(row.offlineSince, t)}`}
          </span>
        )}
        {/* Not "0 W": the row says the reading is old rather than presenting a
            number the household has no reason to doubt (#744). */}
        {!isOffline && isStale && (
          <span className="text-micro text-text-tertiary">
            {t("energy.live.breakdown.stale")}
            {row.staleSince && ` · ${formatRelative(row.staleSince, t)}`}
          </span>
        )}
      </div>
      <span className="tabular-nums font-medium text-text-secondary min-w-[64px] text-right">
        {formatPower(row.power, POWER)}
      </span>
      <span className="tabular-nums font-semibold text-text-tertiary min-w-[40px] text-right">
        {pct !== null ? formatPercent(pct) : ""}
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
  const parts = [formatPower(total, POWER)];
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
    parts.push(`${r.name} ${formatPercent(sharePercent(r.power, total) ?? 0)}`);
  }
  if (hasMainMeter && other > 0) {
    const pct = sharePercent(other, total);
    if (pct !== null) parts.push(`${t("energy.live.breakdown.other")} ${formatPercent(pct)}`);
  }
  return parts.join(", ");
}
