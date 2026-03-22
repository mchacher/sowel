import { useTranslation } from "react-i18next";
import { WashingMachine, Timer, Zap } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface AppliancePanelProps {
  equipment: EquipmentWithDetails;
}

export function AppliancePanel({ equipment }: AppliancePanelProps) {
  const { t } = useTranslation();

  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const stateBinding = equipment.dataBindings.find((b) => b.alias === "state");
  const jobPhaseBinding = equipment.dataBindings.find((b) => b.alias === "job_phase");
  const progressBinding = equipment.dataBindings.find((b) => b.alias === "progress");
  const remainingTimeBinding = equipment.dataBindings.find((b) => b.alias === "remaining_time");
  const remainingTimeStrBinding = equipment.dataBindings.find((b) => b.alias === "remaining_time_str");
  const energyBinding = equipment.dataBindings.find((b) => b.alias === "energy");

  const isOn = powerBinding?.value === true;
  const state = typeof stateBinding?.value === "string" ? stateBinding.value : "off";
  const jobPhase = typeof jobPhaseBinding?.value === "string" ? jobPhaseBinding.value : null;
  const progress = typeof progressBinding?.value === "number" ? progressBinding.value : 0;
  const remainingTimeStr = typeof remainingTimeStrBinding?.value === "string" ? remainingTimeStrBinding.value : null;
  const remainingMin = typeof remainingTimeBinding?.value === "number" ? remainingTimeBinding.value : null;
  const energyWh = typeof energyBinding?.value === "number" ? energyBinding.value : null;

  const isRunning = state === "running";
  const isPaused = state === "paused";

  const PHASE_LABELS: Record<string, string> = {
    wash: "Lavage",
    rinse: "Rinçage",
    spin: "Essorage",
    none: "—",
  };

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <h3 className="text-[14px] font-semibold text-text mb-4">
        <WashingMachine size={16} strokeWidth={1.5} className="inline mr-2 text-text-tertiary" />
        {t("equipments.status")}
      </h3>

      {!isOn || state === "off" ? (
        <div className="text-center py-6">
          <WashingMachine size={40} strokeWidth={1} className="mx-auto mb-2 text-text-tertiary/30" />
          <span className="text-[14px] text-text-tertiary">OFF</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* State badge */}
          <div className="flex items-center gap-3">
            <span className={`text-[13px] font-semibold px-3 py-1 rounded-full ${
              isRunning ? "bg-accent/10 text-accent" : isPaused ? "bg-warning/10 text-warning" : "bg-border-light text-text-secondary"
            }`}>
              {isRunning ? t("common.running") : isPaused ? t("common.paused") : state}
            </span>
            {jobPhase && jobPhase !== "none" && (
              <span className="text-[13px] text-text-secondary">
                {PHASE_LABELS[jobPhase] ?? jobPhase}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {isRunning && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] text-text-secondary">{t("common.progress")}</span>
                <span className="text-[13px] font-mono tabular-nums font-semibold text-text">{progress}%</span>
              </div>
              <div className="h-2 bg-border-light rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
            </div>
          )}

          {/* Remaining time */}
          {(isRunning || isPaused) && remainingTimeStr && (
            <div className="flex items-center gap-2">
              <Timer size={14} strokeWidth={1.5} className="text-text-tertiary" />
              <span className="text-[14px] font-mono tabular-nums text-text">
                {remainingTimeStr}
              </span>
              {remainingMin !== null && (
                <span className="text-[12px] text-text-tertiary">
                  ({remainingMin} min)
                </span>
              )}
            </div>
          )}

          {/* Energy */}
          {energyWh !== null && energyWh > 0 && (
            <div className="flex items-center gap-2 pt-2 border-t border-border-light">
              <Zap size={14} strokeWidth={1.5} className="text-accent" />
              <span className="text-[12px] text-text-secondary">
                {energyWh >= 1000 ? (energyWh / 1000).toFixed(1) : Math.round(energyWh)}
                <span className="text-text-tertiary ml-0.5">{energyWh >= 1000 ? "kWh" : "Wh"}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
