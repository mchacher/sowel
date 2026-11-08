/**
 * Live energy diagram — instant power flow between grid, house and solar.
 *
 * Sources are AUTO-DETECTED from equipment type:
 *   - Grid    = equipments of type `main_energy_meter`     (signed `power`, +import / -export)
 *   - Solar   = equipments of type `energy_production_meter` (positive `power`)
 * If multiple equipments of either type expose `power`, their values are summed.
 *
 * Flow model:
 *   P_house = P_grid + P_solar  (signs respected)
 *   importing  → P_grid > 0  → dots flow grid → house, slate-blue
 *   exporting  → P_grid < 0  → dots flow solar → grid, green
 *   solar > 0  → dots flow solar → house, green
 */

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Snowflake, WifiOff } from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { GridPylonIcon } from "../icons/GridPylonIcon";
import { useEquipments } from "../../store/useEquipments";
import type { EquipmentWithDetails } from "../../types";
import { EnergyMobileNav } from "./EnergyMobileNav";
import { LiveSubmeterBreakdown } from "./LiveSubmeterBreakdown";
import { localProductionW } from "./submeter-helpers";
import { PhaseBreakdown } from "./PhaseBreakdown";
import { useWsSubscription } from "../../hooks/useWsSubscription";
import { ArbitrationSurface } from "./ArbitrationSurface";
import { FlowDiagram } from "../flow/FlowDiagram";
import { formatRelative } from "../../lib/format-relative";
import { formatPercent, formatPower, formatPowerParts, type QuantityParts } from "../../lib/format";
import { detectLiveStaleness, type LiveStalenessEntry } from "./live-staleness";
import { liveHeadline, BALANCE_THRESHOLD_W, type LiveHeadline } from "./live-headline";
import type { FlowHeadline } from "../flow/flow-geometry";
import { useStalenessClock } from "../../hooks/useStalenessClock";

// Sowel energy palette (matches EnergyBarChart.tsx + extends with grid colours)
// Spec 148 — energy palette tokens (dark-mode correct), shared across energy UI.
const HP_COLOR = "var(--color-energy-hp)"; // House consumption (vivid blue, focal)
const GRID_COLOR = "var(--color-energy-grid)"; // Grid import (slate blue)
const GRID_OFF_COLOR = "var(--color-text-tertiary)"; // Grid passive (neutral, on export)
const AUTO_COLOR = "var(--color-solar-auto)"; // Solar / autoconso (green)
const INJECTION_COLOR = "var(--color-solar-injection)"; // Export (dark green)

// ── Helpers ─────────────────────────────────────────────────────────────

/** Sum the `power` alias across a list of equipments. Returns null if none expose it. */
function sumPower(equipments: EquipmentWithDetails[]): number | null {
  let total = 0;
  let any = false;
  for (const eq of equipments) {
    const b = eq.dataBindings.find((db) => db.alias === "power");
    if (b && typeof b.value === "number") {
      total += b.value;
      any = true;
    }
  }
  return any ? total : null;
}

/** A node's figure: whole watts rounded to 5 below a kilowatt (a 1 Hz meter
 *  would otherwise flicker the last digit), kW with one decimal above. The
 *  direction is carried by the word under it (« import » / « export »), so the
 *  figure is unsigned. */
function nodePower(value: number | null): QuantityParts {
  return formatPowerParts(value === null ? null : Math.abs(value), { step: 5 });
}

// ── Page ────────────────────────────────────────────────────────────────

