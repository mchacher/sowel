/**
 * Live energy diagram — instant power flow between grid, house and solar.
 *
 * Reads two equipment ids from server settings:
 *   energy.live.grid_equipment_id   — equipment exposing signed `power` (positive = import)
 *   energy.live.solar_equipment_id  — equipment exposing positive `power` (production)
 *
 * Flow:
 *   P_house = P_grid + P_solar  (signs respected)
 *   importing  → P_grid > 0      → bubbles flow grid → house, slate-blue
 *   exporting  → P_grid < 0      → bubbles flow house → grid, neutral grey
 *   solar always → solar → house, green
 *   autoconso = min(solar, house) / house · 100   (or 100% when exporting)
 *
 * Visual matches `specs/085-shelly-em-plugin-live/mockup.html` (validated v13).
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings as SettingsIcon, X } from "lucide-react";
import { useEquipments } from "../../store/useEquipments";
import { getSettings, updateSettings } from "../../api";
import type { EquipmentWithDetails } from "../../types";
import { EnergyMobileNav } from "./EnergyMobileNav";

// Sowel energy palette (matches EnergyBarChart.tsx + extends with grid colours)
const HP_COLOR = "#4F7BE8";       // House consumption (vivid blue, focal)
const GRID_COLOR = "#4A6396";     // Grid import (slate blue, distinct from house)
const GRID_OFF_COLOR = "#9CA3AF"; // Grid passive (neutral grey, on export)
const AUTO_COLOR = "#6BCB77";     // Solar / autoconso (green)
const AUTO_SOFT_BG = "#DEF1E2";   // Autoconso pill background

const SETTING_GRID = "energy.live.grid_equipment_id";
const SETTING_SOLAR = "energy.live.solar_equipment_id";

// ── Helpers ─────────────────────────────────────────────────────────────

function getPowerValue(eq: EquipmentWithDetails | null | undefined): number | null {
  if (!eq) return null;
  const b = eq.dataBindings.find((db) => db.alias === "power");
  return b && typeof b.value === "number" ? b.value : null;
}

/** Flow duration (s) inversely log-scaled with power. Stays calm — bubbles never zoom. */
function flowDuration(power: number): number {
  const a = Math.abs(power);
  if (a < 5) return 0;
  const d = 7 - Math.log10(a + 10) * 0.6;
  return Math.max(4, Math.min(7, d));
}

// ── Page ────────────────────────────────────────────────────────────────

