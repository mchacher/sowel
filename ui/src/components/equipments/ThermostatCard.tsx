import { useState, useRef, useEffect } from "react";
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
  Thermometer,
  Crosshair,
  Moon,
  Armchair,
  Flame,
  AlertTriangle,
} from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface ThermostatCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

const MODE_ICONS: Record<string, React.ReactNode> = {
  // HVAC modes (Panasonic, etc.)
  auto: <Zap size={14} strokeWidth={1.5} />,
  cool: <Snowflake size={14} strokeWidth={1.5} />,
  heat: <Sun size={14} strokeWidth={1.5} />,
  dry: <Droplets size={14} strokeWidth={1.5} />,
  fan: <Fan size={14} strokeWidth={1.5} />,
  // Stove profiles (MCZ, etc.)
  dynamic: <Zap size={14} strokeWidth={1.5} />,
  overnight: <Moon size={14} strokeWidth={1.5} />,
  comfort: <Armchair size={14} strokeWidth={1.5} />,
};

const MODE_COLORS: Record<string, string> = {
  // HVAC modes
  auto: "bg-primary/10 text-primary border-primary/30",
  cool: "bg-primary/10 text-primary border-primary/30",
  heat: "bg-error/10 text-error border-error/30",
  dry: "bg-success/10 text-success border-success/30",
  fan: "bg-text-tertiary/10 text-text-secondary border-text-tertiary/30",
  // Stove profiles
  dynamic: "bg-primary/10 text-primary border-primary/30",
  overnight: "bg-primary/10 text-primary border-primary/30",
  comfort: "bg-warning/10 text-warning border-warning/30",
};

/** Color classes for stove state badge */
function stoveStateColor(state: string): string {
  if (state === "off" || state === "standby") return "text-text-tertiary bg-border-light";
  if (state.startsWith("running") || state === "auto_eco") return "text-success bg-success/10";
  if (state.startsWith("ignition") || state === "checking" || state === "stabilizing") return "text-warning bg-warning/10";
  if (state === "extinguishing" || state === "cooling" || state.startsWith("cleaning")) return "text-primary bg-primary/10";
  if (state.startsWith("error")) return "text-error bg-error/10";
  return "text-text-tertiary bg-border-light";
}

