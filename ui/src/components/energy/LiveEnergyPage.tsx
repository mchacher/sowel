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
import { Clock, WifiOff } from "lucide-react";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { useEquipments } from "../../store/useEquipments";
import type { EquipmentWithDetails } from "../../types";
import { EnergyMobileNav } from "./EnergyMobileNav";
import { LiveSubmeterBreakdown } from "./LiveSubmeterBreakdown";
import { PhaseBreakdown } from "./PhaseBreakdown";
import { useWsSubscription } from "../../hooks/useWsSubscription";

// Sowel energy palette (matches EnergyBarChart.tsx + extends with grid colours)
const HP_COLOR = "#4F7BE8";       // House consumption (vivid blue, focal)
const GRID_COLOR = "#4A6396";     // Grid import (slate blue, distinct from house)
const GRID_OFF_COLOR = "#9CA3AF"; // Grid passive (neutral grey, on export)
const AUTO_COLOR = "#6BCB77";     // Solar / autoconso (green)

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
  const anyDegraded = contributors.some(
    (e) => e.status === "degraded" || e.status === "offline",
  );
  if (!anyDegraded) return null;
  const allOffline = contributors.every((e) => e.status === "offline");
  const sinces = contributors
    .map((e) => e.statusReason?.offlineSince ?? null)
    .filter((s): s is string => s !== null);
  const oldestSince = sinces.length > 0 ? sinces.reduce((a, b) => (a < b ? a : b)) : null;
  return { mode: allOffline ? "offline" : "stale", oldestSince };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T").replace("Z", "") + "Z";
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

