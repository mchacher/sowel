/**
 * Per-phase power breakdown for a 3-phase main energy meter.
 *
 * Reads `power_l{n}` data-binding aliases bound directly on `main_energy_meter`
 * equipments (convention: any plugin exposing per-phase power on a 3-phase
 * meter binds it to the main meter equipment under this alias). Renders
 * nothing when fewer than 2 phases are bound, so single-phase installs are
 * unaffected — same additive pattern as LiveSubmeterBreakdown.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../../types";
import { extractPhases, formatPhasePower } from "./phase-helpers";

const PHASE_COLORS = ["#4F7BE8", "#6BCB77", "#F2A93B", "#E8677D"];

interface Props {
  gridEquipments: EquipmentWithDetails[];
}

export function PhaseBreakdown({ gridEquipments }: Props) {
  const { t } = useTranslation();
  const phases = useMemo(() => extractPhases(gridEquipments), [gridEquipments]);

  if (phases.length < 2) return null;

  const maxPower = Math.max(1, ...phases.map((p) => Math.abs(p.power)));

  return (
    <div className="bg-surface border border-border rounded-[10px] p-4 sm:p-6 mt-4">
      <h2 className="text-[14px] font-semibold text-text mb-4">
        {t("energy.live.phases.title")}
      </h2>
      <div className="flex flex-col gap-3 max-w-[600px]">
        {phases.map((p, i) => {
          const f = formatPhasePower(p.power);
          const pct = Math.round((Math.abs(p.power) / maxPower) * 100);
          const color = PHASE_COLORS[i % PHASE_COLORS.length];
          return (
            <div key={p.n} className="flex items-center gap-3">
              <span className="text-[12px] font-semibold text-text-tertiary w-14 shrink-0">
                {t("energy.live.phases.phase", { n: p.n })}
              </span>
              <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
              <span className="font-mono text-[13px] font-medium text-text-secondary w-16 text-right shrink-0">
                {f.num} {f.unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