export function ThermostatCard({ equipment, onExecuteOrder, compact }: ThermostatCardProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<string | null>(null);

  // Optimistic overrides — applied immediately, cleared when real data arrives
  const [optimistic, setOptimistic] = useState<Record<string, unknown>>({});
  const prevBindingsRef = useRef(equipment.dataBindings);

  // Clear optimistic values when real data changes (WebSocket update)
  useEffect(() => {
    const prev = prevBindingsRef.current;
    const changed = equipment.dataBindings.some((b) => {
      const old = prev.find((p) => p.alias === b.alias);
      return old && old.value !== b.value;
    });
    if (changed) {
      setOptimistic({});
    }
    prevBindingsRef.current = equipment.dataBindings;
  }, [equipment.dataBindings]);

  // Read data bindings (with optimistic overlay)
  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const modeBinding = equipment.dataBindings.find((b) => b.alias === "operationMode")
    ?? equipment.dataBindings.find((b) => b.alias === "profile");
  const targetTempBinding = equipment.dataBindings.find((b) => b.alias === "setpoint");
  const insideTempBinding = equipment.dataBindings.find((b) => b.alias === "temperature");
  const outsideTempBinding = equipment.dataBindings.find((b) => b.alias === "outsideTemperature");
  const fanSpeedBinding = equipment.dataBindings.find((b) => b.alias === "fanSpeed");
  const ecoModeBinding = equipment.dataBindings.find((b) => b.alias === "ecoMode");
  const stoveStateBinding = equipment.dataBindings.find((b) => b.alias === "stoveState");

  const isOn = "power" in optimistic ? optimistic.power === true : powerBinding?.value === true;
  const stoveState = typeof stoveStateBinding?.value === "string" ? stoveStateBinding.value : null;
  const modeAlias = modeBinding?.alias ?? "operationMode";
  const currentMode = modeAlias in optimistic
    ? (optimistic[modeAlias] as string | null)
    : typeof modeBinding?.value === "string" ? modeBinding.value : null;
  const targetTemp = "setpoint" in optimistic
    ? (optimistic.setpoint as number | null)
    : typeof targetTempBinding?.value === "number" ? targetTempBinding.value : null;
  const insideTemp = typeof insideTempBinding?.value === "number" ? insideTempBinding.value : null;
  const outsideTemp = typeof outsideTempBinding?.value === "number" ? outsideTempBinding.value : null;
  const fanSpeed = "fanSpeed" in optimistic
    ? (optimistic.fanSpeed as string | null)
    : typeof fanSpeedBinding?.value === "string" ? fanSpeedBinding.value : null;
  const ecoModeRaw = ecoModeBinding?.value;
  const ecoMode = typeof ecoModeRaw === "string" ? ecoModeRaw
    : typeof ecoModeRaw === "boolean" ? (ecoModeRaw ? "on" : null)
    : null;

  // Order bindings (available controls)
  const hasPowerOrder = equipment.orderBindings.some((o) => o.alias === "power");
  const hasResetAlarmOrder = equipment.orderBindings.some((o) => o.alias === "resetAlarm");
  const modeOrder = equipment.orderBindings.find((o) => o.alias === "operationMode")
    ?? equipment.orderBindings.find((o) => o.alias === "profile");
  const targetTempOrder = equipment.orderBindings.find((o) => o.alias === "setpoint");
  const fanSpeedOrder = equipment.orderBindings.find((o) => o.alias === "fanSpeed");

  const availableModes = modeOrder?.enumValues ?? [];
  const availableFanSpeeds = fanSpeedOrder?.enumValues ?? [];

  const exec = async (alias: string, value: unknown) => {
    if (executing) return;
    // Apply optimistic update immediately
    setOptimistic((prev) => ({ ...prev, [alias]: value }));
    setExecuting(alias);
    try {
      await onExecuteOrder(alias, value);
    } catch {
      // Revert optimistic on error
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[alias];
        return next;
      });
    } finally {
      setExecuting(null);
    }
  };

  if (compact) {
    return (
      <CompactThermostat
        isOn={isOn}
        insideTemp={insideTemp}
        targetTemp={targetTemp}
        hasPowerOrder={hasPowerOrder}
        hasTargetTempOrder={!!targetTempOrder}
        targetMin={targetTempOrder?.min ?? 16}
        targetMax={targetTempOrder?.max ?? 30}
        executing={executing}
        onTogglePower={() => exec("power", !isOn)}
        onSetTarget={(v) => exec("setpoint", v)}
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

      {/* Stove state badge + reset alarm */}
      {stoveState && (
        <div className="flex items-center gap-2">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[12px] font-medium ${stoveStateColor(stoveState)}`}>
            <Flame size={12} strokeWidth={1.5} />
            {t(`stove.state.${stoveState}`, stoveState)}
          </div>
          {hasResetAlarmOrder && (() => {
            const hasAlarm = stoveState.startsWith("error");
            return (
              <button
                onClick={() => hasAlarm && exec("resetAlarm", true)}
                disabled={!hasAlarm || executing === "resetAlarm"}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[12px] font-medium border transition-colors ${
                  hasAlarm
                    ? "text-error bg-error/10 border-error/30 hover:bg-error/20 cursor-pointer"
                    : "text-text-tertiary bg-border-light/50 border-border cursor-default"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title={hasAlarm ? undefined : t("thermostat.noAlarm")}
              >
                <AlertTriangle size={12} strokeWidth={1.5} />
                {t("thermostat.resetAlarm")}
                {!hasAlarm && <span className="text-[11px] opacity-60">· {t("thermostat.noAlarm")}</span>}
              </button>
            );
          })()}
        </div>
      )}

      {/* Target temperature control */}
      {targetTempOrder && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-tertiary">{t("thermostat.target")}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => targetTemp !== null && exec("setpoint", targetTemp - 0.5)}
              disabled={executing === "setpoint" || targetTemp === null || targetTemp <= (targetTempOrder.min ?? 16)}
              className="p-1 rounded-[4px] bg-border-light text-text-secondary hover:bg-border hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronDown size={14} strokeWidth={2} />
            </button>
            <span className="text-[20px] font-semibold text-text tabular-nums font-mono min-w-[60px] text-center">
              {targetTemp !== null ? targetTemp.toFixed(1) : "—"}
              <span className="text-[12px] text-text-tertiary font-normal">°C</span>
            </span>
            <button
              onClick={() => targetTemp !== null && exec("setpoint", targetTemp + 0.5)}
              disabled={executing === "setpoint" || targetTemp === null || targetTemp >= (targetTempOrder.max ?? 30)}
              className="p-1 rounded-[4px] bg-border-light text-text-secondary hover:bg-border hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronUp size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* Mode selector */}
      {availableModes.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[12px] text-text-tertiary">{t("thermostat.mode")}</span>
          <div className="flex gap-1.5 flex-wrap">
            {availableModes.map((mode) => (
              <button
                key={mode}
                onClick={() => exec(modeAlias, mode)}
                disabled={executing === modeAlias}
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
      {availableFanSpeeds.length > 0 && (
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
      {ecoMode && ecoMode !== "auto" && (
        <div className="flex items-center gap-1.5 text-[12px] text-success">
          <Leaf size={12} strokeWidth={1.5} />
          {ecoMode === "on" ? t("thermostat.ecoMode") : t(`thermostat.ecoModes.${ecoMode}`)}
        </div>
      )}
    </div>
  );
}

/** Compact inline thermostat for dashboard lists */
function CompactThermostat({
  isOn,
  insideTemp,
  targetTemp,
  hasPowerOrder,
  hasTargetTempOrder,
  targetMin,
  targetMax,
  executing,
  onTogglePower,
  onSetTarget,
}: {
  isOn: boolean;
  insideTemp: number | null;
  targetTemp: number | null;
  hasPowerOrder: boolean;
  hasTargetTempOrder: boolean;
  targetMin: number;
  targetMax: number;
  executing: string | null;
  onTogglePower: () => void;
  onSetTarget: (value: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.preventDefault()}>
      {/* Current temp */}
      {insideTemp !== null && (
        <span className="flex items-center gap-0.5 text-[12px] text-text-tertiary tabular-nums">
          <Thermometer size={11} strokeWidth={1.5} />
          {insideTemp.toFixed(1)}°
        </span>
      )}

      {/* Separator */}
      {hasTargetTempOrder && targetTemp !== null && insideTemp !== null && (
        <div className="w-px h-4 bg-border" />
      )}

      {/* Target temp with +/- controls */}
      {hasTargetTempOrder && targetTemp !== null && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSetTarget(targetTemp - 0.5); }}
            disabled={executing === "setpoint" || targetTemp <= targetMin}
            className="p-0.5 rounded-[3px] text-text-tertiary hover:bg-border-light hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
          <span className="flex items-center gap-0.5 text-[14px] font-semibold text-text tabular-nums font-mono">
            <Crosshair size={11} strokeWidth={1.5} className="text-text-secondary" />
            {targetTemp.toFixed(1)}°
          </span>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSetTarget(targetTemp + 0.5); }}
            disabled={executing === "setpoint" || targetTemp >= targetMax}
            className="p-0.5 rounded-[3px] text-text-tertiary hover:bg-border-light hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronUp size={12} strokeWidth={2} />
          </button>
        </div>
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