export function LiveEnergyPage() {
  const { t } = useTranslation();
  // Subscribe to equipments topic so equipment.data.changed events flow to
  // the Zustand store and re-render this page in real time (~1 Hz from Shelly).
  useWsSubscription(["equipments", "energy"]);
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);

  useEffect(() => {
    fetchEquipments();
  }, [fetchEquipments]);

  // Auto-detect by equipment type. If multiple of either type, sum their powers.
  const gridEqs = useMemo(
    () => equipments.filter((e) => e.type === "main_energy_meter"),
    [equipments],
  );
  const solarEqs = useMemo(
    () => equipments.filter((e) => e.type === "energy_production_meter"),
    [equipments],
  );

  // A meter that goes silent sends no event, so nothing would re-render this
  // page at the moment its reading ages out — hence a clock of our own.
  const clock = useStalenessClock();
  const gridPower = sumPower(gridEqs);
  // Spec 195 — a panel wired behind a submeter is solar the production meter
  // never sees, while the grid meter already does: leaving it out would put
  // the house below what it really draws.
  const localSolar = localProductionW(equipments, clock);
  const meteredSolar = sumPower(solarEqs);
  const solarPower =
    meteredSolar === null && localSolar === null ? null : (meteredSolar ?? 0) + (localSolar ?? 0);
  const hasSources = gridEqs.length > 0 || solarEqs.length > 0;
  const staleness = useMemo(
    () => detectLiveStaleness(gridEqs, solarEqs, clock),
    [gridEqs, solarEqs, clock],
  );

  return (
    <div className="p-4 sm:p-6">
      <EnergyMobileNav />
      <div className="hidden lg:flex items-center gap-1.5 mb-6">
        <h1>{t("energy.live")}</h1>
      </div>

      {staleness.map((entry) => (
        <StalenessBanner key={entry.source} entry={entry} />
      ))}

      {!hasSources ? (
        <EmptyState />
      ) : (
        <>
          {/* Spec 197 (FR-E3.1) — from `lg` the flow and the breakdown share a
              row, the phases under the breakdown. Below `lg` the right column
              dissolves (`contents`) and the order classes keep the stacking
              of before: flow, phases, breakdown. */}
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[7fr_5fr] lg:items-stretch">
            <LiveDiagram
              gridPower={gridPower}
              solarPower={solarPower}
              staleness={staleness}
              className="order-1 lg:order-none"
            />
            <div className="contents lg:flex lg:flex-col lg:gap-4 lg:min-w-0">
              <LiveSubmeterBreakdown
                house={
                  gridPower !== null || solarPower !== null
                    ? Math.max(0, (gridPower ?? 0) + (solarPower ?? 0))
                    : null
                }
                hasMainMeter={gridEqs.length > 0}
                className="order-3 lg:order-none lg:flex-1"
              />
              <PhaseBreakdown gridEquipments={gridEqs} className="order-2 lg:order-none" />
            </div>
          </div>
          {/* Spec 140 / FR-10 — arbitration surface (renders only when the
              arbiter is enabled; a no-PV home never sees dead UI here) */}
          <ArbitrationSurface />
        </>
      )}
    </div>
  );
}

// ── Staleness banner ────────────────────────────────────────────────────

/**
 * One line per affected source, each carrying its own age (#854). A grid meter
 * off the network for 20 minutes and a production reading 3 minutes old are
 * two different facts, and one joined sentence would lend the older age to the
 * fresher figure.
 */
function StalenessBanner({ entry }: { entry: LiveStalenessEntry }) {
  const { t } = useTranslation();
  const source = t(
    entry.source === "grid" ? "energy.live.label.grid" : "energy.live.label.production",
  );
  const when = formatRelative(entry.since, t);
  const key =
    entry.mode === "offline"
      ? when === ""
        ? "energy.live.sourceOfflineUnknown"
        : "energy.live.sourceOffline"
      : entry.mode === "frozen"
        ? "energy.live.sourceFrozen"
        : "energy.live.sourceStale";
  return (
    <div
      className={`mb-4 flex items-center gap-2 rounded-md border px-4 py-3 text-small ${
        entry.mode === "offline"
          ? "bg-error/10 border-error/20 text-error"
          : "bg-warning/10 border-warning/20 text-warning-ink"
      }`}
      role="status"
    >
      {entry.mode === "offline" ? (
        <WifiOff size={16} strokeWidth={1.75} />
      ) : entry.mode === "frozen" ? (
        <Snowflake size={16} strokeWidth={1.75} />
      ) : (
        <Clock size={16} strokeWidth={1.75} />
      )}
      <span className="font-medium">{t(key, { source, when })}</span>
    </div>
  );
}

// ── Diagram ─────────────────────────────────────────────────────────────

