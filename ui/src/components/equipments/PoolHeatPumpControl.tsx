import { useState, useRef, useEffect } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { findDataByCategory, findOrderByCategory } from "./bindingUtils";
import { formatNumber, formatTemperature } from "../../lib/format";

interface Props {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

const STEP = 0.5;
const COMMIT_DEBOUNCE_MS = 500;
const SETTLE_AFTER_COMMIT_MS = 5000;

export function PoolHeatPumpControl({ equipment, onExecuteOrder, compact }: Props) {
  // Optimistic override so rapid +/- clicks don't await every Modbus write.
  // We accumulate locally and only write the latest value after the user stops
  // clicking. The override keeps the slider from snapping back until the device
  // reports the new value (or SETTLE_AFTER_COMMIT_MS elapses).
  const [pending, setPending] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Category-first resolvers (spec 110). The pool heat pump exposes its water
  // temperature and setpoint under domain-specific categories; older bindings
  // fall back to the conventional aliases.
  const tempBinding = findDataByCategory(
    equipment.dataBindings,
    ["pool_water_temperature", "temperature"],
    ["temperature"],
  );
  const computedWater = equipment.computedData?.find(
    (c) => c.alias === "effective_water_temperature",
  );
  const setpointBinding = findDataByCategory(
    equipment.dataBindings,
    ["pool_temperature_setpoint", "setpoint"],
    ["setpoint"],
  );
  const modeBinding = findDataByCategory(
    equipment.dataBindings,
    ["appliance_state"],
    ["mode"],
  );
  const setpointOrder = findOrderByCategory(
    equipment.orderBindings,
    ["set_pool_temperature_setpoint", "set_setpoint"],
    ["setpoint"],
  );

  const water =
    typeof computedWater?.value === "number"
      ? computedWater.value
      : typeof tempBinding?.value === "number"
        ? tempBinding.value
        : null;
  const deviceSetpoint =
    typeof setpointBinding?.value === "number" ? setpointBinding.value : null;
  // Hide the local override once the device echoes the value (within 0.01 °C)
  // so legit device-side changes resurface immediately. Derived to avoid the
  // setState-in-effect pattern.
  const overrideActive =
    pending !== null && (deviceSetpoint === null || Math.abs(deviceSetpoint - pending) >= 0.01);
  const setpoint = overrideActive ? pending : deviceSetpoint;
  const mode = typeof modeBinding?.value === "string" ? modeBinding.value : null;

  const targetMin = setpointOrder?.min ?? 10;
  const targetMax = setpointOrder?.max ?? 30;

  useEffect(() => {
    return () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  const bumpSetpoint = (next: number) => {
    if (!setpointOrder) return;
    pendingRef.current = next;
    setPending(next);
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      const value = pendingRef.current;
      commitTimerRef.current = null;
      if (value === null) return;
      onExecuteOrder(setpointOrder.alias, value).catch(() => {
        /* surfaced upstream */
      });
      // Failsafe: clear the override if the device never echoes back.
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        setPending(null);
        pendingRef.current = null;
        settleTimerRef.current = null;
      }, SETTLE_AFTER_COMMIT_MS);
    }, COMMIT_DEBOUNCE_MS);
  };

  return (
    <div className={`flex items-center gap-2 ${compact ? "" : "py-1"}`}>
      <div className="flex items-baseline gap-0.5">
        <span className="text-small font-semibold text-text tabular-nums leading-none font-mono">
          {formatNumber(water, { decimals: 1 })}
        </span>
        <span className="text-micro font-medium text-text-tertiary">{compact ? "°" : "°C"}</span>
      </div>
      {mode && (
        <span
          className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${
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
            onClick={() => bumpSetpoint(Math.max(targetMin, setpoint - STEP))}
            disabled={setpoint <= targetMin}
            className="w-6 h-6 flex items-center justify-center rounded-[4px] border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
          <span className="text-micro tabular-nums font-mono text-text-secondary min-w-[34px] text-center">
            {formatTemperature(setpoint, { style: compact ? "compact" : "full" })}
          </span>
          <button
            type="button"
            onClick={() => bumpSetpoint(Math.min(targetMax, setpoint + STEP))}
            disabled={setpoint >= targetMax}
            className="w-6 h-6 flex items-center justify-center rounded-[4px] border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronUp size={12} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}
