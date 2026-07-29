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

const PHASE_COLORS = ["#4F7BE8", "#6BCB77", "#F2A93B", "#E8677D"];

interface PhaseValue {
  n: number;
  power: number;
}

function extractPhases(equipments: EquipmentWithDetails[]): PhaseValue[] {
  const byPhase = new Map<number, number>();
  for (const eq of equipments) {
    for (const b of eq.dataBindings) {
      const m = /^power_l(\d+)$/.exec(b.alias);
      if (!m || typeof b.value !== "number") continue;
      const n = Number(m[1]);
      byPhase.set(n, (byPhase.get(n) ?? 0) + b.value);
    }
  }
  return [...byPhase.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, power]) => ({ n, power }));
}

function formatPower(value: number): { num: string; unit: "W" | "kW" } {
  const a = Math.abs(value);
  if (a < 1000) return { num: String(Math.round(a / 5) * 5), unit: "W" };
  return { num: (a / 1000).toFixed(1), unit: "kW" };
}

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
          const f = formatPower(p.power);
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
