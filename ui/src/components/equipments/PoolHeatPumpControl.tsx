import { useState } from "react";
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface Props {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

const STEP = 0.5;

export function PoolHeatPumpControl({ equipment, onExecuteOrder, compact }: Props) {
  const [executing, setExecuting] = useState(false);

  const tempBinding = equipment.dataBindings.find((b) => b.alias === "temperature");
  const computedWater = equipment.computedData?.find(
    (c) => c.alias === "effective_water_temperature",
  );
  const setpointBinding = equipment.dataBindings.find((b) => b.alias === "setpoint");
  const modeBinding = equipment.dataBindings.find((b) => b.alias === "mode");
  const setpointOrder = equipment.orderBindings.find((o) => o.alias === "setpoint");

  const water =
    typeof computedWater?.value === "number"
      ? computedWater.value
      : typeof tempBinding?.value === "number"
        ? tempBinding.value
        : null;
  const setpoint = typeof setpointBinding?.value === "number" ? setpointBinding.value : null;
  const mode = typeof modeBinding?.value === "string" ? modeBinding.value : null;

  const targetMin = setpointOrder?.min ?? 10;
  const targetMax = setpointOrder?.max ?? 30;

  const handleSetpoint = async (next: number) => {
    if (executing || !setpointOrder) return;
    setExecuting(true);
    try {
      await onExecuteOrder("setpoint", next);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${compact ? "" : "py-1"}`}>
      <div className="flex items-baseline gap-0.5">
        <span className="text-[13px] font-semibold text-text tabular-nums leading-none font-mono">
          {water !== null ? water.toFixed(1) : "—"}
        </span>
        <span className="text-[10px] font-medium text-text-tertiary">°C</span>
      </div>
      {mode && (
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            mode.toUpperCase() === "OFF"
              ? "bg-border-light text-text-tertiary"
              : "bg-error/10 text-error"
          }`}
        >
          {mode}
        </span>
      )}
      {setpointOrder && setpoint !== null && equipment.enabled && (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => handleSetpoint(Math.max(targetMin, setpoint - STEP))}
            disabled={executing || setpoint <= targetMin}
            className="w-6 h-6 flex items-center justify-center rounded-[4px] border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {executing ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} strokeWidth={2} />}
          </button>
          <span className="text-[11px] tabular-nums font-mono text-text-secondary min-w-[34px] text-center">
            {setpoint.toFixed(1)}°C
          </span>
          <button
            type="button"
            onClick={() => handleSetpoint(Math.min(targetMax, setpoint + STEP))}
            disabled={executing || setpoint >= targetMax}
            className="w-6 h-6 flex items-center justify-center rounded-[4px] border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {executing ? <Loader2 size={12} className="animate-spin" /> : <ChevronUp size={12} strokeWidth={2} />}
          </button>
        </div>
      )}
    </div>
  );
}
