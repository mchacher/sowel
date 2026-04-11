import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Power, Loader2, Droplets, Battery, AlertTriangle } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface WaterValveControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

export function WaterValveControl({ equipment, onExecuteOrder, compact }: WaterValveControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const [watering, setWatering] = useState(false);
  const [duration, setDuration] = useState(10);

  const stateBinding = equipment.dataBindings.find((b) => b.alias === "state");
  const flowBinding = equipment.dataBindings.find((b) => b.alias === "flow");
  const batteryBinding = equipment.dataBindings.find((b) => b.alias === "battery");
  const statusBinding = equipment.dataBindings.find((b) => b.alias === "status");

  const isOn =
    stateBinding?.value === true || stateBinding?.value === "ON";

  const flow =
    flowBinding && typeof flowBinding.value === "number" ? flowBinding.value : null;
  const battery =
    batteryBinding && typeof batteryBinding.value === "number"
      ? batteryBinding.value
      : null;
  const status =
    statusBinding && typeof statusBinding.value === "string" ? statusBinding.value : null;

  const hasStateOrder = equipment.orderBindings.some((b) => b.alias === "state");
  const hasDurationOrder = equipment.orderBindings.some((b) => b.alias === "duration");

  const handleToggle = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (executing || !hasStateOrder) return;
    setExecuting(true);
    try {
      await onExecuteOrder("state", !isOn);
    } finally {
      setExecuting(false);
    }
  };

  const handleWaterNow = async () => {
    if (watering || !hasDurationOrder || !hasStateOrder) return;
    setWatering(true);
    try {
      // Send duration in seconds first, then turn on
      await onExecuteOrder("duration", duration * 60);
      await onExecuteOrder("state", true);
    } finally {
      setWatering(false);
    }
  };

  // ============================================================
  // Compact mode — used in equipment list
  // ============================================================
  if (compact) {
    if (!hasStateOrder) return null;
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {flow !== null && isOn && (
          <div className="flex items-baseline gap-0.5 text-text-secondary">
            <span className="text-[13px] font-medium tabular-nums font-mono">{flow}</span>
            <span className="text-[10px] text-text-tertiary">m³/h</span>
          </div>
        )}
        <button
          onClick={handleToggle}
          disabled={executing || !equipment.enabled}
          className={`
            w-9 h-9 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border
            ${isOn
              ? "border-active/40 bg-active/10 text-active-text hover:bg-active/15"
              : "border-border bg-surface text-text-tertiary hover:bg-border-light"}
            disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]
          `}
          title={isOn ? t("water.closed") : t("water.open")}
        >
          {executing ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} strokeWidth={1.5} />}
        </button>
      </div>
    );
  }

  // ============================================================
  // Full mode — used in equipment detail page
  // ============================================================
  return (
    <div className="space-y-4">
      {/* Big toggle */}
      <div className="flex items-center justify-center">
        <button
          onClick={handleToggle}
          disabled={executing || !equipment.enabled || !hasStateOrder}
          className={`
            w-32 h-32 flex flex-col items-center justify-center rounded-full transition-all duration-150 cursor-pointer border-2
            ${isOn
              ? "border-active bg-active/10 text-active-text"
              : "border-border bg-surface text-text-tertiary hover:bg-border-light"}
            disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]
          `}
        >
          {executing ? (
            <Loader2 size={32} className="animate-spin" />
          ) : (
            <>
              <Power size={32} strokeWidth={1.5} />
              <span className="text-[13px] font-semibold mt-1">
                {isOn ? t("water.open") : t("water.closed")}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Live metrics */}
      <div className="grid grid-cols-2 gap-3">
        {flow !== null && (
          <Metric
            icon={<Droplets size={16} strokeWidth={1.5} />}
            label={t("water.flow")}
            value={`${flow}`}
            unit="m³/h"
          />
        )}
        {battery !== null && (
          <Metric
            icon={<Battery size={16} strokeWidth={1.5} />}
            label={t("water.battery")}
            value={`${battery}`}
            unit="%"
            alert={battery < 20}
          />
        )}
        {status !== null && (
          <Metric
            icon={<AlertTriangle size={16} strokeWidth={1.5} />}
            label={t("water.status")}
            value={status}
            alert={status !== "normal"}
          />
        )}
      </div>

      {/* Timed watering */}
      {hasDurationOrder && hasStateOrder && (
        <div className="bg-surface border border-border rounded-[10px] p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-medium text-text-secondary">
              {t("water.duration")}
            </span>
            <input
              type="number"
              min={1}
              max={120}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
              className="w-16 px-2 py-1 text-[13px] tabular-nums border border-border rounded-[6px] outline-none focus:border-primary"
            />
            <span className="text-[12px] text-text-tertiary">{t("water.minutes")}</span>
          </div>
          <button
            onClick={handleWaterNow}
            disabled={watering || !equipment.enabled}
            className="w-full px-3 py-2 text-[13px] font-medium rounded-[6px] bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
          >
            {watering ? (
              <Loader2 size={14} className="animate-spin inline" />
            ) : (
              t("water.waterNow", { minutes: duration })
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  unit,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 px-3 py-2 rounded-[8px] border ${alert ? "border-error/40 bg-error/5" : "border-border bg-surface"}`}
    >
      <div className="flex items-center gap-1.5 text-text-tertiary">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className={`text-[18px] font-semibold tabular-nums font-mono ${alert ? "text-error" : "text-text"}`}>
          {value}
        </span>
        {unit && <span className="text-[12px] text-text-tertiary">{unit}</span>}
      </div>
    </div>
  );
}
