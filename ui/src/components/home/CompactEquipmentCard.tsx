import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Power } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { SensorValues } from "../equipments/SensorValues";
import { ShutterControls } from "../equipments/ShutterControls";
import { ThermostatCard } from "../equipments/ThermostatCard";

const SETTLE_DELAY_MS = 2000;

interface CompactEquipmentCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

export function CompactEquipmentCard({ equipment, onExecuteOrder }: CompactEquipmentCardProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const [, forceRender] = useState(0);
  const localBrightness = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    isLight,
    isShutter,
    isSensor,
    isThermostat,
    stateBinding,
    isOn,
    shutterPosition,
    hasShutterState,
    sensorBindings,
    batteryBinding,
    batteryLevel,
    iconElement,
    iconColor,
  } = useEquipmentState(equipment);

  const brightnessBinding = equipment.dataBindings.find(
    (db) => db.alias === "brightness" || db.category === "light_brightness",
  );

  const deviceBrightness = brightnessBinding
    ? typeof brightnessBinding.value === "number"
      ? brightnessBinding.value
      : null
    : null;

  const brightness =
    localBrightness.current !== null ? localBrightness.current : deviceBrightness;

  const toggleBinding = equipment.orderBindings.find(
    (ob) => ob.type === "boolean",
  );
  const hasToggle = !!toggleBinding;
  const hasBrightness = equipment.orderBindings.some(
    (ob) => ob.type === "number" && (ob.alias === "brightness" || ob.key === "brightness"),
  );

  // Find primary data value for non-light, non-sensor, non-shutter, non-thermostat equipments
  const primaryBinding = !isLight && !isSensor && !isShutter && !isThermostat
    ? equipment.dataBindings[0] ?? null
    : null;

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const alias = toggleBinding.alias;
      // Boolean orders use true/false; "state" alias uses "ON"/"OFF" strings (Z2M convention)
      const value = alias === "state"
        ? (isOn ? "OFF" : "ON")
        : !isOn;
      await onExecuteOrder(equipment.id, alias, value);
    } finally {
      setExecuting(false);
    }
  };

  const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    localBrightness.current = Number(e.target.value);
    forceRender((n) => n + 1);
  };

  const handleBrightnessCommit = async () => {
    const commitValue = localBrightness.current;
    if (!hasBrightness || commitValue === null) return;
    try {
      await onExecuteOrder(equipment.id, "brightness", commitValue);
    } catch {
      // Ignore
    }
    settleTimer.current = setTimeout(() => {
      localBrightness.current = null;
      settleTimer.current = null;
      forceRender((n) => n + 1);
    }, SETTLE_DELAY_MS);
  };

  return (
    <div
      className={`
        flex items-center gap-2.5 px-3 py-2
        transition-colors duration-150
        hover:bg-border-light/40
      `}
    >
      {/* Icon */}
      <div
        className={`
          flex-shrink-0 w-7 h-7 rounded-[5px] flex items-center justify-center
          ${iconColor}
        `}
      >
        {iconElement}
      </div>

      {/* Name — links to detail */}
      <Link
        to={`/equipments/${equipment.id}`}
        className="flex-1 min-w-0 text-[13px] font-medium text-text truncate hover:text-primary transition-colors"
      >
        {equipment.name}
      </Link>

      {/* Sensor / Button values */}
      {isSensor && (
        <SensorValues
          sensorBindings={sensorBindings}
          batteryBinding={batteryBinding}
          batteryLevel={batteryLevel}
        />
      )}

      {/* Primary value for other equipments */}
      {primaryBinding && !isLight && !isSensor && !isShutter && !isThermostat && (
        <span className="text-[13px] text-text-secondary tabular-nums flex-shrink-0">
          {formatValue(primaryBinding.value, primaryBinding.unit)}
        </span>
      )}

      {/* Light controls */}
      {isLight && equipment.enabled && (
        <div
          className="flex items-center gap-2 flex-shrink-0"
          onClick={(e) => e.preventDefault()}
        >
          {isOn && stateBinding?.lastUpdated && (
            <span className="text-[11px] text-text-tertiary tabular-nums">
              {/* Elapsed time since light turned on — not critical, omit counter */}
            </span>
          )}
          {hasBrightness && brightness !== null && (
            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={0}
                max={254}
                value={brightness}
                onChange={handleBrightnessChange}
                onMouseUp={handleBrightnessCommit}
                onTouchEnd={handleBrightnessCommit}
                onClick={(e) => e.stopPropagation()}
                className="w-[60px] accent-primary h-1"
              />
              <span className="text-[11px] text-text-tertiary w-6 text-right tabular-nums">
                {Math.round((brightness / 254) * 100)}%
              </span>
            </div>
          )}
          <div className="w-px h-5 bg-border" />
          {hasToggle && (
            <button
              onClick={handleToggle}
              disabled={executing}
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
          )}
        </div>
      )}

      {/* Shutter controls */}
      {isShutter && equipment.enabled && (
        <ShutterControls
          shutterPosition={shutterPosition}
          hasShutterState={hasShutterState}
          hasPositionOrder={equipment.orderBindings.some((ob) => ob.alias === "position")}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
        />
      )}

      {/* Thermostat controls */}
      {isThermostat && equipment.enabled && (
        <ThermostatCard
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Boolean state badge for non-light, non-sensor, non-shutter equipments */}
      {!isLight && !isSensor && !isShutter && !isThermostat && stateBinding && (
        <span
          className={`
            text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0
            ${isOn
              ? "bg-success/10 text-success"
              : "bg-border-light text-text-tertiary"
            }
          `}
        >
          {isOn ? t("common.on") : t("common.off")}
        </span>
      )}
    </div>
  );
}