export function LiveEnergyPage() {
  const { t } = useTranslation();
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);

  const [gridId, setGridId] = useState<string | null>(null);
  const [solarId, setSolarId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load equipment list + saved sources on mount.
  useEffect(() => {
    fetchEquipments();
    getSettings()
      .then((s) => {
        setGridId(s[SETTING_GRID] || null);
        setSolarId(s[SETTING_SOLAR] || null);
      })
      .catch(() => {
        /* ignore — empty state will prompt the user */
      })
      .finally(() => setLoaded(true));
  }, [fetchEquipments]);

  const persistSources = async (g: string | null, s: string | null) => {
    setGridId(g);
    setSolarId(s);
    await updateSettings({
      [SETTING_GRID]: g ?? "",
      [SETTING_SOLAR]: s ?? "",
    }).catch(() => {
      /* the in-memory state is enough until the next reload */
    });
  };

  // Equipments that can be picked: those exposing a `power` alias.
  const pickable = useMemo(
    () => equipments.filter((e) => e.dataBindings.some((b) => b.alias === "power")),
    [equipments],
  );

  const gridEq = useMemo(
    () => equipments.find((e) => e.id === gridId) ?? null,
    [equipments, gridId],
  );
  const solarEq = useMemo(
    () => equipments.find((e) => e.id === solarId) ?? null,
    [equipments, solarId],
  );

  const gridPower = getPowerValue(gridEq);
  const solarPower = getPowerValue(solarEq);

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-1.5">
          <EnergyMobileNav />
          <h1 className="text-[18px] font-semibold text-text">{t("energy.live")}</h1>
        </div>
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors cursor-pointer"
        >
          <SettingsIcon size={14} strokeWidth={1.5} />
          {t("energy.live.configure")}
        </button>
      </div>

      {!loaded ? (
        <div className="flex items-center justify-center h-[300px] text-text-tertiary text-[13px]">
          {t("common.loading")}
        </div>
      ) : !gridEq || !solarEq ? (
        <EmptyState onConfigure={() => setPicker(true)} />
      ) : (
        <LiveDiagram gridPower={gridPower} solarPower={solarPower} />
      )}

      {picker && (
        <SourcePicker
          equipments={pickable}
          gridId={gridId}
          solarId={solarId}
          onClose={() => setPicker(false)}
          onSave={async (g, s) => {
            await persistSources(g, s);
            setPicker(false);
          }}
        />
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

  // Autoconso ratio = how much of consumption comes from solar
  const autoPct =
    house > 5 && solar > 5
      ? exporting
        ? 100
        : Math.round((Math.min(solar, house) / house) * 100)
      : null;

  const dGrid = flowDuration(grid);
  const dSolar = flowDuration(solar);

  // Stable ids for SVG <mpath> references — needed when several diagrams
  // co-exist (here only one, but defensive).
  const idG = "live-path-grid";
  const idS = "live-path-solar";

  const gridColor = exporting ? GRID_OFF_COLOR : GRID_COLOR;

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 sm:p-10 max-w-[640px] mx-auto">
      <div className="relative aspect-[360/320] max-w-[420px] mx-auto">
        <svg
          viewBox="0 0 360 320"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full overflow-visible"
        >
          {/* Bus skeleton — orthogonal, faint */}
          <line x1="180" y1="152" x2="180" y2="189" stroke="var(--color-border)" strokeWidth="2" />
          <line x1="60"  y1="189" x2="300" y2="189" stroke="var(--color-border)" strokeWidth="2" />
          <line x1="60"  y1="189" x2="60"  y2="226" stroke="var(--color-border)" strokeWidth="2" />
          <line x1="300" y1="189" x2="300" y2="226" stroke="var(--color-border)" strokeWidth="2" />

          {/* Active overlays (only visible when carrying energy) */}
          <polyline
            points="60,226 60,189 180,189 180,152"
            fill="none"
            stroke={gridColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity={Math.abs(grid) >= 5 ? 1 : 0}
          />
          <polyline
            points="300,226 300,189 180,189 180,152"
            fill="none"
            stroke={AUTO_COLOR}
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity={solar >= 5 ? 1 : 0}
          />

          {/* Junctions */}
          <circle cx="60"  cy="189" r="4" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1.5" />
          <circle cx="300" cy="189" r="4" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1.5" />
          <circle cx="180" cy="189" r="5" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1.5" />

          {/* Animation paths (invisible) */}
          <path id={idG} d="M 60 226 L 60 189 L 180 189 L 180 152" fill="none" stroke="none" />
          <path id={idS} d="M 300 226 L 300 189 L 180 189 L 180 152" fill="none" stroke="none" />

          {/* Grid bubbles — direction depends on import/export */}
          {dGrid > 0 && (
            <g>
              {[0, dGrid / 3, (2 * dGrid) / 3].map((begin, i) => (
                <circle key={`g${i}`} r="4" fill={gridColor}>
                  <animateMotion
                    dur={`${dGrid}s`}
                    begin={`${begin}s`}
                    repeatCount="indefinite"
                    keyPoints={exporting ? "1;0" : undefined}
                    keyTimes={exporting ? "0;1" : undefined}
                  >
                    <mpath href={`#${idG}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
          )}
          {/* Solar bubbles — always solar → house */}
          {dSolar > 0 && (
            <g>
              {[0, dSolar / 3, (2 * dSolar) / 3].map((begin, i) => (
                <circle key={`s${i}`} r="4" fill={AUTO_COLOR}>
                  <animateMotion dur={`${dSolar}s`} begin={`${begin}s`} repeatCount="indefinite">
                    <mpath href={`#${idS}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
          )}
        </svg>

        {/* Nodes — positioned absolute over the SVG */}
        {/* Maison */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[48%] flex flex-col items-center gap-1.5 px-3 py-3 bg-surface border border-border rounded-[14px] z-10"
          style={{ color: HP_COLOR }}
        >
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 L20 11 Q21 12 20 13 L20 19 Q20 20 19 20 L5 20 Q4 20 4 19 L4 13 Q3 12 4 11 Z" />
          </svg>
          <div className="font-mono font-bold text-[24px] leading-none tracking-tight text-text mt-1 flex items-baseline gap-1">
            <span>{house > 0 || gridPower !== null || solarPower !== null ? Math.round(house) : "—"}</span>
            <span className="text-[11px] text-text-tertiary font-semibold">W</span>
          </div>
          {autoPct !== null && (
            <div
              className="font-mono text-[10px] font-bold tracking-wide px-2.5 py-0.5 rounded-full mt-0.5 inline-flex gap-1"
              style={{ color: AUTO_COLOR, background: AUTO_SOFT_BG }}
            >
              <span>{autoPct}%</span>
              <span className="font-medium opacity-70 lowercase">{t("energy.live.autoconso")}</span>
            </div>
          )}
        </div>

        {/* Réseau (grid) */}
        <div
          className={`absolute bottom-0 left-0 w-1/3 flex flex-col items-center gap-1.5 px-2 py-2.5 bg-surface border border-border rounded-[14px] z-10 ${
            Math.abs(grid) < 5 ? "opacity-40" : ""
          }`}
          style={{ color: gridColor }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 11 3 L 6 21" />
            <path d="M 13 3 L 18 21" />
            <path d="M 11 3 L 13 3" />
            <path d="M 4 21 L 20 21" />
            <path d="M 5 11 L 19 11" />
            <path d="M 4 16 L 20 16" />
          </svg>
          <div className="font-mono font-bold text-[19px] leading-none tracking-tight flex items-baseline gap-1">
            <span className="text-[18px] font-bold">{exporting ? "↓" : "↑"}</span>
            <span>{gridPower !== null ? Math.abs(Math.round(grid)) : "—"}</span>
            <span className="text-[11px] text-text-tertiary font-semibold">W</span>
          </div>
        </div>

        {/* Solaire */}
        <div
          className={`absolute bottom-0 right-0 w-1/3 flex flex-col items-center gap-1.5 px-2 py-2.5 bg-surface border border-border rounded-[14px] z-10 ${
            solar < 5 ? "opacity-40" : ""
          }`}
          style={{ color: AUTO_COLOR }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5 Q3 5 3 6 L3 17 Q3 18 4 18 L20 18 Q21 18 21 17 L21 6 Q21 5 20 5 Z" />
            <line x1="3" y1="11.5" x2="21" y2="11.5" />
            <line x1="12" y1="5" x2="12" y2="18" />
            <line x1="12" y1="20" x2="12" y2="22" />
          </svg>
          <div className="font-mono font-bold text-[19px] leading-none tracking-tight flex items-baseline gap-1">
            <span>{solarPower !== null ? Math.round(solar) : "—"}</span>
            <span className="text-[11px] text-text-tertiary font-semibold">W</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Empty state + Source picker ─────────────────────────────────────────

function EmptyState({ onConfigure }: { onConfigure: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="bg-surface border border-border rounded-[10px] p-10 text-center max-w-[480px] mx-auto">
      <h2 className="text-[16px] font-semibold text-text mb-2">{t("energy.live.empty.title")}</h2>
      <p className="text-[13px] text-text-secondary mb-5">{t("energy.live.empty.help")}</p>
      <button
        type="button"
        onClick={onConfigure}
        className="px-4 py-2 text-[13px] font-medium text-white bg-primary hover:bg-primary-hover rounded-[6px] transition-colors cursor-pointer"
      >
        {t("energy.live.configure")}
      </button>
    </div>
  );
}

function SourcePicker({
  equipments,
  gridId,
  solarId,
  onClose,
  onSave,
}: {
  equipments: EquipmentWithDetails[];
  gridId: string | null;
  solarId: string | null;
  onClose: () => void;
  onSave: (gridId: string | null, solarId: string | null) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [g, setG] = useState<string>(gridId ?? "");
  const [s, setS] = useState<string>(solarId ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-[10px] w-full max-w-[420px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-text">{t("energy.live.configure")}</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-[6px] hover:bg-border-light cursor-pointer">
            <X size={16} className="text-text-secondary" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[12px] font-medium text-text-secondary mb-1.5 block">{t("energy.live.source.grid")}</span>
            <select
              value={g}
              onChange={(e) => setG(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none focus:border-primary transition-colors"
            >
              <option value="">—</option>
              {equipments.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-text-secondary mb-1.5 block">{t("energy.live.source.solar")}</span>
            <select
              value={s}
              onChange={(e) => setS(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none focus:border-primary transition-colors"
            >
              <option value="">—</option>
              {equipments.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors cursor-pointer"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => onSave(g || null, s || null)}
            className="px-3 py-1.5 text-[13px] font-medium text-white bg-primary hover:bg-primary-hover rounded-[6px] transition-colors cursor-pointer"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