/** Flow duration (s) inversely log-scaled with power. Stays calm — bubbles never zoom. */
function flowDuration(power: number): number {
  const a = Math.abs(power);
  if (a < 5) return 0;
  const d = 7 - Math.log10(a + 10) * 0.6;
  return Math.max(4, Math.min(7, d));
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

/** Small percentage pill drawn on top of a flow curve. */
function Pill({
  children,
  className,
  color,
}: {
  children: React.ReactNode;
  className?: string;
  color: string;
}) {
  return (
    <div
      className={`absolute font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-surface border z-20 ${className ?? ""}`}
      style={{ color, borderColor: color }}
    >
      {children}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export function LiveEnergyPage() {
  const { t } = useTranslation();
  // Subscribe to equipments topic so equipment.data.changed events flow to
  // the Zustand store and re-render this page in real time (~1 Hz from Shelly).
  useWsSubscription(["equipments"]);
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
              staleness.mode === "offline"
                ? "energy.live.metersOffline"
                : "energy.live.dataStale",
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
  type Status =
    | "grid_only"
    | "self"
    | "mixed_solar_lead"
    | "mixed_grid_lead"
    | "export";
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

  const dGridToHouse = flowDuration(flowGridToHouse);
  const dSolarToHouse = flowDuration(flowSolarToHouse);
  const dSolarToGrid = flowDuration(flowSolarToGrid);

  const idGH = "live-path-grid-to-house";
  const idSH = "live-path-solar-to-house";
  const idSG = "live-path-solar-to-grid";

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

  // Manhattan-routed flow lines (Legrand style). ViewBox 540 × 360 (3:2).
  //   Box geometry (heights EXPLICIT so centers are deterministic):
  //   - Maison     top-0 h-[36%] w-[36%]                          → y=0..130, center (270, 65)
  //   - Réseau     top-1/2 -translate-y-1/2 h-[29%] w-[22%] left  → y=128..232, center (60, 180)
  //   - Production top-1/2 -translate-y-1/2 h-[29%] w-[22%] right → y=128..232, center (480, 180)
  //
  //   R/P box centers at viewBox y=180 (50%). They sit just below maison's
  //   bottom edge — no horizontal collision because of their x positions.
  //
  // - pathGH: Réseau (60,180) → up → into Maison center (270,65) [enters left side]
  // - pathSH: Production (480,180) → up → into Maison center (270,65) [enters right side]
  // - pathSG: Production (480,180) → down → into Réseau (60,180) [export loop]
  const pathGH = "M 60 180 V 75 Q 60 65 70 65 H 270";
  const pathSH = "M 480 180 V 75 Q 480 65 470 65 H 270";
  const pathSG = "M 480 180 V 255 Q 480 270 470 270 H 70 Q 60 270 60 255 V 180";

  return (
    <div className="bg-surface border border-border rounded-[10px] p-4 sm:p-6">
      <div className="relative h-[300px] sm:h-auto sm:aspect-[3/2] max-w-[600px]">
        <svg
          viewBox="0 0 540 360"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full overflow-visible"
        >
          {/* Skeleton (always visible faint) — three rounded curves Legrand-style */}
          <path d={pathGH} fill="none" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round" />
          <path d={pathSH} fill="none" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round" />
          <path d={pathSG} fill="none" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round" />

          {/* Active overlays — only the curves that actually carry energy */}
          {flowGridToHouse > 0 && (
            <path d={pathGH} fill="none" stroke={gridColor} strokeWidth="2.5" strokeLinecap="round" />
          )}
          {flowSolarToHouse > 0 && (
            <path d={pathSH} fill="none" stroke={AUTO_COLOR} strokeWidth="2.5" strokeLinecap="round" />
          )}
          {flowSolarToGrid > 0 && (
            <path d={pathSG} fill="none" stroke={AUTO_COLOR} strokeWidth="2.5" strokeLinecap="round" />
          )}

          {/* Animation paths (invisible references) */}
          <path id={idGH} d={pathGH} fill="none" stroke="none" />
          <path id={idSH} d={pathSH} fill="none" stroke="none" />
          <path id={idSG} d={pathSG} fill="none" stroke="none" />

          {/* Bubbles per active flow.
           * Each circle is hidden until its stagger `begin` (otherwise it would
           * flash at SVG origin (0,0) before motion starts). */}
          {dGridToHouse > 0 && (
            <g>
              {[0, dGridToHouse / 3, (2 * dGridToHouse) / 3].map((begin, i) => (
                <circle key={`gh${i}`} r="4" fill={gridColor} opacity="0">
                  <set attributeName="opacity" to="1" begin={`${begin}s`} />
                  <animateMotion dur={`${dGridToHouse}s`} begin={`${begin}s`} repeatCount="indefinite">
                    <mpath href={`#${idGH}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
          )}
          {dSolarToHouse > 0 && (
            <g>
              {[0, dSolarToHouse / 3, (2 * dSolarToHouse) / 3].map((begin, i) => (
                <circle key={`sh${i}`} r="4" fill={AUTO_COLOR} opacity="0">
                  <set attributeName="opacity" to="1" begin={`${begin}s`} />
                  <animateMotion dur={`${dSolarToHouse}s`} begin={`${begin}s`} repeatCount="indefinite">
                    <mpath href={`#${idSH}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
          )}
          {dSolarToGrid > 0 && (
            <g>
              {[0, dSolarToGrid / 3, (2 * dSolarToGrid) / 3].map((begin, i) => (
                <circle key={`sg${i}`} r="4" fill={AUTO_COLOR} opacity="0">
                  <set attributeName="opacity" to="1" begin={`${begin}s`} />
                  <animateMotion dur={`${dSolarToGrid}s`} begin={`${begin}s`} repeatCount="indefinite">
                    <mpath href={`#${idSG}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
          )}
        </svg>

        {/* Percentage pills — pinned to mid of the VISIBLE vertical leg above each
         *  R/P box. R/P box top y=128, bend y=75 → midpoint y≈101 → top 28% (101/360).
         *  Bottom horizontal at y=270 → top 75% (270/360). */}
        {pctGH !== null && (
          <Pill className="left-[11%] top-[28%] -translate-x-1/2 -translate-y-1/2" color={gridColor}>{pctGH}%</Pill>
        )}
        {pctSH !== null && (
          <Pill className="right-[11%] top-[28%] translate-x-1/2 -translate-y-1/2" color={AUTO_COLOR}>{pctSH}%</Pill>
        )}
        {pctSG !== null && (
          <Pill className="left-1/2 top-[75%] -translate-x-1/2 -translate-y-1/2" color={AUTO_COLOR}>{pctSG}%</Pill>
        )}

        {/* Nodes — positioned absolute over the SVG */}
        {/* Maison */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[36%] h-[36%] flex flex-col items-center justify-center gap-1 px-3 py-2 bg-surface border border-border rounded-[14px] z-10"
          style={{ color: HP_COLOR }}
        >
          <div className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            {t("energy.live.label.consumption")}
          </div>
          <svg className="w-11 h-11 sm:w-14 sm:h-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
          <div className="font-mono font-bold text-[20px] sm:text-[24px] leading-none tracking-tight mt-1 flex items-baseline gap-1" style={{ color: HP_COLOR }}>
            {(() => {
              const f = formatPower(gridPower !== null || solarPower !== null ? house : null);
              return (
                <>
                  <span>{f.num}</span>
                  <span className="text-[11px] font-semibold opacity-60">{f.unit}</span>
                </>
              );
            })()}
          </div>
        </div>

        {/* Réseau (grid) — placed mid-height so the bottom Solar↔Grid curve has room to loop below */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 left-0 w-[22%] h-[29%] flex flex-col items-center justify-center gap-1 px-2 py-2 bg-surface border border-border rounded-[14px] z-10 ${
            Math.abs(grid) < 5 ? "opacity-40" : ""
          }`}
          style={{ color: gridColor }}
        >
          <div className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            {t("energy.live.label.grid")}
          </div>
          <svg className="w-9 h-9 sm:w-10 sm:h-10" viewBox="-60 -60 605 605" fill="currentColor">
            {/* Transmission pylon — silhouette from electricity-svgrepo-com.svg
             * with the 8 outer "extremity" corners rounded via Q (quadratic
             * Bézier) commands at radius ≈ 25. ViewBox padded ±60 so the icon
             * appears visually lighter (matches the solar panel weight). */}
            <path d="M 485 141.748 V 101.926 Q 485 76.926 462.075 66.926 L 331.569 10 Q 308.644 0 283.644 0 H 201.356 Q 176.356 0 153.431 10 L 22.925 66.926 Q 0 76.926 0 101.926 V 141.748 H 159.45 L 67.511 455 H 0 V 460 Q 0 485 25 485 H 460 Q 485 485 485 460 V 455 H 417.489 L 325.55 141.748 H 485 Z M 194.485 111.748 V 45 Q 194.485 30 209.485 30 H 275.514 Q 290.514 30 290.514 45 V 111.748 H 194.485 Z M455,111.748H320.515v-73.84L455,96.57V111.748z M30,96.57l134.485-58.663v73.84H30V96.57z M372.125,455h-259.25L242.5,313.804L372.125,455z M262.863,291.624l57.142-62.243l53.706,182.985L262.863,291.624z M111.289,412.366l53.706-182.985l57.142,62.243L111.289,412.366z M310.139,195.766L242.5,269.442l-67.639-73.676l15.854-54.018h103.569L310.139,195.766z" />
          </svg>
          <div className="font-mono font-bold text-[16px] sm:text-[19px] leading-none tracking-tight flex items-baseline gap-1">
            <span className="text-[18px] font-bold">{exporting ? "↓" : "↑"}</span>
            {(() => {
              const f = formatPower(gridPower !== null ? grid : null);
              return (
                <>
                  <span>{f.num}</span>
                  <span className="text-[11px] text-text-tertiary font-semibold">{f.unit}</span>
                </>
              );
            })()}
          </div>
        </div>

        {/* Solaire */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 right-0 w-[22%] h-[29%] flex flex-col items-center justify-center gap-1 px-2 py-2 bg-surface border border-border rounded-[14px] z-10 ${
            solar < 5 ? "opacity-40" : ""
          }`}
          style={{ color: AUTO_COLOR }}
        >
          <div className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            {t("energy.live.label.production")}
          </div>
          <SolarPanelIcon className="w-9 h-9 sm:w-10 sm:h-10" strokeWidth={1.4} />
          <div className="font-mono font-bold text-[16px] sm:text-[19px] leading-none tracking-tight flex items-baseline gap-1">
            {(() => {
              const f = formatPower(solarPower !== null ? solar : null);
              return (
                <>
                  <span>{f.num}</span>
                  <span className="text-[11px] text-text-tertiary font-semibold">{f.unit}</span>
                </>
              );
            })()}
          </div>
        </div>

        {/* Qualitative status pill — sits in the empty bottom band of the
         *  diagram (just below the bottom Solar↔Grid loop at y≈270 / 360). */}
        <span
          className="absolute left-1/2 -translate-x-1/2 bottom-[8%] font-mono text-[12px] font-bold px-3 py-1 rounded-full z-10"
          style={{ color: statusColor, background: `${statusColor}15` }}
        >
          {t(`energy.live.status.${status}`)}
        </span>
      </div>
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
