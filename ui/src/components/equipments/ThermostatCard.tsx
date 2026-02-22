import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Power,
  ChevronUp,
  ChevronDown,
  Wind,
  Snowflake,
  Sun,
  Droplets,
  Fan,
  Zap,
  Leaf,
} from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface ThermostatCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

const MODE_ICONS: Record<string, React.ReactNode> = {
  auto: <Zap size={14} strokeWidth={1.5} />,
  cool: <Snowflake size={14} strokeWidth={1.5} />,
  heat: <Sun size={14} strokeWidth={1.5} />,
  dry: <Droplets size={14} strokeWidth={1.5} />,
  fan: <Fan size={14} strokeWidth={1.5} />,
};

const MODE_COLORS: Record<string, string> = {
  auto: "bg-primary/10 text-primary border-primary/30",
  cool: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  heat: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  dry: "bg-teal-500/10 text-teal-500 border-teal-500/30",
  fan: "bg-gray-500/10 text-gray-500 border-gray-500/30",
};

export function ThermostatCard({ equipment, onExecuteOrder, compact }: ThermostatCardProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<string | null>(null);

  // Read data bindings
  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const modeBinding = equipment.dataBindings.find((b) => b.alias === "operationMode");
  const targetTempBinding = equipment.dataBindings.find((b) => b.alias === "targetTemperature");
  const insideTempBinding = equipment.dataBindings.find((b) => b.alias === "insideTemperature");
  const outsideTempBinding = equipment.dataBindings.find((b) => b.alias === "outsideTemperature");
  const fanSpeedBinding = equipment.dataBindings.find((b) => b.alias === "fanSpeed");
  const ecoModeBinding = equipment.dataBindings.find((b) => b.alias === "ecoMode");

  const isOn = powerBinding?.value === true;
  const currentMode = typeof modeBinding?.value === "string" ? modeBinding.value : null;
  const targetTemp = typeof targetTempBinding?.value === "number" ? targetTempBinding.value : null;
  const insideTemp = typeof insideTempBinding?.value === "number" ? insideTempBinding.value : null;
  const outsideTemp = typeof outsideTempBinding?.value === "number" ? outsideTempBinding.value : null;
  const fanSpeed = typeof fanSpeedBinding?.value === "string" ? fanSpeedBinding.value : null;
  const ecoMode = typeof ecoModeBinding?.value === "string" ? ecoModeBinding.value : null;

  // Order bindings (available controls)
  const hasPowerOrder = equipment.orderBindings.some((o) => o.alias === "power");
  const modeOrder = equipment.orderBindings.find((o) => o.alias === "operationMode");
  const targetTempOrder = equipment.orderBindings.find((o) => o.alias === "targetTemperature");
  const fanSpeedOrder = equipment.orderBindings.find((o) => o.alias === "fanSpeed");

  const availableModes = modeOrder?.enumValues ?? [];
  const availableFanSpeeds = fanSpeedOrder?.enumValues ?? [];

  const exec = async (alias: string, value: unknown) => {
    if (executing) return;
    setExecuting(alias);
    try {
      await onExecuteOrder(alias, value);
    } finally {
      setExecuting(null);
    }
  };

  if (compact) {
    return (
      <CompactThermostat
        isOn={isOn}
        currentMode={currentMode}
        insideTemp={insideTemp}
        targetTemp={targetTemp}
        hasPowerOrder={hasPowerOrder}
        executing={executing}
        onTogglePower={() => exec("power", !isOn)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Temperature display + Power */}
      <div className="flex items-center justify-between">
        <div className="flex items-end gap-3">
          <div className="text-[36px] font-semibold text-text leading-none tabular-nums font-mono">
            {insideTemp !== null ? insideTemp.toFixed(1) : "—"}
            <span className="text-[16px] text-text-tertiary font-normal">°C</span>
          </div>
          {outsideTemp !== null && (
            <div className="text-[13px] text-text-tertiary mb-1">
              {t("thermostat.outside")}: {outsideTemp.toFixed(1)}°C
            </div>
          )}
        </div>
        {hasPowerOrder && (
          <button
            onClick={() => exec("power", !isOn)}
            disabled={executing === "power"}
            className={`
              p-2.5 rounded-[8px] transition-colors duration-150 cursor-pointer
              ${isOn
                ? "bg-primary text-white hover:bg-primary-hover"
                : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
          >
            <Power size={18} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Target temperature control */}
      {targetTempOrder && isOn && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-tertiary">{t("thermostat.target")}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => targetTemp !== null && exec("targetTemperature", targetTemp - 0.5)}
              disabled={executing === "targetTemperature" || targetTemp === null || targetTemp <= (targetTempOrder.min ?? 16)}
              className="p-1 rounded-[4px] bg-border-light text-text-secondary hover:bg-border hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronDown size={14} strokeWidth={2} />
            </button>
            <span className="text-[20px] font-semibold text-text tabular-nums font-mono min-w-[60px] text-center">
              {targetTemp !== null ? targetTemp.toFixed(1) : "—"}
              <span className="text-[12px] text-text-tertiary font-normal">°C</span>
            </span>
            <button
              onClick={() => targetTemp !== null && exec("targetTemperature", targetTemp + 0.5)}
              disabled={executing === "targetTemperature" || targetTemp === null || targetTemp >= (targetTempOrder.max ?? 30)}
              className="p-1 rounded-[4px] bg-border-light text-text-secondary hover:bg-border hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronUp size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* Mode selector */}
      {availableModes.length > 0 && isOn && (
        <div className="space-y-1.5">
          <span className="text-[12px] text-text-tertiary">{t("thermostat.mode")}</span>
          <div className="flex gap-1.5 flex-wrap">
            {availableModes.map((mode) => (
              <button
                key={mode}
                onClick={() => exec("operationMode", mode)}
                disabled={executing === "operationMode"}
                className={`
                  flex items-center gap-1 px-2.5 py-1.5 rounded-[6px] text-[12px] font-medium border
                  transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                  ${currentMode === mode
                    ? MODE_COLORS[mode] ?? "bg-primary/10 text-primary border-primary/30"
                    : "bg-surface text-text-tertiary border-border hover:border-border hover:text-text-secondary"
                  }
                `}
              >
                {MODE_ICONS[mode]}
                {t(`thermostat.modes.${mode}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fan speed */}
      {availableFanSpeeds.length > 0 && isOn && (
        <div className="space-y-1.5">
          <span className="text-[12px] text-text-tertiary flex items-center gap-1">
            <Wind size={12} strokeWidth={1.5} />
            {t("thermostat.fanSpeed")}
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {availableFanSpeeds.map((speed) => (
              <button
                key={speed}
                onClick={() => exec("fanSpeed", speed)}
                disabled={executing === "fanSpeed"}
                className={`
                  px-2.5 py-1 rounded-[6px] text-[11px] font-medium border
                  transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                  ${fanSpeed === speed
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-surface text-text-tertiary border-border hover:text-text-secondary"
                  }
                `}
              >
                {t(`thermostat.fanSpeeds.${speed}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Eco mode indicator */}
      {ecoMode && ecoMode !== "auto" && isOn && (
        <div className="flex items-center gap-1.5 text-[12px] text-success">
          <Leaf size={12} strokeWidth={1.5} />
          {t(`thermostat.ecoModes.${ecoMode}`)}
        </div>
      )}
    </div>
  );
}

/** Compact inline thermostat for dashboard lists */
function CompactThermostat({
  isOn,
  currentMode,
  insideTemp,
  targetTemp,
  hasPowerOrder,
  executing,
  onTogglePower,
}: {
  isOn: boolean;
  currentMode: string | null;
  insideTemp: number | null;
  targetTemp: number | null;
  hasPowerOrder: boolean;
  executing: string | null;
  onTogglePower: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.preventDefault()}>
      {/* Current temp */}
      <span className="text-[14px] font-semibold text-text tabular-nums font-mono">
        {insideTemp !== null ? `${insideTemp.toFixed(1)}°` : "—"}
      </span>

      {/* Target temp */}
      {isOn && targetTemp !== null && (
        <span className="text-[11px] text-text-tertiary tabular-nums">
          → {targetTemp.toFixed(1)}°
        </span>
      )}

      {/* Mode badge */}
      {isOn && currentMode && (
        <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium ${MODE_COLORS[currentMode] ?? "bg-border-light text-text-tertiary"}`}>
          {MODE_ICONS[currentMode]}
          {t(`thermostat.modes.${currentMode}`)}
        </span>
      )}

      {/* Power toggle */}
      {hasPowerOrder && (
        <>
          <div className="w-px h-5 bg-border" />
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePower(); }}
            disabled={executing === "power"}
            className={`
              p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer
              ${isOn
                ? "bg-primary text-white hover:bg-primary-hover"
                : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
          >
            <Power size={14} strokeWidth={1.5} />
          </button>
        </>
      )}
    </div>
  );
}
