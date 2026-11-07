import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../../types";
import { findDataByCategory } from "./bindingUtils";
import { formatTemperature } from "../../lib/format";
import { SetpointStepper } from "./SetpointStepper";
import { resolveSetpoint } from "./setpoint";
import { useSetpointCommitDelay } from "../../hooks/useSetpointCommit";

interface Props {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

export function PoolHeatPumpControl({ equipment, onExecuteOrder, compact }: Props) {
  const { t } = useTranslation();
  // Category-first resolvers (spec 110). The pool heat pump exposes its water
  // temperature under a domain-specific category; older bindings fall back to
  // the conventional alias. The setpoint is read by `resolveSetpoint`, and its
  // stepper sends one order after the last tap (spec 196, slice 8a).
  const tempBinding = findDataByCategory(
    equipment.dataBindings,
    ["pool_water_temperature", "temperature"],
    ["temperature"],
  );
  const computedWater = equipment.computedData?.find(
    (c) => c.alias === "effective_water_temperature",
  );
  const modeBinding = findDataByCategory(
    equipment.dataBindings,
    ["appliance_state"],
    ["mode"],
  );
  const setpoint = resolveSetpoint(equipment);
  const commitDelay = useSetpointCommitDelay(equipment);
  const setpointOrder = setpoint.order;

  const water =
    typeof computedWater?.value === "number"
      ? computedWater.value
      : typeof tempBinding?.value === "number"
        ? tempBinding.value
        : null;
  const mode = typeof modeBinding?.value === "string" ? modeBinding.value : null;

  return (
    <div className={`flex items-center gap-2 ${compact ? "" : "py-1"}`}>
      <div className="flex items-baseline gap-0.5">
        <span className="text-small font-semibold text-text tabular-nums leading-none">
          {formatTemperature(water, { style: compact ? "compact" : "full" })}
        </span>
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
      {setpointOrder && setpoint.value !== null && equipment.enabled && (
        <SetpointStepper
          size={compact ? "sm" : "md"}
          value={setpoint.value}
          min={setpoint.min}
          max={setpoint.max}
          step={setpoint.step}
          unit="°C"
          label={t("thermostat.target")}
          debounceMs={commitDelay}
          onCommit={(v) => onExecuteOrder(setpointOrder, v)}
        />
      )}
    </div>
  );
}