function LiveDiagram({
  gridPower,
  solarPower,
  staleness,
  className,
}: {
  gridPower: number | null;
  solarPower: number | null;
  staleness: LiveStalenessEntry[];
  className?: string;
}) {
  const { t } = useTranslation();
  const grid = gridPower ?? 0;
  const solar = solarPower ?? 0;
  const exporting = grid < 0;
  const house = Math.max(0, grid + solar);

  // Three independent flows — each visible only when carrying energy.
  //   solar→house : production used locally
  //   grid→house  : imported supply (only when importing)
  //   solar→grid  : surplus exported (only when exporting)
  const flowSolarToHouse = Math.max(0, Math.min(solar, house));
  const flowGridToHouse = Math.max(0, grid);
  const flowSolarToGrid = Math.max(0, -grid);

  const gridColor = exporting ? GRID_OFF_COLOR : GRID_COLOR;

  // Percentages displayed on each curve.
  //   import + solar:  GH = % of conso from grid, SH = % of conso from solar (sum = 100)
  //   export:          SH = % of production used by house, SG = % of production exported (sum = 100)
  let pctGH: number | null = null;
  let pctSH: number | null = null;
  let pctSG: number | null = null;
  if (!exporting && house > 5) {
    if (flowGridToHouse > 0) pctGH = Math.round((flowGridToHouse / house) * 100);
    if (flowSolarToHouse > 0) pctSH = Math.round((flowSolarToHouse / house) * 100);
  } else if (exporting && solar > 5) {
    if (flowSolarToHouse > 0) pctSH = Math.round((flowSolarToHouse / solar) * 100);
    if (flowSolarToGrid > 0) pctSG = Math.round((flowSolarToGrid / solar) * 100);
  }

  const houseValue = nodePower(gridPower !== null || solarPower !== null ? house : null);
  const gridValue = nodePower(gridPower !== null ? grid : null);
  const solarValue = nodePower(solarPower !== null ? solar : null);

  // Spec 197 (FR-E1) — the balance line, and the same facts for a screen
  // reader. The grid's age wins when both sources are late: it is the figure.
  const staleEntry =
    staleness.find((e) => e.source === "grid") ?? staleness.find((e) => e.source === "solar");
  const balance = liveHeadline({
    gridW: gridPower,
    solarW: solarPower,
    stale: staleEntry ? { source: staleEntry.source, since: staleEntry.since } : null,
  });
  const gridWord =
    gridPower === null || Math.abs(grid) < BALANCE_THRESHOLD_W
      ? undefined
      : t(exporting ? "energy.live.grid.export" : "energy.live.grid.import");

  return (
    <div className={`card p-4 sm:p-6 min-w-0 ${className ?? ""}`}>
      <SectionHeader title={t("energy.live.diagram.title")} />
      <FlowDiagram
        headline={buildHeadline(balance, t)}
        ariaLabel={buildAriaLabel(balance, gridPower, solarPower, t)}
        links={[
          {
            edge: "leftToFocal",
            color: gridColor,
            active: flowGridToHouse > 0,
            powerW: flowGridToHouse,
            ...(pctGH !== null ? { pill: { text: formatPercent(pctGH) } } : {}),
          },
          {
            edge: "rightToFocal",
            color: AUTO_COLOR,
            active: flowSolarToHouse > 0,
            powerW: flowSolarToHouse,
            ...(pctSH !== null ? { pill: { text: formatPercent(pctSH) } } : {}),
          },
          {
            edge: "rightToLeft",
            color: AUTO_COLOR,
            active: flowSolarToGrid > 0,
            powerW: flowSolarToGrid,
            ...(pctSG !== null ? { pill: { text: formatPercent(pctSG) } } : {}),
          },
        ]}
        nodes={[
          {
            slot: "focal",
            label: t("energy.live.label.consumption"),
            color: HP_COLOR,
            value: houseValue.value,
            unit: houseValue.unit,
            icon: (
              <svg
                className="w-11 h-11 sm:w-14 sm:h-14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3 L20 11 Q21 12 20 13 L20 19 Q20 20 19 20 L5 20 Q4 20 4 19 L4 13 Q3 12 4 11 Z" />
                {/* Lightning bolt inside the house body — flash-1-svgrepo-com.svg
                 * scaled and centered. vector-effect keeps the stroke crisp despite
                 * the 0.4 transform scale. */}
                <g transform="translate(12 13) scale(0.42) translate(-12 -12)">
                  <path
                    d="M6.09 13.28H9.18V20.48C9.18 22.16 10.09 22.5 11.2 21.24L18.77 12.64C19.7 11.59 19.31 10.72 17.9 10.72H14.81V3.52C14.81 1.84 13.9 1.5 12.79 2.76L5.22 11.36C4.3 12.42 4.69 13.28 6.09 13.28Z"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              </svg>
            ),
          },
          {
            slot: "left",
            label: t("energy.live.label.grid"),
            color: gridColor,
            dimmed: Math.abs(grid) < BALANCE_THRESHOLD_W,
            value: gridValue.value,
            unit: gridValue.unit,
            sub: gridWord,
            icon: <GridPylonIcon className="w-9 h-9 sm:w-10 sm:h-10" />,
          },
          {
            slot: "right",
            label: t("energy.live.label.production"),
            color: AUTO_COLOR,
            dimmed: solar < BALANCE_THRESHOLD_W,
            value: solarValue.value,
            unit: solarValue.unit,
            icon: <SolarPanelIcon className="w-9 h-9 sm:w-10 sm:h-10" strokeWidth={1.4} />,
          },
        ]}
      />
    </div>
  );
}

