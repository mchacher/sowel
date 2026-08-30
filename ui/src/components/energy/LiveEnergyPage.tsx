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
 *   importing  → P_grid > 0  → bubbles flow grid → house, slate-blue
 *   exporting  → P_grid < 0  → bubbles flow solar → grid, green
 *   solar > 0  → bubbles flow solar → house, green
 */

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Waypoints, WifiOff } from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { GridPylonIcon } from "../icons/GridPylonIcon";
import { useEquipments } from "../../store/useEquipments";
import type { EquipmentWithDetails } from "../../types";
import { EnergyMobileNav } from "./EnergyMobileNav";
import { LiveSubmeterBreakdown } from "./LiveSubmeterBreakdown";
import { PhaseBreakdown } from "./PhaseBreakdown";
import { useWsSubscription } from "../../hooks/useWsSubscription";
import { ArbitrationSurface } from "./ArbitrationSurface";
import { FlowDiagram } from "../flow/FlowDiagram";
import { formatRelative } from "../../lib/format-relative";

// Sowel energy palette (matches EnergyBarChart.tsx + extends with grid colours)
// Spec 148 — energy palette tokens (dark-mode correct), shared across energy UI.
const HP_COLOR = "var(--color-energy-hp)"; // House consumption (vivid blue, focal)
const GRID_COLOR = "var(--color-energy-grid)"; // Grid import (slate blue)
const GRID_OFF_COLOR = "var(--color-text-tertiary)"; // Grid passive (neutral, on export)
const AUTO_COLOR = "var(--color-solar-auto)"; // Solar / autoconso (green)

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

/**
 * Spec 116: detect whether the live diagram is showing trustworthy data.
 * Returns null when everything is online — caller renders nothing.
 * Returns { mode: "stale" | "offline", oldestSince } when the upstream
 * meters are degraded or fully offline.
 */
function detectLiveStaleness(
  contributors: EquipmentWithDetails[],
): { mode: "stale" | "offline"; oldestSince: string | null } | null {
  if (contributors.length === 0) return null;
  const anyDegraded = contributors.some((e) => e.status === "degraded" || e.status === "offline");
  if (!anyDegraded) return null;
  const allOffline = contributors.every((e) => e.status === "offline");
  const sinces = contributors
    .map((e) => e.statusReason?.offlineSince ?? null)
    .filter((s): s is string => s !== null);
  const oldestSince = sinces.length > 0 ? sinces.reduce((a, b) => (a < b ? a : b)) : null;
  return { mode: allOffline ? "offline" : "stale", oldestSince };
}

/** Format a power value:
 *  - |value| < 1000 W → integer W rounded to the nearest 5 (smooth display)
 *  - |value| ≥ 1000 W → kW with one decimal
 */
