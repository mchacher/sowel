import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../../types";
import type { DashboardWidget } from "../../types";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { SensorValues } from "../equipments/SensorValues";
import { LightControl } from "../equipments/LightControl";
import { ShutterControl } from "../equipments/ShutterControl";
import { ThermostatCard } from "../equipments/ThermostatCard";
import { GateControl } from "../equipments/GateControl";
import { HeaterControl } from "../equipments/HeaterControl";
import { getWidgetIcon } from "./widget-icons";

interface EquipmentWidgetProps {
  widget: DashboardWidget;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

export function EquipmentWidget({ widget, equipment, onExecuteOrder }: EquipmentWidgetProps) {
  const { t } = useTranslation();

  const {
    isLight,
    isShutter,
    isSensor,
    isThermostat,
    isHeater,
    isGate,
    stateBinding,
    isOn,
    sensorBindings,
    batteryBindings,
    iconColor,
  } = useEquipmentState(equipment);

  const label = widget.label || equipment.name;
  const IconComponent = useMemo(() => getWidgetIcon(widget.icon, equipment.type), [widget.icon, equipment.type]);

  const primaryBinding = !isLight && !isSensor && !isShutter && !isThermostat && !isHeater && !isGate
    ? equipment.dataBindings[0] ?? null
    : null;

  const hasNoData = equipment.dataBindings.length === 0;

  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 flex flex-col gap-2 min-h-[80px]">
      {/* Header: icon + label */}
      <div className="flex items-center gap-2">
        <div className={`flex-shrink-0 w-7 h-7 rounded-[5px] flex items-center justify-center ${iconColor}`}>
          <IconComponent size={16} strokeWidth={1.5} />
        </div>
        <span className="text-[13px] font-medium text-text truncate flex-1">{label}</span>
      </div>

      {/* Controls */}
      <div className="flex-1 flex items-center">
        {hasNoData && (
          <span className="text-[12px] text-text-tertiary">{t("dashboard.noData")}</span>
        )}

        {!hasNoData && isSensor && (
          <SensorValues sensorBindings={sensorBindings} batteryBindings={batteryBindings} />
        )}

        {!hasNoData && isLight && equipment.enabled && (
          <LightControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
            compact
          />
        )}

        {!hasNoData && isShutter && equipment.enabled && (
          <ShutterControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
            compact
          />
        )}

        {!hasNoData && isThermostat && equipment.enabled && (
          <ThermostatCard
            equipment={equipment}
            onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
            compact
          />
        )}

        {!hasNoData && isGate && equipment.enabled && (
          <GateControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
            compact
          />
        )}

        {!hasNoData && isHeater && equipment.enabled && (
          <HeaterControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
            compact
          />
        )}

        {!hasNoData && primaryBinding && !isLight && !isSensor && !isShutter && !isThermostat && !isHeater && !isGate && (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-text-secondary tabular-nums">
              {formatValue(primaryBinding.value, primaryBinding.unit)}
            </span>
            {stateBinding && (
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isOn ? "bg-success/10 text-success" : "bg-border-light text-text-tertiary"}`}>
                {isOn ? t("common.on") : t("common.off")}
              </span>
            )}
          </div>
        )}

        {!hasNoData && !equipment.enabled && !isSensor && (
          <span className="text-[12px] text-text-tertiary">{t("dashboard.disabled")}</span>
        )}
      </div>
    </div>
  );
}