type T = (key: string, opts?: Record<string, unknown>) => string;

const HEADLINE_DOT: Record<LiveHeadline["kind"], string> = {
  import: GRID_COLOR,
  export: INJECTION_COLOR,
  self: AUTO_COLOR,
  "consumption-only": HP_COLOR,
};

/** The balance line's words, from the pure verdict (spec 197, FR-E1.1). */
function buildHeadline(h: LiveHeadline, t: T): FlowHeadline {
  const value = nodePower(h.valueW);
  const consumption = formatPower(h.consumptionW, { step: 5 });
  let sentence: string | null = null;
  if (h.kind === "export") {
    sentence = t("energy.live.headline.sentence.export", { consumption });
  } else if (h.kind === "self" || h.kind === "import") {
    sentence =
      h.solarPct === null
        ? t("energy.live.headline.sentence.noSolar")
        : t("energy.live.headline.sentence.covered", {
            pct: formatPercent(h.solarPct),
            consumption,
          });
  }
  const when = h.stale ? formatRelative(h.stale.since, t) : "";
  return {
    dotColor: HEADLINE_DOT[h.kind],
    label: t(`energy.live.headline.${h.kind}`),
    value: value.value,
    unit: value.unit,
    sentence:
      sentence !== null || h.stale ? (
        <>
          {sentence}
          {h.stale && (
            <span className="text-warning-ink">
              {sentence !== null ? " · " : ""}
              {when === ""
                ? t("energy.live.headline.staleUnknown")
                : t("energy.live.headline.stale", { when })}
            </span>
          )}
        </>
      ) : undefined,
  };
}

/**
 * The whole flow as one sentence for a screen reader (FR-E1.5): the visible
 * figures are hidden from it, so this must carry all of them.
 */
function buildAriaLabel(
  h: LiveHeadline,
  gridPower: number | null,
  solarPower: number | null,
  t: T,
): string {
  const power = (w: number | null) => formatPower(w === null ? null : Math.abs(w), { step: 5 });
  const consumption = power(h.consumptionW);
  if (h.kind === "consumption-only") return t("energy.live.aria.consumption", { consumption });
  const grid = power(gridPower);
  const solar = power(solarPower);
  if (h.kind === "export") return t("energy.live.aria.export", { consumption, solar, grid });
  if (h.kind === "self") return t("energy.live.aria.self", { consumption, solar });
  if (h.solarPct === null) return t("energy.live.aria.importOnly", { consumption, grid });
  return t("energy.live.aria.import", {
    consumption,
    grid,
    solar,
    gridPct: formatPercent(100 - h.solarPct),
    solarPct: formatPercent(h.solarPct),
  });
}

// ── Empty state ─────────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="card p-10 text-center max-w-[480px] mx-auto">
      <h2 className="text-lead font-semibold text-text mb-2">{t("energy.live.empty.title")}</h2>
      <p className="text-small text-text-secondary">{t("energy.live.empty.help")}</p>
    </div>
  );
}