function formatPower(value: number | null): { num: string; unit: "W" | "kW" } {
  if (value === null) return { num: "—", unit: "W" };
  const a = Math.abs(value);
  if (a < 1000) {
    const rounded = Math.round(a / 5) * 5;
    return { num: String(rounded), unit: "W" };
  }
  return { num: (a / 1000).toFixed(1), unit: "kW" };
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

  const gridPower = sumPower(gridEqs);
  const solarPower = sumPower(solarEqs);
  const hasSources = gridEqs.length > 0 || solarEqs.length > 0;
  const staleness = useMemo(
    () => detectLiveStaleness([...gridEqs, ...solarEqs]),
    [gridEqs, solarEqs],
  );

  return (
    <div className="p-4 sm:p-6">
      <EnergyMobileNav />
      <div className="hidden sm:flex items-center gap-1.5 mb-6">
        <h1>{t("energy.live")}</h1>
      </div>

      {staleness && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-[10px] border px-4 py-3 text-[13px] ${
            staleness.mode === "offline"
              ? "bg-error/10 border-error/20 text-error"
              : "bg-warning/10 border-warning/20 text-warning"
          }`}
          role="status"
        >
          {staleness.mode === "offline" ? (
            <WifiOff size={16} strokeWidth={1.75} />
          ) : (
            <Clock size={16} strokeWidth={1.75} />
          )}
          <span className="font-medium">
            {t(
              staleness.mode === "offline" ? "energy.live.metersOffline" : "energy.live.dataStale",
              { when: formatRelative(staleness.oldestSince) },
            )}
          </span>
        </div>
      )}

      {!hasSources ? (
        <EmptyState />
      ) : (
        <>
          <LiveDiagram gridPower={gridPower} solarPower={solarPower} />
          <PhaseBreakdown gridEquipments={gridEqs} />
          <LiveSubmeterBreakdown
            house={
              gridPower !== null || solarPower !== null
                ? Math.max(0, (gridPower ?? 0) + (solarPower ?? 0))
                : null
            }
            hasMainMeter={gridEqs.length > 0}
          />
          {/* Spec 140 / FR-10 — arbitration surface (renders only when the
              arbiter is enabled; a no-PV home never sees dead UI here) */}
          <ArbitrationSurface />
        </>
      )}
    </div>
  );
}

// ── Diagram ─────────────────────────────────────────────────────────────

function LiveDiagram({
  gridPower,
  solarPower,
}: {
  gridPower: number | null;
  solarPower: number | null;
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

  // Qualitative status — single-tag summary shown beneath the diagram.
  // The mixed case is split by *which source dominates* the house supply:
  // "appoint" is always the supplement, never the main source.
  //
  //   solar < 5W                                  → "Réseau seul"
  //   exporting (grid < -5)                       → "Excédent solaire"
  //   balanced (|grid| < 5W) + production         → "Autonome"
  //   importing + solar producing & solar ≥ grid  → "Appoint réseau"   (solar is the main)
  //   importing + solar producing & solar <  grid → "Appoint solaire"  (grid is the main)
  type Status = "grid_only" | "self" | "mixed_solar_lead" | "mixed_grid_lead" | "export";
  let status: Status;
  if (solar < 5) status = "grid_only";
  else if (grid < -5) status = "export";
  else if (grid > 5) status = solar >= grid ? "mixed_solar_lead" : "mixed_grid_lead";
  else status = "self";
  const statusColor =
    status === "export" || status === "self" || status === "mixed_solar_lead"
      ? AUTO_COLOR
      : status === "mixed_grid_lead"
        ? GRID_COLOR
        : GRID_OFF_COLOR;

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

  const houseValue = formatPower(gridPower !== null || solarPower !== null ? house : null);
  const gridValue = formatPower(gridPower !== null ? grid : null);
  const solarValue = formatPower(solarPower !== null ? solar : null);

  return (
    <div className="bg-surface border border-border rounded-[10px] p-4 sm:p-6">
      <SectionHeader icon={Waypoints} title={t("energy.live.diagram.title")} />
      <FlowDiagram
        tag={{ text: t(`energy.live.status.${status}`), color: statusColor }}
        links={[
          {
            edge: "leftToFocal",
            color: gridColor,
            active: flowGridToHouse > 0,
            magnitude: flowGridToHouse,
            ...(pctGH !== null ? { pill: { text: `${pctGH}%`, color: gridColor } } : {}),
          },
          {
            edge: "rightToFocal",
            color: AUTO_COLOR,
            active: flowSolarToHouse > 0,
            magnitude: flowSolarToHouse,
            ...(pctSH !== null ? { pill: { text: `${pctSH}%`, color: AUTO_COLOR } } : {}),
          },
          {
            edge: "rightToLeft",
            color: AUTO_COLOR,
            active: flowSolarToGrid > 0,
            magnitude: flowSolarToGrid,
            ...(pctSG !== null ? { pill: { text: `${pctSG}%`, color: AUTO_COLOR } } : {}),
          },
        ]}
        nodes={[
          {
            slot: "focal",
            label: t("energy.live.label.consumption"),
            color: HP_COLOR,
            value: houseValue.num,
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
            dimmed: Math.abs(grid) < 5,
            value: gridValue.num,
            unit: gridValue.unit,
            valuePrefix: <span className="text-[18px] font-bold">{exporting ? "↓" : "↑"}</span>,
            icon: <GridPylonIcon className="w-9 h-9 sm:w-10 sm:h-10" />,
          },
          {
            slot: "right",
            label: t("energy.live.label.production"),
            color: AUTO_COLOR,
            dimmed: solar < 5,
            value: solarValue.num,
            unit: solarValue.unit,
            icon: <SolarPanelIcon className="w-9 h-9 sm:w-10 sm:h-10" strokeWidth={1.4} />,
          },
        ]}
      />
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="bg-surface border border-border rounded-[10px] p-10 text-center max-w-[480px] mx-auto">
      <h2 className="text-[16px] font-semibold text-text mb-2">{t("energy.live.empty.title")}</h2>
      <p className="text-[13px] text-text-secondary">{t("energy.live.empty.help")}</p>
    </div>
  );
}
