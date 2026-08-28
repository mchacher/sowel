import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { EquipmentWithDetails } from "../../types";
import { LightControl } from "./LightControl";
import { SolarControl } from "./SolarControl";
import { findMainOnOffOrder } from "./bindingUtils";
import { SensorValues } from "./SensorValues";
import { ShutterControl } from "./ShutterControl";
import { ThermostatCard } from "./ThermostatCard";
import { GateControl } from "./GateControl";
import { WaterValveControl } from "./WaterValveControl";
import { VmcControl } from "./VmcControl";
import { useEquipmentState } from "./useEquipmentState";
import { TYPE_LABELS } from "./equipment-type-meta";



interface EquipmentCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

/**
 * Spec 122 — surface the display's current brightness inline in the
 * card subtitle so the zone view shows at-a-glance whether the panel
 * is asleep (`Off`) or lit (`<pct> %`).  Returns null when the data
 * binding is missing or the value is not numeric.
 */
function displayBrightnessSummary(
  equipment: EquipmentWithDetails,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const binding = equipment.dataBindings.find((b) => b.category === "display_brightness");
  if (!binding) return null;
  const v = binding.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0) return t("displays.card.off");
  return t("displays.card.brightness", { pct: Math.round(v) });
}

export function EquipmentCard({ equipment, onExecuteOrder }: EquipmentCardProps) {
  const { t } = useTranslation();
  const {
    isLight,
    isSwitch,
    isShutterFamily,
    isSensor,
    isThermostat,
    isGate,
    iconElement,
    iconColor,
    sensorBindings,
    batteryBindings,
    batteryAlert,
  } = useEquipmentState(equipment);

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 bg-surface rounded-[10px] border
        transition-colors duration-150
        border-border
      `}
    >
      {/* Icon */}
      <div
        className={`
          flex-shrink-0 w-9 h-9 rounded-[6px] flex items-center justify-center
          ${iconColor}
        `}
      >
        {iconElement}
      </div>

      {/* Info */}
      <Link to={`/equipments/${equipment.id}`} className="flex-1 min-w-0 hover:opacity-80">
        <div className="text-[14px] font-medium text-text truncate">{equipment.name}</div>
        <div className="text-[12px] text-text-tertiary">
          {t(TYPE_LABELS[equipment.type])}
          {equipment.dataBindings.length === 0 && ` · ${t("equipments.noBindings")}`}
          {!equipment.enabled && ` · ${t("common.disabled")}`}
          {equipment.type === "display" && equipment.enabled && displayBrightnessSummary(equipment, t) &&
            ` · ${displayBrightnessSummary(equipment, t)}`}
        </div>
      </Link>

      {/* Sensor / Button values */}
      {isSensor && (
        <SensorValues
          sensorBindings={sensorBindings}
          batteryBindings={batteryBindings}
          batteryAlert={batteryAlert}
        />
      )}

      {/* Light / switch / water heater quick control (smart plug = ON/OFF relay,
          same surface). Spec 152: a dedicated solar toggle renders alongside
          (or instead of, on permanent mains) the main on/off. */}
      {(isLight || isSwitch || equipment.type === "water_heater") && equipment.enabled && (
        <div className="flex items-center gap-2">
          {!!findMainOnOffOrder(equipment.orderBindings) && (
            <LightControl
              equipment={equipment}
              onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
              compact
            />
          )}
          <SolarControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
            compact
          />
        </div>
      )}

      {/* Shutter / Awning quick control (shared control surface, awning relabels) */}
      {isShutterFamily && equipment.enabled && (
        <ShutterControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Thermostat quick control */}
      {isThermostat && equipment.enabled && (
        <ThermostatCard
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Gate quick control */}
      {isGate && equipment.enabled && (
        <GateControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Water valve quick control */}
      {equipment.type === "water_valve" && equipment.enabled && (
        <WaterValveControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* VMC speed control (spec 153) */}
      {equipment.type === "vmc" && equipment.enabled && (
        <VmcControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}
    </div>
  );
}
